import * as state from './state.js';
import { renderDistributorGrid } from './ui.js';

export function toggleMealComplete(dayIndex, mealName) {
    if (state.distributorData[dayIndex] && state.distributorData[dayIndex].meals[mealName]) {
        state.distributorData[dayIndex].meals[mealName].completed = !state.distributorData[dayIndex].meals[mealName].completed;
        renderDistributorGrid();
    }
}

// ... rest of drag and drop logic is fine ...
// (ensure existing drag/drop logic is kept)
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

            // Allow drag over if target is NOT completed
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
            const targetMeal = state.distributorData[targetDayIndex].meals[targetMealName];

            // Prevent dropping into completed meal
            if (targetMeal && targetMeal.completed) {
                alert("Cannot move food into a completed meal.");
                return;
            }
            
            // Check source meal state (optional: prevent dragging OUT of completed meal?)
            // For now, allow dragging out, but user should toggle complete off first really.
            // But if they drag out, the re-optimization will just unlock that item. 
            
            const sourceMeal = state.distributorData[state.draggedItemInfo.dayIndex].meals[state.draggedItemInfo.mealName];
            const itemToMove = sourceMeal.items.splice(state.draggedItemInfo.itemIndex, 1)[0];
            targetMeal.items.push(itemToMove);

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