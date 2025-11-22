import * as state from './state.js';
import * as utils from './utils.js'; 
import { MS_DAY, parseDateString, isoDate, MEAL_NAMES, MACROS } from './utils.js';
import { renderPlanResults, renderDistributorGrid, renderInventoryTable } from './ui.js';
import { runOptimizerInWorker } from './geneticOptimizer.js';

function populateDistributorFromPlan() {
    if (!state.currentPlan || !state.currentPlan.dailySchedule) return;

    const distributor = [];
    state.currentPlan.dailySchedule.forEach((dayItems, dayIndex) => {
        const dayMeals = {};
        MEAL_NAMES.forEach(name => dayMeals[name] = { items: [], completed: false });

        dayItems.forEach((item, itemQueueIndex) => {
            const mealName = MEAL_NAMES[itemQueueIndex % MEAL_NAMES.length];
            dayMeals[mealName].items.push(item);
        });
        distributor.push({ day: dayIndex + 1, meals: dayMeals });
    });
    state.setDistributorData(distributor);
}

// Consistently calculate waste
function calculateWasteAnalysis(inventory, onHandConsumption, startDate, duration, shoppingList, totalConsumption) {
    const wasteAnalysis = { wasted: [], atRisk: [] };
    
    // 1. Check on-hand inventory waste (existing logic)
    inventory.forEach(item => {
        const consumed = onHandConsumption[item.name] || 0;
        const onHand = item.servings;
        
        if (onHand <= consumed) return; 
        
        const expiryDate = parseDateString(item.expiration);
        if (expiryDate) {
            const daysUntilExpiry = (expiryDate.getTime() - startDate.getTime()) / MS_DAY;
            
            if (daysUntilExpiry < duration) {
                const unscheduled = onHand - consumed;
                wasteAnalysis.wasted.push({ name: item.name, count: unscheduled, source: 'on-hand' });
            } 
            else {
                const dailyRate = consumed / duration;
                const projectedTotalConsumption = dailyRate * daysUntilExpiry;
                
                if (onHand > projectedTotalConsumption) {
                    const amountAtRisk = onHand - projectedTotalConsumption;
                    wasteAnalysis.atRisk.push({ 
                        name: item.name, 
                        count: parseFloat(amountAtRisk.toFixed(1)),
                        source: 'on-hand'
                    });
                }
            }
        }
    });
    
    // 2. NEW: Check shopping list waste
    if (shoppingList && shoppingList.length > 0) {
        const inventoryMap = new Map(inventory.map(item => [item.name, item]));
        
        shoppingList.forEach(shoppingItem => {
            const inventoryItem = inventoryMap.get(shoppingItem.name);
            if (!inventoryItem) return;
            
            const totalNeeded = totalConsumption[shoppingItem.name] || 0;
            const onHand = inventoryItem.servings || 0;
            const servingsNeededFromStore = Math.max(0, totalNeeded - onHand);
            const servingsPurchased = shoppingItem.totalServings;
            const unusedServings = servingsPurchased - servingsNeededFromStore;
            
            if (unusedServings > 0) {
                const expiryDate = parseDateString(inventoryItem.expiration);
                if (expiryDate) {
                    const daysUntilExpiry = (expiryDate.getTime() - startDate.getTime()) / MS_DAY;
                    
                    // If expires during the plan, it's definite waste
                    if (daysUntilExpiry <= duration) {
                        wasteAnalysis.wasted.push({ 
                            name: shoppingItem.name, 
                            count: unusedServings,
                            source: 'purchased' 
                        });
                    } 
                    // If expires soon after the plan ends, it's at risk
                    else if (daysUntilExpiry < duration * 1.5) {
                        wasteAnalysis.atRisk.push({ 
                            name: shoppingItem.name, 
                            count: parseFloat(unusedServings.toFixed(1)),
                            source: 'purchased'
                        });
                    }
                }
            }
        });
    }
    
    return wasteAnalysis;
}

