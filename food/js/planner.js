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

// Helper to calculate waste analysis consistently
function calculateWasteAnalysis(inventory, consumedMap, startDate, duration) {
    const wasteAnalysis = { wasted: [], atRisk: [] };
    
    inventory.forEach(item => {
        const consumed = consumedMap[item.name] || 0;
        const onHand = item.servings;
        
        if (onHand <= consumed) return; // All consumed, no waste
        
        const expiryDate = parseDateString(item.expiration);
        if (expiryDate) {
            const daysUntilExpiry = (expiryDate.getTime() - startDate.getTime()) / MS_DAY;
            
            // 1. Definite Waste: Expires BEFORE plan ends
            if (daysUntilExpiry < duration) {
                const unscheduled = onHand - consumed;
                wasteAnalysis.wasted.push({ name: item.name, count: unscheduled });
            } 
            // 2. At Risk: Expires AFTER plan ends, but won't all be eaten in time
            else {
                const dailyRate = consumed / duration;
                // "Copy-paste" the plan until expiry: how many would we eat total?
                const projectedTotalConsumption = dailyRate * daysUntilExpiry;
                
                if (onHand > projectedTotalConsumption) {
                    const amountAtRisk = onHand - projectedTotalConsumption;
                    wasteAnalysis.atRisk.push({ 
                        name: item.name, 
                        count: parseFloat(amountAtRisk.toFixed(1))
                    });
                }
            }
        }
    });
    return wasteAnalysis;
}

