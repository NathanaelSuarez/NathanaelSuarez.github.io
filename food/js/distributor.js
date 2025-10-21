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
    const items = document.querySelectorAll('.food-list li[draggable="true"]');

    items.forEach(item => {
        item.addEventListener('dragstart', e => {
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

export function addCustomMeal(dayIndex, mealName, customMeal) {
    if (state.distributorData[dayIndex] && state.distributorData[dayIndex].meals[mealName]) {
        state.distributorData[dayIndex].meals[mealName].items.push(customMeal);
        renderDistributorGrid();
    }
}

export function updateCustomMeal(dayIndex, mealName, itemIndex, updatedMeal) {
    if (state.distributorData[dayIndex]?.meals[mealName]?.items[itemIndex]) {
        state.distributorData[dayIndex].meals[mealName].items[itemIndex] = updatedMeal;
        renderDistributorGrid();
    }
}

export function deleteCustomMeal(dayIndex, mealName, itemIndex) {
    if (state.distributorData[dayIndex] && state.distributorData[dayIndex].meals[mealName]) {
        state.distributorData[dayIndex].meals[mealName].items.splice(itemIndex, 1);
        renderDistributorGrid();
    }
}