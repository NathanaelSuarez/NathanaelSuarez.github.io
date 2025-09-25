import * as state from './state.js';
import { renderDistributorGrid, renderPlanResults } from './ui.js';
import { MEAL_NAMES, parseDateString, MS_DAY } from './utils.js';
import { generatePlan } from './planner.js';

export function toggleMealComplete(dayIndex, mealName) {
    if (state.distributorData[dayIndex] && state.distributorData[dayIndex].meals[mealName]) {
        state.distributorData[dayIndex].meals[mealName].completed = !state.distributorData[dayIndex].meals[mealName].completed;
        renderDistributorGrid();
    }
}

export function addDragDropListeners() {
    const lists = document.querySelectorAll('.food-list');
    const items = document.querySelectorAll('.food-list li');

    items.forEach(item => {
        item.addEventListener('dragstart', e => {
            // --- FIX: Use `item` from closure for guaranteed safety ---
            const list = item.closest('.food-list');
            const dayIndex = parseInt(list.dataset.dayIndex);
            const mealName = list.dataset.mealName;
            const itemIndex = parseInt(item.dataset.itemIndex);
            
            const info = { dayIndex, mealName, itemIndex, text: item.textContent };
            state.setDraggedItemInfo(info);
            item.classList.add('dragging');
            e.dataTransfer.setData('text/plain', JSON.stringify(info));
        });
        item.addEventListener('dragend', () => {
            // --- FIX: Use `item` from closure instead of e.target ---
            item.classList.remove('dragging');
            state.setDraggedItemInfo(null);
        });
    });

    lists.forEach(list => {
        list.addEventListener('dragover', e => {
            e.preventDefault();
            const targetDayIndex = parseInt(list.dataset.dayIndex);
            const targetMealName = list.dataset.mealName;

            if (state.distributorData[targetDayIndex].meals[targetMealName] && !state.distributorData[targetDayIndex].meals[targetMealName].completed) {
                list.classList.add('drag-over');
            } else {
                list.classList.remove('drag-over');
            }
        });
        list.addEventListener('dragleave', () => list.classList.remove('drag-over'));
        list.addEventListener('drop', e => {
            e.preventDefault();
            list.classList.remove('drag-over');

            if (!state.draggedItemInfo) return;

            const targetDayIndex = parseInt(list.dataset.dayIndex);
            const targetMealName = list.dataset.mealName;

            if (state.distributorData[targetDayIndex].meals[targetMealName] && state.distributorData[targetDayIndex].meals[targetMealName].completed) {
                alert("Cannot move food into a completed meal.");
                return;
            }
            
            const itemToMove = state.distributorData[state.draggedItemInfo.dayIndex].meals[state.draggedItemInfo.mealName].items.splice(state.draggedItemInfo.itemIndex, 1)[0];
            state.distributorData[targetDayIndex].meals[targetMealName].items.push(itemToMove);

            renderDistributorGrid();
        });
    });
}