export async function handlePlanUpdate() {
    const planBtn = document.getElementById('updatePlanBtn');
    planBtn.disabled = true;
    
    const config = state.planConfig;
    const newStartDate = parseDateString(config.startDate);
    const newEndDate = parseDateString(config.endDate);

    if (!newStartDate || !newEndDate || newEndDate < newStartDate) {
        alert("Invalid date range selected.");
        planBtn.disabled = false;
        return;
    }

    if (!state.currentPlan || state.distributorData.length === 0) {
        console.log("No existing plan found. Generating a new one.");
        state.setDistributorData([]);
        await generatePlan();
        planBtn.disabled = false;
        return;
    }
    
    console.log("Existing plan found. Proceeding with re-optimization.");

    const newDuration = Math.round((newEndDate.getTime() - newStartDate.getTime()) / MS_DAY) + 1;
    if (newDuration < state.distributorData.length) {
        for (let i = newDuration; i < state.distributorData.length; i++) {
            for (const mealName of MEAL_NAMES) {
                if (state.distributorData[i].meals[mealName]?.completed) {
                    alert(`Error: Cannot shorten the plan because Day ${i + 1} contains a completed meal.`);
                    planBtn.disabled = false;
                    return;
                }
            }
        }
    }
    
    let lastCompletedPoint = null;
    for (let i = state.distributorData.length - 1; i >= 0; i--) {
        const reversedMealNames = [...MEAL_NAMES].reverse();
        for (const mealName of reversedMealNames) {
            if (state.distributorData[i].meals[mealName]?.completed) {
                lastCompletedPoint = { dayIndex: i, mealName };
                break;
            }
        }
        if (lastCompletedPoint) break;
    }

    const consumedItemsCount = {};
    let firstUncompleted = null;

    if (lastCompletedPoint) {
        console.log(`Last completed meal found at Day ${lastCompletedPoint.dayIndex + 1}.`);
        const lastMealIndex = MEAL_NAMES.indexOf(lastCompletedPoint.mealName);
        for (let dayIndex = 0; dayIndex <= lastCompletedPoint.dayIndex; dayIndex++) {
            MEAL_NAMES.forEach((mealName, mealIndex) => {
                if (dayIndex < lastCompletedPoint.dayIndex || (dayIndex === lastCompletedPoint.dayIndex && mealIndex <= lastMealIndex)) {
                    const meal = state.distributorData[dayIndex].meals[mealName];
                    if (meal?.items) {
                        meal.items.forEach(item => {
                            if (typeof item === 'string') {
                                consumedItemsCount[item] = (consumedItemsCount[item] || 0) + 1;
                            }
                        });
                    }
                }
            });
        }

        const nextMealIndex = lastMealIndex + 1;
        if (nextMealIndex < MEAL_NAMES.length) {
            firstUncompleted = { dayIndex: lastCompletedPoint.dayIndex, mealName: MEAL_NAMES[nextMealIndex] };
        } else {
            firstUncompleted = { dayIndex: lastCompletedPoint.dayIndex + 1, mealName: MEAL_NAMES[0] };
        }

    } else {
        console.log("No completed meals found.");
        for (let i = 0; i < state.distributorData.length; i++) {
            for (const mealName of MEAL_NAMES) {
                if (!state.distributorData[i].meals[mealName]?.completed) {
                    firstUncompleted = { dayIndex: i, mealName: mealName };
                    break;
                }
            }
            if (firstUncompleted) break;
        }
    }

    if (!firstUncompleted || firstUncompleted.dayIndex >= state.distributorData.length) {
        if (newDuration > state.distributorData.length) {
             firstUncompleted = { dayIndex: state.distributorData.length, mealName: MEAL_NAMES[0] };
        } else {
            alert("All meals are marked as complete. Nothing to re-optimize!");
            planBtn.disabled = false;
            return;
        }
    }
    
    const remainingInventory = state.foodDatabase.map(foodItem => {
        const remainingServings = foodItem.servings - (consumedItemsCount[foodItem.name] || 0);
        return remainingServings > 0 ? { ...foodItem, servings: remainingServings } : null;
    }).filter(Boolean);
    
    const recalcStartDate = new Date(newStartDate.getTime() + firstUncompleted.dayIndex * MS_DAY);
    
    if (recalcStartDate > newEndDate) {
        alert("No future days left to re-optimize.");
        planBtn.disabled = false;
        state.distributorData.splice(newDuration);
        state.currentPlan.planParameters.endDate = isoDate(newEndDate);
        state.currentPlan.planParameters.duration = newDuration;
        renderPlanResults(state.currentPlan);
        renderDistributorGrid();
        state.saveState();
        return;
    }

    const foodMap = new Map(state.foodDatabase.map(f => [f.name, f]));
    let consumedOnPartialDay = null;
    if (firstUncompleted && firstUncompleted.dayIndex < state.distributorData.length) {
        const dayOfRecalc = state.distributorData[firstUncompleted.dayIndex];
        const partialDayMacros = Object.fromEntries(MACROS.map(key => [key, 0]));
        const partialDayItemCounts = {};
        const firstUncompletedMealIndex = MEAL_NAMES.indexOf(firstUncompleted.mealName);

        for (let i = 0; i < firstUncompletedMealIndex; i++) {
            const mealName = MEAL_NAMES[i];
            const meal = dayOfRecalc.meals[mealName];
            if (meal?.items) {
                // --- START FIX 1: Robust macro calculation ---
                meal.items.forEach(item => {
                    let nutrients = null;
                    let itemName = null;

                    if (item && typeof item === 'string') {
                        nutrients = foodMap.get(item);
                        itemName = item;
                    } else if (item && item.isCustom) {
                        nutrients = item.macros;
                    }

                    if (nutrients) {
                        if (itemName) {
                            partialDayItemCounts[itemName] = (partialDayItemCounts[itemName] || 0) + 1;
                        }
                        MACROS.forEach(macro => {
                            partialDayMacros[macro] += nutrients[macro] || 0;
                        });
                    }
                });
                // --- END FIX 1 ---
            }
        }

        if (Object.keys(partialDayItemCounts).length > 0 || Object.values(partialDayMacros).some(v => v > 0)) {
            consumedOnPartialDay = {
                macros: partialDayMacros,
                itemCounts: partialDayItemCounts
            };
        }
    }

    alert("Updating the plan based on your new configuration. Please wait...");

    const recalcResult = await generatePlan(true, {
        startDate: recalcStartDate, 
        endDate: newEndDate, 
        macroGoals: config.macros, 
        inventory: remainingInventory, 
        allowShopping: config.allowShopping,
        strength: config.strength,
        consumedOnPartialDay: consumedOnPartialDay
    });

    if (recalcResult?.dailySchedule) {
        
        if (state.distributorData.length > newDuration) {
            state.distributorData.splice(newDuration); 
        } else {
            while (state.distributorData.length < newDuration) { 
                const dayMeals = {};
                MEAL_NAMES.forEach(name => dayMeals[name] = { items: [], completed: false });
                state.distributorData.push({ day: state.distributorData.length + 1, meals: dayMeals });
            }
        }
        
        state.distributorData.forEach((day, dayIndex) => {
            if (dayIndex >= firstUncompleted.dayIndex) {
                MEAL_NAMES.forEach(mealName => {
                    const meal = day.meals[mealName];
                    if (meal && !meal.completed) {
                        meal.items = meal.items.filter(item => item && item.isCustom);
                    }
                });
            }
        });

        recalcResult.dailySchedule.forEach((newDayItems, i) => {
            const targetDayIndex = firstUncompleted.dayIndex + i;
            if (targetDayIndex < state.distributorData.length) {
                // --- START FIX 2: Correct starting meal index for partial days ---
                let mealIndex = (i === 0) ? MEAL_NAMES.indexOf(firstUncompleted.mealName) : 0;
                // --- END FIX 2 ---
                newDayItems.forEach(item => {
                    let mealAssigned = false, attempts = 0;
                    while (!mealAssigned && attempts < MEAL_NAMES.length) {
                        const mealName = MEAL_NAMES[mealIndex % MEAL_NAMES.length];
                        const targetMeal = state.distributorData[targetDayIndex].meals[mealName];
                        if (targetMeal && !targetMeal.completed) {
                            targetMeal.items.push(item);
                            mealAssigned = true;
                        }
                        mealIndex++;
                        attempts++;
                    }
                });
            }
        });
        
        const newTotalConsumption = { ...consumedItemsCount };
        for (const [name, count] of Object.entries(recalcResult.consumption)) {
            newTotalConsumption[name] = (newTotalConsumption[name] || 0) + count;
        }
        state.currentPlan.consumption = newTotalConsumption;
        
        state.currentPlan.planParameters = {
            startDate: isoDate(newStartDate),
            endDate: isoDate(newEndDate),
            duration: newDuration,
            originalGoals: config.macros
        };
        
        const newShoppingList = [];
        const masterInventoryMap = new Map(state.foodDatabase.map(item => [item.name, item]));

        Object.entries(newTotalConsumption).forEach(([name, totalNeeded]) => {
            const inventoryItem = masterInventoryMap.get(name);
            if (inventoryItem && inventoryItem.shoppable) {
                const onHand = inventoryItem.servings || 0;
                const servingsNeededFromStore = Math.max(0, totalNeeded - onHand);
                if (servingsNeededFromStore > 0) {
                    const servingsPerPackage = inventoryItem.servingsPerPackage || 1;
                    const packagesToBuy = Math.ceil(servingsNeededFromStore / servingsPerPackage);
                    const totalServingsPurchased = packagesToBuy * servingsPerPackage;
                    newShoppingList.push({ 
                        name, 
                        packagesToBuy,
                        servingsPerPackage,
                        totalServings: totalServingsPurchased
                    });
                }
            }
        });

        // UPDATED: Use helper to calculate waste (consistent logic with generatePlan)
        const newWasteAnalysis = calculateWasteAnalysis(state.foodDatabase, newTotalConsumption, newStartDate, newDuration);
        
        state.currentPlan.shoppingList = newShoppingList;
        state.currentPlan.wasteAnalysis = newWasteAnalysis;
        
        alert("Plan has been updated successfully!");
        renderPlanResults(state.currentPlan);
        renderDistributorGrid();
        state.saveState();
    } else {
        alert("Update failed to produce a valid result.");
    }
    planBtn.disabled = false;
}

