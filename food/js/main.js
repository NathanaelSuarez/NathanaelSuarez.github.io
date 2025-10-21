import * as state from './state.js';
import * as utils from './utils.js';
import * as inventory from './inventory.js';
import * as planner from './planner.js';
import * as ui from './ui.js';
import * as distributor from './distributor.js';
import MACRO_DEFINITIONS from './macros.js';

function initializeApp() {
    ui.generateMacroInputs();
    ui.generateInventoryForm(); 
    ui.generateCustomMealForm(); 
    
    state.loadState();
    
    if (!state.planConfig.startDate) {
        const today = new Date();
        document.getElementById('startDate').value = utils.isoDate(today);
        document.getElementById('endDate').value = utils.isoDate(new Date(today.getTime() + 13 * utils.MS_DAY));
    }

    ui.populateConfigForm();
    state.setPlanConfig(ui.getPlanConfigFromUI());
    state.saveState();

    ui.renderInventoryTable();
    if (state.currentPlan) {
        ui.renderPlanResults(state.currentPlan);
    }
    if (state.distributorData.length > 0) {
        ui.renderDistributorGrid();
    }
    
    ui.showTab('inventory');

    addEventListeners();
}

function addEventListeners() {
    // ... other event listeners are unchanged ...
    
    document.getElementById('tab-btn-inventory').addEventListener('click', () => ui.showTab('inventory'));
    document.getElementById('tab-btn-planner').addEventListener('click', () => ui.showTab('planner'));

    document.getElementById('foodForm').addEventListener('submit', inventory.saveFood);
    document.getElementById('clearFormBtn').addEventListener('click', ui.resetForm);

    document.getElementById('loadJsonBtn').addEventListener('click', inventory.loadJSON);
    document.getElementById('exportJsonBtn').addEventListener('click', inventory.exportJSON);
    document.getElementById('downloadJsonBtn').addEventListener('click', inventory.downloadJSON);

    document.getElementById('updatePlanBtn').addEventListener('click', planner.handlePlanUpdate);
    document.getElementById('finishPlanBtn').addEventListener('click', planner.finishPlan);

    const configPanel = document.querySelector('.config-column');
    configPanel.addEventListener('change', () => {
        state.setPlanConfig(ui.getPlanConfigFromUI());
        state.saveState();
    });

    document.querySelector('#foodTable tbody').addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        const tr = button.closest('tr');
        const index = Array.from(tr.parentElement.children).indexOf(tr);

        if (button.textContent.includes('Duplicate')) inventory.duplicateFood(index);
        else if (button.textContent.includes('Edit')) inventory.editFood(index);
        else if (button.textContent.includes('Delete')) inventory.deleteFood(index);
    });
    
    document.getElementById('plan-grid').addEventListener('click', e => {
        const completeBtn = e.target.closest('.complete-btn');
        if (completeBtn) {
            const list = completeBtn.closest('.meal-slot').querySelector('.food-list');
            const dayIndex = list.dataset.dayIndex;
            const mealName = list.dataset.mealName;

            if (dayIndex !== undefined && mealName) {
                distributor.toggleMealComplete(parseInt(dayIndex, 10), mealName);
            }
            return;
        }

        if (e.target.classList.contains('add-custom-btn')) {
            const dayIndex = e.target.dataset.dayIndex;
            const mealName = e.target.dataset.mealName;
            
            document.getElementById('customMealDay').value = dayIndex;
            document.getElementById('customMealSlot').value = mealName;
            
            customMealModal.style.display = 'flex';
            return;
        }

        const editBtn = e.target.closest('.edit-custom-meal');
        if (editBtn) {
            const dayIndex = parseInt(editBtn.dataset.dayIndex, 10);
            const mealName = editBtn.dataset.mealName;
            const itemIndex = parseInt(editBtn.dataset.itemIndex, 10);
            const mealToEdit = state.distributorData[dayIndex].meals[mealName].items[itemIndex];

            document.getElementById('customMealDay').value = dayIndex;
            document.getElementById('customMealSlot').value = mealName;
            document.getElementById('customMealItemIndex').value = itemIndex;

            document.getElementById('customName').value = mealToEdit.name;
            
            MACRO_DEFINITIONS.forEach(macro => {
                const inputId = `custom${utils.toPascalCase(macro.key)}`;
                const inputEl = document.getElementById(inputId);
                if (inputEl) {
                    inputEl.value = mealToEdit.macros[macro.key] || '';
                }
            });

            document.getElementById('customMealModalTitle').textContent = 'Edit Custom Meal Item';
            document.getElementById('customMealSubmitBtn').textContent = 'Update Item';

            customMealModal.style.display = 'flex';
            return;
        }

        const deleteBtn = e.target.closest('.delete-custom-meal');
        if (deleteBtn) {
            const dayIndex = parseInt(deleteBtn.dataset.dayIndex, 10);
            const mealName = deleteBtn.dataset.mealName;
            const itemIndex = parseInt(deleteBtn.dataset.itemIndex, 10);
            distributor.deleteCustomMeal(dayIndex, mealName, itemIndex);
        }
    });
}

// ... closeModal logic is unchanged ...

const customMealModal = document.getElementById('customMealModal');
const closeModalBtn = customMealModal.querySelector('.close-modal');
const customMealForm = document.getElementById('customMealForm');

const closeModal = () => {
    customMealModal.style.display = 'none';
    customMealForm.reset();
    document.getElementById('customMealItemIndex').value = ''; 
    document.getElementById('customMealModalTitle').textContent = 'Add Custom Meal Item';
    document.getElementById('customMealSubmitBtn').textContent = 'Add Custom Item';
};
closeModalBtn.addEventListener('click', closeModal);

// Handle custom meal form submission
customMealForm.addEventListener('submit', e => {
    e.preventDefault();
    const dayIndex = parseInt(document.getElementById('customMealDay').value, 10);
    const mealName = document.getElementById('customMealSlot').value;
    const itemIndex = document.getElementById('customMealItemIndex').value;

    const macros = {};
    // <-- CHANGE: Removed the line that was incorrectly excluding 'cost' -->
    MACRO_DEFINITIONS.forEach(macro => {
        const inputId = `custom${utils.toPascalCase(macro.key)}`;
        macros[macro.key] = parseFloat(document.getElementById(inputId).value) || 0;
    });

    const customMeal = {
        isCustom: true,
        name: document.getElementById('customName').value,
        macros: macros
    };

    if (itemIndex !== '') {
        distributor.updateCustomMeal(dayIndex, mealName, parseInt(itemIndex, 10), customMeal);
    } else {
        distributor.addCustomMeal(dayIndex, mealName, customMeal);
    }
    
    closeModal();
});

document.addEventListener('DOMContentLoaded', initializeApp);