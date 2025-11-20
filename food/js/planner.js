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
import { renderPlanResults, renderDistributorGrid, renderInventoryTable } from './ui.js';
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
    
    // =========================================================================
    // NEW: FIND THE LAST COMPLETED MEAL TO INFER CONSUMPTION
    // This makes the re-optimizer robust against forgotten completions.
    // =========================================================================
    let lastCompletedPoint = null;
    // Iterate backwards from the last day and last meal to find the final completed point.
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
        console.log(`Last completed meal found at Day ${lastCompletedPoint.dayIndex + 1}, ${lastCompletedPoint.mealName}. Assuming all prior meals are also consumed.`);
        
        // 1. Calculate implicitly consumed items based on the last completed meal
        const lastMealIndex = MEAL_NAMES.indexOf(lastCompletedPoint.mealName);
        for (let dayIndex = 0; dayIndex <= lastCompletedPoint.dayIndex; dayIndex++) {
            MEAL_NAMES.forEach((mealName, mealIndex) => {
                // A meal is considered consumed if it's on a day before the last completed day,
                // OR if it's on the same day but at or before the last completed meal.
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

        // 2. Determine the first uncompleted point for re-planning (the meal after the last completed one)
        const nextMealIndex = lastMealIndex + 1;
        if (nextMealIndex < MEAL_NAMES.length) {
            firstUncompleted = { dayIndex: lastCompletedPoint.dayIndex, mealName: MEAL_NAMES[nextMealIndex] };
        } else {
            firstUncompleted = { dayIndex: lastCompletedPoint.dayIndex + 1, mealName: MEAL_NAMES[0] };
        }

    } else {
        // Fallback to original logic if no meals are marked complete.
        console.log("No completed meals found. Finding first uncompleted meal literally.");
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

    // If no uncompleted point was found (everything is implicitly or explicitly complete)
    if (!firstUncompleted || firstUncompleted.dayIndex >= state.distributorData.length) {
        if (newDuration > state.distributorData.length) {
             console.log("All existing meals are complete. Extending plan.");
             firstUncompleted = { dayIndex: state.distributorData.length, mealName: MEAL_NAMES[0] };
        } else {
            alert("All meals are marked as complete or are before the last completed meal. Nothing to re-optimize!");
            planBtn.disabled = false;
            return;
        }
    }
    
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

    // Calculate macros and item counts consumed on the partial day to guide the re-optimizer
    const foodMap = new Map(state.foodDatabase.map(f => [f.name, f]));
    let consumedOnPartialDay = null;
    if (firstUncompleted && firstUncompleted.dayIndex < state.distributorData.length) {
        const dayOfRecalc = state.distributorData[firstUncompleted.dayIndex];
        const partialDayMacros = Object.fromEntries(MACROS.map(key => [key, 0]));
        const partialDayItemCounts = {};
        const firstUncompletedMealIndex = MEAL_NAMES.indexOf(firstUncompleted.mealName);

        // Sum macros for all meals on the starting day that occurred BEFORE the re-planning point.
        for (let i = 0; i < firstUncompletedMealIndex; i++) {
            const mealName = MEAL_NAMES[i];
            const meal = dayOfRecalc.meals[mealName];
            if (meal?.items) {
                meal.items.forEach(item => {
                    const foodData = (typeof item === 'string') ? foodMap.get(item) : (item.isCustom ? item : null);
                    if (foodData) {
                        if (typeof item === 'string') {
                            partialDayItemCounts[item] = (partialDayItemCounts[item] || 0) + 1;
                        }
                        const nutrients = foodData.isCustom ? foodData.macros : foodData;
                        MACROS.forEach(macro => {
                            partialDayMacros[macro] += nutrients[macro] || 0;
                        });
                    }
                });
            }
        }

        // Only create the object if there was actual consumption.
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
        // --- Update the distributorData with the new plan ---
        
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
                        // Clear out old, non-custom items from the re-planned section
                        meal.items = meal.items.filter(item => item && item.isCustom);
                    }
                });
            }
        });

        recalcResult.dailySchedule.forEach((newDayItems, i) => {
            const targetDayIndex = firstUncompleted.dayIndex + i;
            if (targetDayIndex < state.distributorData.length) {
                let mealIndex = 0;
                newDayItems.forEach(item => {
                    let mealAssigned = false, attempts = 0;
                    while (!mealAssigned && attempts < MEAL_NAMES.length) {
                        const mealName = MEAL_NAMES[mealIndex % MEAL_NAMES.length];
                        const targetMeal = state.distributorData[targetDayIndex].meals[mealName];
                        // Add item to the first available (uncompleted) meal slot
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
        
        state.currentPlan.planParameters = {
            startDate: isoDate(newStartDate),
            endDate: isoDate(newEndDate),
            duration: newDuration,
            originalGoals: config.macros
        };
        
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
    
    // --- Determine Parameters ---
    const config = state.planConfig;
    const optimizationStrength = isRecalculation ? options.strength : config.strength;
    const shoppingAllowed = isRecalculation ? options.allowShopping : config.allowShopping;
    const startDate = isRecalculation ? options.startDate : parseDateString(config.startDate);
    const endDate = isRecalculation ? options.endDate : parseDateString(config.endDate);
    const sourceInventory = isRecalculation ? options.inventory : state.foodDatabase;
    const macroGoals = isRecalculation ? options.macroGoals : config.macros;
    
    let consumedOnPartialDay = isRecalculation ? options.consumedOnPartialDay : null;

    // This logic applies to a fresh plan generation, to account for pre-added custom meals on day 1.
    if (!isRecalculation && state.distributorData.length > 0 && state.distributorData[0].meals) {
        const initialDayMacros = Object.fromEntries(MACROS.map(key => [key, 0]));
        const initialDayItemCounts = {};
        MEAL_NAMES.forEach(mealName => {
            const meal = state.distributorData[0].meals[mealName];
            if (meal) {
                meal.items.forEach(item => {
                    if (item && item.isCustom) {
                        // Custom items don't have a DB entry for maxPerDay, but we track their name
                        // in case a user manually enters an item that shares a name with a DB item.
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

    const gaParams = {
        generations: optimizationStrength,
        populationSize: 50,
        mutationStart: 0.6,
        mutationEnd: 0.1
    };
    
    const planDurationDays = Math.round((endDate.getTime() - startDate.getTime()) / MS_DAY) + 1;

    // --- FIX: Implement Normalization in the Progress Display ---
    const updateProgress = async (generation, bestScore) => {
        // Divide the total score by the number of days being planned.
        // Use Math.max(1, ...) to prevent division by zero if planDuration is somehow 0.
        const normalizedScore = bestScore / Math.max(1, planDurationDays);

        summaryEl.innerHTML = `Optimizing...<br>
            <strong>Generation:</strong> ${generation + 1} / ${gaParams.generations}<br>
            <strong>Avg. Daily Score (Penalty):</strong> ${normalizedScore.toFixed(2)}`;
        
        await new Promise(resolve => setTimeout(resolve, 0));
    };

    summaryEl.textContent = 'Preparing for optimization...';
    
    let units = [];
    sourceInventory.forEach(item => {
        for (let i = 0; i < item.servings; i++) {
            units.push({ name: item.name, nutrients: item, maxPerDay: item.maxPerDay, expiration: item.expiration, isVirtual: false });
        }
    });

    if (shoppingAllowed) {
        // OLD: const VIRTUAL_SHOPPING_POOL_SIZE = 100;
        // Using a fixed, large number created an enormous search space for the
        // optimizer, leading to slow convergence and poor performance.
        // NEW: The virtual pool size is now dynamic, based on the plan's duration.
        // This provides a sufficient but not excessive number of shoppable items,
        // dramatically reducing the GA's search space and leading to faster,
        // more effective optimization.
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
                    // Only count non-custom, string-based items that are in the inventory
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