// --- PREPARE UNITS HELPER ---
// Generates the exact unit list the GA will use
function generateUnitList(inventory, allowShopping, duration) {
    let units = [];
    // 1. Real Inventory
    inventory.forEach(item => {
        for (let i = 0; i < item.servings; i++) {
            units.push({ 
                name: item.name, 
                nutrients: item, 
                maxPerDay: item.maxPerDay, 
                expiration: item.expiration, 
                isVirtual: false 
            });
        }
    });

    // 2. Virtual Inventory (Shopping)
    if (allowShopping) {
        const VIRTUAL_SHOPPING_POOL_SIZE = duration;
        inventory.forEach(item => {
            if (item.shoppable) {
                for (let i = 0; i < VIRTUAL_SHOPPING_POOL_SIZE; i++) {
                    units.push({ 
                        name: item.name, 
                        nutrients: item, 
                        maxPerDay: item.maxPerDay, 
                        expiration: item.expiration, 
                        isVirtual: true 
                    });
                }
            }
        });
    }
    return units;
}

export async function handlePlanUpdate() {
    const planBtn = document.getElementById('updatePlanBtn');
    planBtn.disabled = true;
    
    const config = state.planConfig;
    const startDate = parseDateString(config.startDate);
    const endDate = parseDateString(config.endDate);

    if (!startDate || !endDate || endDate < startDate) {
        alert("Invalid date range selected.");
        planBtn.disabled = false;
        return;
    }

    const duration = Math.round((endDate.getTime() - startDate.getTime()) / MS_DAY) + 1;
    
    // 1. Generate the master list of units (Real + Virtual)
    // We need this local copy to map the distributor strings back to unit indices
    const units = generateUnitList(state.foodDatabase, config.allowShopping, duration);
    
    // 2. Scan Distributor for "Completed" Items and "Custom" Items
    const lockedUnits = {}; // { unitIndex: dayIndex }
    const usedUnitIndices = new Set();
    
    const customDayMacros = Array.from({ length: duration }, () => {
        const m = {};
        MACROS.forEach(k => m[k] = 0);
        return m;
    });

    // Helper to find a unit index for a string name
    const findAvailableUnitIndex = (name) => {
        // First try to find a real, non-virtual unit
        let idx = units.findIndex((u, i) => u.name === name && !u.isVirtual && !usedUnitIndices.has(i));
        
        // If no real unit, try virtual
        if (idx === -1) {
            idx = units.findIndex((u, i) => u.name === name && u.isVirtual && !usedUnitIndices.has(i));
        }
        return idx;
    };

    // Iterate existing distributor data to lock items
    state.distributorData.forEach((day, dayIdx) => {
        if (dayIdx >= duration) return; // Ignore days outside new range

        MEAL_NAMES.forEach(mealName => {
            const meal = day.meals[mealName];
            if (!meal) return;

            // Check for Custom Items (ALWAYS add to custom macros, whether completed or not)
            // Wait - actually, if it's NOT completed, we might want to keep it or clear it?
            // Standard logic: Custom items persist. Generated items are cleared if not completed.
            // So we sum ALL custom items.
            meal.items.forEach(item => {
                if (item && item.isCustom) {
                    MACROS.forEach(key => {
                        customDayMacros[dayIdx][key] += (item.macros[key] || 0);
                    });
                }
                // Check for Completed Inventory Items
                else if (typeof item === 'string' && meal.completed) {
                    const unitIdx = findAvailableUnitIndex(item);
                    if (unitIdx !== -1) {
                        lockedUnits[unitIdx] = dayIdx;
                        usedUnitIndices.add(unitIdx);
                    } else {
                        console.warn(`Could not lock item '${item}' on Day ${dayIdx+1}. Inventory might have changed.`);
                    }
                }
            });
        });
    });
    
    // 3. Run Optimization
    await generatePlan(true, {
        startDate,
        endDate,
        units, // Pass the generated units
        lockedUnits,
        customDayMacros
    });
    
    planBtn.disabled = false;
}