export async function recalculatePlan() {
    if (!state.currentPlan) { alert("Generate a plan first."); return; }
    const allowShopping = confirm("Allow re-optimization to add new items to the shopping list?\n\n- Click OK (Yes) to find the best possible plan, which may require buying new food.\n- Click Cancel (No) to only use food you already have on hand.");
    const foodMap = new Map(state.foodDatabase.map(f => [f.name, f]));
    let firstUncompleted = null;

    for(let i = 0; i < state.distributorData.length; i++) {
        for(const mealName of MEAL_NAMES) {
            if (!state.distributorData[i].meals[mealName]?.completed && !firstUncompleted) {
                firstUncompleted = { dayIndex: i, mealName: mealName };
            }
        }
    }
    
    if (!firstUncompleted) {
        alert("All meals are marked complete. Nothing left to re-optimize!");
        return;
    }

    const consumedOnPartialDay = { calories: 0, carbs: 0, sugar: 0, protein: 0, saturatedFat: 0, sodium: 0, fiber: 0 };
    MEAL_NAMES.forEach(mealName => {
        const meal = state.distributorData[firstUncompleted.dayIndex].meals[mealName];
        if (meal?.completed) {
             meal.items.forEach(itemName => {
                const food = foodMap.get(itemName);
                if (food) Object.keys(consumedOnPartialDay).forEach(macro => consumedOnPartialDay[macro] += food[macro] || 0);
            });
        }
    });

    const consumedItemsCount = {};
    state.distributorData.forEach((day, dayIndex) => {
        if (dayIndex < firstUncompleted.dayIndex) {
            MEAL_NAMES.forEach(m => day.meals[m]?.items.forEach(i => consumedItemsCount[i] = (consumedItemsCount[i] || 0) + 1));
        } else if (dayIndex === firstUncompleted.dayIndex) {
            MEAL_NAMES.forEach(m => { if(day.meals[m]?.completed) day.meals[m].items.forEach(i => consumedItemsCount[i] = (consumedItemsCount[i] || 0) + 1) });
        }
    });
    
    const remainingInventory = state.foodDatabase.map(foodItem => {
        const remainingServings = foodItem.servings - (consumedItemsCount[foodItem.name] || 0);
        return remainingServings > 0 ? { ...foodItem, servings: remainingServings } : null;
    }).filter(Boolean);
    
    // This line will now work correctly due to the fix in utils.js
    const originalStartDate = parseDateString(state.currentPlan.planParameters.startDate);
    const recalcStartDate = new Date(originalStartDate.getTime() + firstUncompleted.dayIndex * MS_DAY);
    const recalcEndDate = parseDateString(state.currentPlan.planParameters.endDate);
    
    if (recalcStartDate > recalcEndDate) {
        alert("No future days left to re-optimize.");
        return;
    }

    const recalcStrength = parseInt(document.getElementById('recalcGenerations').value, 10) || 3;
    alert("Re-optimizing the remaining plan. Please wait...");

    const recalcResult = await generatePlan(true, {
        startDate: recalcStartDate, endDate: recalcEndDate,
        macroGoals: state.currentPlan.planParameters.originalGoals,
        inventory: remainingInventory, consumedOnPartialDay, allowShopping, strength: recalcStrength
    });

    if (recalcResult?.dailySchedule) {
        state.distributorData.forEach((day, dayIndex) => {
            if (dayIndex >= firstUncompleted.dayIndex) {
                MEAL_NAMES.forEach(mealName => {
                    if (day.meals[mealName] && !day.meals[mealName].completed) day.meals[mealName].items = [];
                });
            }
        });

        recalcResult.dailySchedule.forEach((newDayItems, i) => {
            const targetDayIndex = firstUncompleted.dayIndex + i;
            if (targetDayIndex < state.distributorData.length) {
                newDayItems.forEach((item, itemQueueIndex) => {
                    const mealName = MEAL_NAMES[itemQueueIndex % MEAL_NAMES.length];
                    const targetMeal = state.distributorData[targetDayIndex].meals[mealName];
                    if (targetMeal && !targetMeal.completed) targetMeal.items.push(item);
                });
            }
        });
        
        const newTotalConsumption = { ...consumedItemsCount };
        for (const [name, count] of Object.entries(recalcResult.consumption)) {
            newTotalConsumption[name] = (newTotalConsumption[name] || 0) + count;
        }
        state.currentPlan.consumption = newTotalConsumption;

        const newShoppingList = [], newWasteAnalysis = { wasted: [], atRisk: [] };
        const planDurationDays = state.currentPlan.planParameters.duration;
        const planStartDate = parseDateString(state.currentPlan.planParameters.startDate);
        
        state.foodDatabase.forEach(item => {
            const needed = newTotalConsumption[item.name] || 0;
            const toBuy = needed - item.servings;
            if (toBuy > 0 && item.shoppable) newShoppingList.push({ name: item.name, toBuy });
            const unscheduled = item.servings - (needed || 0);
            if (unscheduled > 0) {
                const expiryDate = parseDateString(item.expiration);
                if (expiryDate) {
                    const daysUntilExpiry = (expiryDate.getTime() - planStartDate.getTime()) / MS_DAY;
                    if (daysUntilExpiry < planDurationDays) newWasteAnalysis.wasted.push({ name: item.name, count: unscheduled });
                    else if (needed > 0) {
                        const daysToEatRemainder = unscheduled / (needed / planDurationDays);
                        if (planDurationDays + daysToEatRemainder > expiryDate) newWasteAnalysis.atRisk.push({ name: item.name, count: unscheduled });
                    } else newWasteAnalysis.atRisk.push({ name: item.name, count: unscheduled });
                }
            }
        });

        state.currentPlan.shoppingList = newShoppingList;
        state.currentPlan.wasteAnalysis = newWasteAnalysis;
        
        alert("Future plan has been re-optimized and updated!");
        renderPlanResults(state.currentPlan);
        renderDistributorGrid();
        state.saveState();
    } else alert("Re-optimization failed to produce a valid result.");
}