export async function generatePlan(isRecalculation = false, options = {}) {
    console.log(`%c--- Starting Plan Generation (Recalc: ${isRecalculation}) ---`, 'color: blue; font-weight: bold;');
    const planBtn = document.getElementById('updatePlanBtn');
    const summaryEl = document.getElementById('planSummary');

    planBtn.disabled = true;
    
    const config = state.planConfig;
    const optimizationStrength = isRecalculation ? options.strength : config.strength;
    const shoppingAllowed = isRecalculation ? options.allowShopping : config.allowShopping;
    const startDate = isRecalculation ? options.startDate : parseDateString(config.startDate);
    const endDate = isRecalculation ? options.endDate : parseDateString(config.endDate);
    const sourceInventory = isRecalculation ? options.inventory : state.foodDatabase;
    const macroGoals = isRecalculation ? options.macroGoals : config.macros;
    
    let consumedOnPartialDay = isRecalculation ? options.consumedOnPartialDay : null;

    if (!isRecalculation && state.distributorData.length > 0 && state.distributorData[0].meals) {
        const initialDayMacros = Object.fromEntries(MACROS.map(key => [key, 0]));
        const initialDayItemCounts = {};
        MEAL_NAMES.forEach(mealName => {
            const meal = state.distributorData[0].meals[mealName];
            if (meal) {
                meal.items.forEach(item => {
                    if (item && item.isCustom) {
                        initialDayItemCounts[item.name] = (initialDayItemCounts[item.name] || 0) + 1;
                        Object.keys(initialDayMacros).forEach(macro => {
                            initialDayMacros[macro] += item.macros[macro] || 0;
                        });
                    }
                });
            }
        });
        consumedOnPartialDay = {
            macros: initialDayMacros,
            itemCounts: initialDayItemCounts
        };
    }

    if (sourceInventory.length === 0 && !shoppingAllowed) {
        alert("Please add food to your inventory or allow shopping.");
        planBtn.disabled = false;
        return;
    }
    if (!startDate || !endDate || endDate < startDate) {
        alert("Invalid date range selected.");
        planBtn.disabled = false;
        return;
    }

    const planDurationDays = Math.round((endDate.getTime() - startDate.getTime()) / MS_DAY) + 1;

    const updateProgress = (generation, bestScore, elapsedMs, totalMs) => {
        const normalizedScore = bestScore / Math.max(1, planDurationDays);
        const elapsedSec = (elapsedMs / 1000).toFixed(1);
        const totalSec = (totalMs / 1000).toFixed(0);
        summaryEl.innerHTML = `Optimizing... (runs in background)<br>
            <strong>Time:</strong> ${elapsedSec}s / ${totalSec}s<br>
            <strong>Generations:</strong> ${generation}<br>
            <strong>Avg. Daily Score (Penalty):</strong> ${normalizedScore.toFixed(2)}`;
    };

    summaryEl.textContent = 'Preparing for optimization...';
    
    let units = [];
    sourceInventory.forEach(item => {
        for (let i = 0; i < item.servings; i++) {
            units.push({ name: item.name, nutrients: item, maxPerDay: item.maxPerDay, expiration: item.expiration, isVirtual: false });
        }
    });

    if (shoppingAllowed) {
        const VIRTUAL_SHOPPING_POOL_SIZE = planDurationDays;
        const masterInventory = state.foodDatabase;

        masterInventory.forEach(item => {
            if (item.shoppable) {
                for (let i = 0; i < VIRTUAL_SHOPPING_POOL_SIZE; i++) {
                    units.push({ name: item.name, nutrients: item, maxPerDay: item.maxPerDay, expiration: item.expiration, isVirtual: true });
                }
            }
        });
    }

    const foodDataMap = new Map(state.foodDatabase.map(f => [f.name, f]));
    
    const gaParams = {
        populationSize: 500,
        mutationStart: 0.1,
        mutationEnd: 0.05
    };

    const workerParams = {
        units,
        macroGoals,
        startDate: isoDate(startDate), 
        totalDays: planDurationDays,
        optDurationSeconds: optimizationStrength,
        gaParams,
        foodDataMap,
        consumedOnFirstDay: consumedOnPartialDay, 
        constants: {
            MACROS: utils.MACROS,
            MACRO_WEIGHTS: utils.MACRO_WEIGHTS,
            PENALTY_SCALE_FACTOR: utils.PENALTY_SCALE_FACTOR,
            WASTE_PENALTY: utils.WASTE_PENALTY,
            LIMIT_VIOLATION_PENALTY: utils.LIMIT_VIOLATION_PENALTY,
        }
    };
    
    const bestIndividual = await runOptimizerInWorker(workerParams, updateProgress);
    
    const dailySchedule = Array.from({ length: planDurationDays }, () => []);
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
                const totalServingsPurchased = packagesToBuy * servingsPerPackage;
                shoppingList.push({ 
                    name, 
                    packagesToBuy,
                    servingsPerPackage,
                    totalServings: totalServingsPurchased
                });
            }
        }
    });

    // UPDATED: Use the helper function for consistent logic with UI reporting
    const wasteAnalysis = calculateWasteAnalysis(sourceInventory, onHandConsumption, startDate, planDurationDays);

    const planResult = { 
        planParameters: { startDate: isoDate(startDate), endDate: isoDate(endDate), duration: planDurationDays, originalGoals: macroGoals }, 
        dailySchedule, consumption: totalConsumption, shoppingList, wasteAnalysis 
    };

    if (isRecalculation) {
        return planResult;
    }

    state.setCurrentPlan(planResult);
    populateDistributorFromPlan();
    renderPlanResults(planResult);
    renderDistributorGrid();
    state.saveState();
    planBtn.disabled = false;
}

export function finishPlan() {
    if (!state.distributorData || state.distributorData.length === 0) {
        alert("There is no plan to finish.");
        return;
    }

    if (!confirm("Are you sure you want to finish this plan? This will subtract all 'completed' items from your inventory and clear the current plan schedule. This action cannot be undone.")) {
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
        alert("No meals were marked as 'completed'. Inventory was not changed, but the plan will now be cleared.");
    } else {
        const foodMap = new Map(state.foodDatabase.map(f => [f.name, f]));
        completedConsumption.forEach((count, name) => {
            const foodItem = foodMap.get(name);
            if (foodItem) {
                foodItem.servings = Math.max(0, foodItem.servings - count);
            }
        });
        alert(`${completedConsumption.size} food type(s) updated in your inventory. The plan will now be cleared.`);
    }

    state.setCurrentPlan(null);
    state.setDistributorData([]);
    state.saveState();
    renderInventoryTable();
    renderDistributorGrid(); 
    renderPlanResults(null);
}