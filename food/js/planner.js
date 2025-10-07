// ============================================================================== //
// PLANNER.JS - MEAL PLAN GENERATION AND MANAGEMENT (GA VERSION)
// ============================================================================== //
// This file is responsible for:
// 1. Orchestrating meal plan generation using the GeneticAlgorithmPlanner.
// 2. Handling user input for plan parameters via the state.
// 3. Processing the optimizer's output to create the daily schedule, shopping
//    list, and waste analysis.
// 4. Handling both initial plan generation and re-optimization requests.
// ============================================================================== //

import * as state from './state.js';
import { MS_DAY, parseDateString, isoDate, MEAL_NAMES, MACROS } from './utils.js';
import { renderPlanResults, renderDistributorGrid } from './ui.js';
import GeneticAlgorithmPlanner from './geneticOptimizer.js';


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

/**
 * Main function to handle plan generation and updates.
 * Acts as a controller for the GeneticAlgorithmPlanner.
 */
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

    // --- If no plan exists, generate a fresh one ---
    if (!state.currentPlan || state.distributorData.length === 0) {
        console.log("No existing plan found. Generating a new one.");
        // Clear any custom meals from a previous, un-generated plan
        state.setDistributorData([]);
        await generatePlan();
        planBtn.disabled = false;
        return;
    }
    
    // --- Logic for updating an existing plan ---
    console.log("Existing plan found. Proceeding with re-optimization.");

    // --- Date Validation: Check for completed meals in days that would be deleted ---
    const newDuration = Math.round((newEndDate.getTime() - newStartDate.getTime()) / MS_DAY) + 1;
    if (newDuration < state.distributorData.length) {
        for (let i = newDuration; i < state.distributorData.length; i++) {
            for (const mealName of MEAL_NAMES) {
                if (state.distributorData[i].meals[mealName]?.completed) {
                    alert(`Error: Cannot shorten the plan because Day ${i + 1} contains a completed meal. Please un-complete the meal or choose a longer date range.`);
                    planBtn.disabled = false;
                    return;
                }
            }
        }
    }
    
    // Find the first uncompleted point in the plan
    let firstUncompleted = null;
    for (let i = 0; i < state.distributorData.length; i++) {
        for (const mealName of MEAL_NAMES) {
            if (!state.distributorData[i].meals[mealName]?.completed) {
                firstUncompleted = { dayIndex: i, mealName: mealName };
                break;
            }
        }
        if (firstUncompleted) break;
    }

    if (!firstUncompleted) {
        // If everything is complete, but the user wants to ADD days, we can still proceed.
        if (newDuration > state.distributorData.length) {
             console.log("All existing meals are complete. Extending plan.");
             // Set the starting point to the first new day.
             firstUncompleted = { dayIndex: state.distributorData.length, mealName: MEAL_NAMES[0] };
        } else {
            alert("All meals are marked complete. Nothing to re-optimize!");
            planBtn.disabled = false;
            return;
        }
    }
    
    const foodMap = new Map(state.foodDatabase.map(f => [f.name, f]));

    // Calculate macros consumed on the first partially completed day
    const consumedOnPartialDay = { calories: 0, carbs: 0, addedSugar: 0, protein: 0, saturatedFat: 0, sodium: 0, fiber: 0 };
    if (state.distributorData[firstUncompleted.dayIndex]) {
        MEAL_NAMES.forEach(mealName => {
            const meal = state.distributorData[firstUncompleted.dayIndex].meals[mealName];
            if (!meal) return;
            
            if (meal.completed) {
                 meal.items.forEach(itemName => {
                    if (typeof itemName !== 'string') return;
                    const food = foodMap.get(itemName);
                    if (food) Object.keys(consumedOnPartialDay).forEach(macro => consumedOnPartialDay[macro] += food[macro] || 0);
                 });
            }
            // Also count custom meals on uncompleted slots of the first day
            meal.items.forEach(item => {
                if (item && item.isCustom) {
                     Object.keys(consumedOnPartialDay).forEach(macro => consumedOnPartialDay[macro] += item.macros[macro] || 0);
                }
            });
        });
    }

    // Calculate total consumption up to the first uncompleted day
    const consumedItemsCount = {};
    state.distributorData.forEach((day, dayIndex) => {
        if (dayIndex < firstUncompleted.dayIndex) {
            MEAL_NAMES.forEach(m => day.meals[m]?.items.forEach(i => {
                if (typeof i === 'string') consumedItemsCount[i] = (consumedItemsCount[i] || 0) + 1;
            }));
        } else if (dayIndex === firstUncompleted.dayIndex) {
            MEAL_NAMES.forEach(m => { 
                if(day.meals[m]?.completed) {
                    day.meals[m].items.forEach(i => {
                        if (typeof i === 'string') consumedItemsCount[i] = (consumedItemsCount[i] || 0) + 1;
                    });
                }
            });
        }
    });
    
    // Calculate remaining inventory
    const remainingInventory = state.foodDatabase.map(foodItem => {
        const remainingServings = foodItem.servings - (consumedItemsCount[foodItem.name] || 0);
        return remainingServings > 0 ? { ...foodItem, servings: remainingServings } : null;
    }).filter(Boolean);
    
    // Calculate dates for re-optimization
    const recalcStartDate = new Date(newStartDate.getTime() + firstUncompleted.dayIndex * MS_DAY);
    
    if (recalcStartDate > newEndDate) {
        alert("No future days left to re-optimize in the selected date range.");
        planBtn.disabled = false;
        // Trim the plan if needed
        state.distributorData.splice(newDuration);
        state.currentPlan.planParameters.endDate = isoDate(newEndDate);
        state.currentPlan.planParameters.duration = newDuration;
        renderPlanResults(state.currentPlan);
        renderDistributorGrid();
        state.saveState();
        return;
    }

    alert("Updating the plan based on your new configuration. Please wait...");

    const recalcResult = await generatePlan(true, {
        startDate: recalcStartDate, 
        endDate: newEndDate, // Use new end date from config
        macroGoals: config.macros, // Use new macros from config
        inventory: remainingInventory, 
        consumedOnPartialDay, 
        allowShopping: config.allowShopping, // Use new shopping setting from config
        strength: config.strength // Use new strength from config
    });

    if (recalcResult?.dailySchedule) {
        // --- Update the distributorData with the new plan ---
        
        // 1. Resize distributorData array if dates changed
        if (state.distributorData.length > newDuration) {
            state.distributorData.splice(newDuration); // Shorten
        } else {
            while (state.distributorData.length < newDuration) { // Lengthen
                const dayMeals = {};
                MEAL_NAMES.forEach(name => dayMeals[name] = { items: [], completed: false });
                state.distributorData.push({ day: state.distributorData.length + 1, meals: dayMeals });
            }
        }
        
        // 2. Clear all *uncompleted* meals from the starting point
        state.distributorData.forEach((day, dayIndex) => {
            if (dayIndex >= firstUncompleted.dayIndex) {
                MEAL_NAMES.forEach(mealName => {
                    const meal = day.meals[mealName];
                    if (meal && !meal.completed) {
                        meal.items = meal.items.filter(item => item && item.isCustom); // Keep custom items
                    }
                });
            }
        });

        // 3. Distribute the new items
        recalcResult.dailySchedule.forEach((newDayItems, i) => {
            const targetDayIndex = firstUncompleted.dayIndex + i;
            if (targetDayIndex < state.distributorData.length) {
                let mealIndex = 0;
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
        
        // --- Update the main `currentPlan` object ---
        const newTotalConsumption = { ...consumedItemsCount };
        for (const [name, count] of Object.entries(recalcResult.consumption)) {
            newTotalConsumption[name] = (newTotalConsumption[name] || 0) + count;
        }
        state.currentPlan.consumption = newTotalConsumption;
        
        // Update plan parameters to reflect the new reality
        state.currentPlan.planParameters = {
            startDate: isoDate(newStartDate),
            endDate: isoDate(newEndDate),
            duration: newDuration,
            originalGoals: config.macros
        };
        
        // Re-generate shopping list and waste analysis based on the NEW total plan
        const newShoppingList = [], newWasteAnalysis = { wasted: [], atRisk: [] };
        const masterInventoryMap = new Map(state.foodDatabase.map(item => [item.name, item]));

        Object.entries(newTotalConsumption).forEach(([name, totalNeeded]) => {
            const inventoryItem = masterInventoryMap.get(name);
            if (inventoryItem && inventoryItem.shoppable) {
                const onHand = inventoryItem.servings || 0;
                const toBuy = Math.max(0, totalNeeded - onHand);
                if (toBuy > 0) newShoppingList.push({ name, toBuy });
            }
        });

        state.foodDatabase.forEach(item => {
            const consumed = newTotalConsumption[item.name] || 0;
            const unscheduled = item.servings - consumed;
            if (unscheduled > 0) {
                 const expiryDate = parseDateString(item.expiration);
                if (expiryDate) {
                    const daysUntilExpiry = (expiryDate.getTime() - newStartDate.getTime()) / MS_DAY;
                    if (daysUntilExpiry < newDuration) {
                        newWasteAnalysis.wasted.push({ name: item.name, count: unscheduled });
                    }
                }
            }
        });
        
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
    
    // --- Determine Parameters (from state config or options object) ---
    const config = state.planConfig;
    const optimizationStrength = isRecalculation ? options.strength : config.strength;
    const shoppingAllowed = isRecalculation ? options.allowShopping : config.allowShopping;
    const startDate = isRecalculation ? options.startDate : parseDateString(config.startDate);
    const endDate = isRecalculation ? options.endDate : parseDateString(config.endDate);
    const sourceInventory = isRecalculation ? options.inventory : state.foodDatabase;
    const macroGoals = isRecalculation ? options.macroGoals : config.macros;
    
    let consumedOnPartialDay = null;
    if (isRecalculation) {
        consumedOnPartialDay = options.consumedOnPartialDay;
    } else if (state.distributorData.length > 0 && state.distributorData[0].meals) {
        const initialDayConsumption = { calories: 0, carbs: 0, addedSugar: 0, protein: 0, saturatedFat: 0, sodium: 0, fiber: 0 };
        MEAL_NAMES.forEach(mealName => {
            const meal = state.distributorData[0].meals[mealName];
            if (meal) {
                meal.items.forEach(item => {
                    if (item && item.isCustom) {
                        Object.keys(initialDayConsumption).forEach(macro => {
                            initialDayConsumption[macro] += item.macros[macro] || 0;
                        });
                    }
                });
            }
        });
        consumedOnPartialDay = initialDayConsumption;
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

    const gaParams = {
        generations: optimizationStrength,
        populationSize: 20,
        mutationStart: 1,
        mutationEnd: 0.2,
        initStrategy: 'greedy'
    };

    const updateProgress = async (generation, bestScore) => {
        summaryEl.innerHTML = `Optimizing...<br>
            <strong>Generation:</strong> ${generation + 1} / ${gaParams.generations}<br>
            <strong>Best Score (Penalty):</strong> ${bestScore.toFixed(2)}`;
        await new Promise(resolve => setTimeout(resolve, 0));
    };

    summaryEl.textContent = 'Preparing for optimization...';

    const planDurationDays = Math.round((endDate.getTime() - startDate.getTime()) / MS_DAY) + 1;
    
    let units = [];
    sourceInventory.forEach(item => {
        for (let i = 0; i < item.servings; i++) {
            units.push({ name: item.name, nutrients: item, maxPerDay: item.maxPerDay, expiration: item.expiration, isVirtual: false });
        }
    });

    if (shoppingAllowed) {
        const VIRTUAL_SHOPPING_POOL_SIZE = 15; 
        const masterInventory = state.foodDatabase;

        masterInventory.forEach(item => {
            if (item.shoppable) {
                for (let i = 0; i < VIRTUAL_SHOPPING_POOL_SIZE; i++) {
                    units.push({ name: item.name, nutrients: item, maxPerDay: item.maxPerDay, expiration: item.expiration, isVirtual: true });
                }
            }
        });
    }

    const planner = new GeneticAlgorithmPlanner(units, macroGoals, startDate, planDurationDays, gaParams, false, consumedOnPartialDay);
    const bestIndividual = await planner.run(updateProgress);
    
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
            const toBuy = Math.max(0, totalNeeded - onHand);
            if (toBuy > 0) {
                shoppingList.push({ name, toBuy });
            }
        }
    });

    const wasteAnalysis = { wasted: [], atRisk: [] };
    sourceInventory.forEach(item => {
        const consumed = onHandConsumption[item.name] || 0;
        const unscheduled = item.servings - consumed;
        if (unscheduled > 0) {
            const expiryDate = parseDateString(item.expiration);
            if (expiryDate) {
                const daysUntilExpiry = (expiryDate.getTime() - startDate.getTime()) / MS_DAY;
                if (daysUntilExpiry < planDurationDays) {
                    wasteAnalysis.wasted.push({ name: item.name, count: unscheduled });
                } else {
                    const consumptionRate = consumed / planDurationDays;
                    const daysToEatRemainder = consumptionRate > 0 ? unscheduled / consumptionRate : Infinity;
                    if (planDurationDays + daysToEatRemainder > daysUntilExpiry) {
                        wasteAnalysis.atRisk.push({ name: item.name, count: unscheduled });
                    }
                }
            }
        }
    });

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