export async function generatePlan(isRecalculation = false, options = {}) {
    const summaryEl = document.getElementById('planSummary');
    summaryEl.textContent = 'Preparing optimization...';

    const config = state.planConfig;
    const startDate = isRecalculation ? options.startDate : parseDateString(config.startDate);
    const endDate = isRecalculation ? options.endDate : parseDateString(config.endDate);
    const duration = Math.round((endDate.getTime() - startDate.getTime()) / MS_DAY) + 1;
    
    // If NOT recalculation (fresh run), generate units here. 
    // If recalculation, use the units passed in (which match the locking logic).
    const units = isRecalculation ? options.units : generateUnitList(state.foodDatabase, config.allowShopping, duration);
    
    const lockedUnits = options.lockedUnits || {};
    const customDayMacros = options.customDayMacros || [];

    const updateProgress = (generation, bestScore, elapsedMs, totalMs) => {
        const normalizedScore = bestScore / Math.max(1, duration);
        const elapsedSec = (elapsedMs / 1000).toFixed(1);
        const totalSec = (totalMs / 1000).toFixed(0);
        summaryEl.innerHTML = `Optimizing...<br>
            <strong>Time:</strong> ${elapsedSec}s / ${totalSec}s<br>
            <strong>Gen:</strong> ${generation}<br>
            <strong>Penalty:</strong> ${normalizedScore.toFixed(0)}`;
    };

    const foodDataMap = new Map(state.foodDatabase.map(f => [f.name, f]));
    
    const gaParams = {
        populationSize: 500,
        mutationStart: 0.1,
        mutationEnd: 0.05
    };

    const workerParams = {
        units,
        macroGoals: config.macros,
        startDate: isoDate(startDate), 
        totalDays: duration,
        optDurationSeconds: config.strength,
        gaParams,
        foodDataMap,
        lockedUnits,
        customDayMacros,
        constants: {
            MACROS: utils.MACROS,
            MACRO_WEIGHTS: utils.MACRO_WEIGHTS,
            PENALTY_SCALE_FACTOR: utils.PENALTY_SCALE_FACTOR,
            WASTE_PENALTY: utils.WASTE_PENALTY,
            LIMIT_VIOLATION_PENALTY: utils.LIMIT_VIOLATION_PENALTY,
            DIVERSITY_WEIGHT: utils.DIVERSITY_WEIGHT,
            MIN_UNIQUE_CLUSTERS: utils.MIN_UNIQUE_CLUSTERS,
            SIMILARITY_THRESHOLD: utils.SIMILARITY_THRESHOLD
        }
    };
    
    const bestIndividual = await runOptimizerInWorker(workerParams, updateProgress);
    
    // --- RECONSTRUCT PLAN ---
    
    // 1. Daily Schedule (Simple List of Strings)
    const dailySchedule = Array.from({ length: duration }, () => []);
    const onHandConsumption = {};
    const shoppingListMap = {};

    bestIndividual.forEach((dayIndex, unitIndex) => {
        if (dayIndex >= 0) {
            const unit = units[unitIndex];
            dailySchedule[dayIndex].push(unit.name);

            if (unit.isVirtual) {
                shoppingListMap[unit.name] = (shoppingListMap[unit.name] || 0) + 1;
            } else {
                onHandConsumption[unit.name] = (onHandConsumption[unit.name] || 0) + 1;
            }
        }
    });
    
    // 2. Update Distributor (Visual Grid)
    // If fresh run, wipe it. If update, merge carefully.
    if (!isRecalculation) {
        populateDistributorFromPlan(dailySchedule); // This function needs updating to accept args or set state
    } else {
        // MERGE LOGIC
        // Ensure distributor has enough days
        while (state.distributorData.length < duration) {
             const dayMeals = {};
             MEAL_NAMES.forEach(name => dayMeals[name] = { items: [], completed: false });
             state.distributorData.push({ day: state.distributorData.length + 1, meals: dayMeals });
        }
        
        // Iterate days
        for (let dayIdx = 0; dayIdx < duration; dayIdx++) {
            const newScheduledItems = dailySchedule[dayIdx] ? [...dailySchedule[dayIdx]] : [];
            const currentDayData = state.distributorData[dayIdx];
            
            // We need to remove items from "newScheduledItems" that are already present in Completed/Custom slots
            // so we don't duplicate them.
            
            // Map current completed items to remove them from the "To Add" list
            MEAL_NAMES.forEach(mealName => {
                const meal = currentDayData.meals[mealName];
                if (!meal) return;
                
                if (meal.completed) {
                    // For every item in this completed meal, remove one instance from newScheduledItems
                    meal.items.forEach(existingItem => {
                        if (typeof existingItem === 'string') {
                            const matchIdx = newScheduledItems.indexOf(existingItem);
                            if (matchIdx !== -1) {
                                newScheduledItems.splice(matchIdx, 1);
                            }
                        }
                    });
                } else {
                    // If NOT completed, we CLEAR the generated items (strings) but KEEP custom items
                    meal.items = meal.items.filter(it => it && it.isCustom);
                }
            });
            
            // Now newScheduledItems contains only the NEW stuff that the optimizer added
            // Distribute them into the non-completed meals
            let mealPtr = 0;
            newScheduledItems.forEach(newItemName => {
                let placed = false;
                let attempts = 0;
                while (!placed && attempts < 4) {
                    const mealName = MEAL_NAMES[mealPtr % 4];
                    const meal = currentDayData.meals[mealName];
                    if (!meal.completed) {
                        meal.items.push(newItemName);
                        placed = true;
                    }
                    mealPtr++;
                    attempts++;
                }
            });
        }
    }

    // 3. Consumption & Shopping List logic (Standard)
    const totalConsumption = { ...onHandConsumption };
    Object.entries(shoppingListMap).forEach(([name, count]) => {
        totalConsumption[name] = (totalConsumption[name] || 0) + count;
    });

    const shoppingList = [];
    const masterInventoryMap = new Map(state.foodDatabase.map(item => [item.name, item]));

    Object.entries(totalConsumption).forEach(([name, totalNeeded]) => {
        const inventoryItem = masterInventoryMap.get(name);
        if (inventoryItem && inventoryItem.shoppable) {
            const onHand = inventoryItem.servings || 0;
            const servingsNeededFromStore = Math.max(0, totalNeeded - onHand);
            if (servingsNeededFromStore > 0) {
                const servingsPerPackage = inventoryItem.servingsPerPackage || 1;
                const packagesToBuy = Math.ceil(servingsNeededFromStore / servingsPerPackage);
                shoppingList.push({ 
                    name, 
                    packagesToBuy,
                    servingsPerPackage,
                    totalServings: packagesToBuy * servingsPerPackage
                });
            }
        }
    });

    const wasteAnalysis = calculateWasteAnalysis(
    state.foodDatabase, 
    onHandConsumption, 
    startDate, 
    duration,
    shoppingList,      // NEW
    totalConsumption   // NEW
);

    const planResult = { 
        planParameters: { startDate: isoDate(startDate), endDate: isoDate(endDate), duration, originalGoals: config.macros }, 
        dailySchedule, 
        consumption: totalConsumption, 
        shoppingList, 
        wasteAnalysis 
    };

    state.setCurrentPlan(planResult);
    
    // If fresh run, we need to build the distributor from scratch using the result
    if (!isRecalculation) {
         populateDistributorFromPlan();
    }
    
    renderPlanResults(planResult);
    renderDistributorGrid();
    state.saveState();
}

export function finishPlan() {
    if (!state.distributorData || state.distributorData.length === 0) {
        alert("There is no plan to finish.");
        return;
    }

    if (!confirm("Are you sure? This will subtract all 'completed' items from your inventory and clear the plan.")) {
        return;
    }

    const completedConsumption = new Map();

    state.distributorData.forEach(day => {
        MEAL_NAMES.forEach(mealName => {
            const meal = day.meals[mealName];
            if (meal?.completed) {
                meal.items.forEach(item => {
                    if (typeof item === 'string') {
                        completedConsumption.set(item, (completedConsumption.get(item) || 0) + 1);
                    }
                });
            }
        });
    });

    if (completedConsumption.size === 0) {
        alert("No meals were marked as 'completed'.");
    } else {
        const foodMap = new Map(state.foodDatabase.map(f => [f.name, f]));
        completedConsumption.forEach((count, name) => {
            const foodItem = foodMap.get(name);
            if (foodItem) {
                foodItem.servings = Math.max(0, foodItem.servings - count);
            }
        });
    }

    state.setCurrentPlan(null);
    state.setDistributorData([]);
    state.saveState();
    renderInventoryTable();
    renderDistributorGrid(); 
    renderPlanResults(null);
}