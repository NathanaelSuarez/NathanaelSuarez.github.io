// ============================================================================== //
// MAIN.JS - MAIN ORCHESTRATOR
// ============================================================================== //
// This file is responsible for:
// 1. Importing primary modules.
// 2. Initializing the application on page load.
// 3. Setting up all primary event listeners.
// ============================================================================== //

import * as state from './state.js';
import * as utils from './utils.js';
import * as inventory from './inventory.js';
import * as planner from './planner.js';
import * as ui from './ui.js';
import * as distributor from './distributor.js';

/**
 * The main entry point for the application.
 * Runs once the DOM is fully loaded.
 */
function initializeApp() {
    // Load any saved data first
    state.loadState();
    
    // Set default values for date inputs only if they don't exist in loaded config
    if (!state.planConfig.startDate) {
        const today = new Date();
        document.getElementById('startDate').value = utils.isoDate(today);
        document.getElementById('endDate').value = utils.isoDate(new Date(today.getTime() + 13 * utils.MS_DAY));
    }

    // Populate the config form from loaded state
    ui.populateConfigForm();
    // Sync the state with the (potentially updated) form values and save
    state.setPlanConfig(ui.getPlanConfigFromUI());
    state.saveState();

    // Render the initial views based on loaded state
    ui.renderInventoryTable();
    if (state.currentPlan) {
        ui.renderPlanResults(state.currentPlan);
    }
    if (state.distributorData.length > 0) {
        ui.renderDistributorGrid();
    }
    
    // Set the starting tab
    ui.showTab('inventory');

    // Wire up all static event listeners
    addEventListeners();
}

/**
 * Centralizes all event listener assignments.
 */
function addEventListeners() {
    // --- Tab Navigation ---
    document.getElementById('tab-btn-inventory').addEventListener('click', () => ui.showTab('inventory'));
    document.getElementById('tab-btn-planner').addEventListener('click', () => ui.showTab('planner'));

    // --- Inventory Form & Actions ---
    document.getElementById('foodForm').addEventListener('submit', inventory.saveFood);
    document.getElementById('clearFormBtn').addEventListener('click', ui.resetForm);

    // --- Inventory Import/Export ---
    document.getElementById('loadJsonBtn').addEventListener('click', inventory.loadJSON);
    document.getElementById('exportJsonBtn').addEventListener('click', inventory.exportJSON);
    document.getElementById('downloadJsonBtn').addEventListener('click', inventory.downloadJSON);

    // --- Planner Actions ---
    document.getElementById('updatePlanBtn').addEventListener('click', planner.handlePlanUpdate);

    // --- NEW: Event listeners for config panel to ensure persistence ---
    const configPanel = document.querySelector('.config-column');
    configPanel.addEventListener('change', () => {
        state.setPlanConfig(ui.getPlanConfigFromUI());
        state.saveState();
    });

    // --- Event Delegation for Dynamic Elements ---
    // Handles clicks on buttons inside the inventory table (Edit, Delete, Duplicate)
    document.querySelector('#foodTable tbody').addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        const tr = button.closest('tr');
        const index = Array.from(tr.parentElement.children).indexOf(tr);

        if (button.textContent.includes('Duplicate')) inventory.duplicateFood(index);
        else if (button.textContent.includes('Edit')) inventory.editFood(index);
        else if (button.textContent.includes('Delete')) inventory.deleteFood(index);
    });
    
    // Handles clicks for 'Complete' buttons, '+ Custom' buttons, and delete buttons in the daily plan grid
    document.getElementById('plan-grid').addEventListener('click', e => {
        // Handle 'Complete' button clicks
        const completeBtn = e.target.closest('.complete-btn');
        if (completeBtn) {
            const list = completeBtn.closest('.meal-slot').querySelector('.food-list');
            const dayIndex = list.dataset.dayIndex;
            const mealName = list.dataset.mealName;

            if (dayIndex !== undefined && mealName) {
                distributor.toggleMealComplete(parseInt(dayIndex, 10), mealName);
            }
            return; // Stop further processing
        }

        // Handle '+ Custom' button clicks to open the modal
        if (e.target.classList.contains('add-custom-btn')) {
            const dayIndex = e.target.dataset.dayIndex;
            const mealName = e.target.dataset.mealName;
            
            // Populate hidden form fields
            document.getElementById('customMealDay').value = dayIndex;
            document.getElementById('customMealSlot').value = mealName;
            
            customMealModal.style.display = 'flex';
            return; // Stop further processing
        }

        // Handle deleting a custom meal
        const deleteBtn = e.target.closest('.delete-custom-meal');
        if (deleteBtn) {
            const dayIndex = parseInt(deleteBtn.dataset.dayIndex, 10);
            const mealName = deleteBtn.dataset.mealName;
            const itemIndex = parseInt(deleteBtn.dataset.itemIndex, 10);
            distributor.deleteCustomMeal(dayIndex, mealName, itemIndex);
        }
    });
}

// --- Custom Meal Modal ---
const customMealModal = document.getElementById('customMealModal');
const closeModalBtn = customMealModal.querySelector('.close-modal');
const customMealForm = document.getElementById('customMealForm');

// Close modal logic
const closeModal = () => {
    customMealModal.style.display = 'none';
    customMealForm.reset();
};
closeModalBtn.addEventListener('click', closeModal);
customMealModal.addEventListener('click', e => {
    if (e.target === customMealModal) {
        closeModal();
    }
});

// Handle custom meal form submission
customMealForm.addEventListener('submit', e => {
    e.preventDefault();
    const dayIndex = parseInt(document.getElementById('customMealDay').value, 10);
    const mealName = document.getElementById('customMealSlot').value;

    const customMeal = {
        isCustom: true,
        name: document.getElementById('customName').value,
        macros: {
            calories: parseFloat(document.getElementById('customCalories').value) || 0,
            protein: parseFloat(document.getElementById('customProtein').value) || 0,
            carbs: parseFloat(document.getElementById('customCarbs').value) || 0,
            fiber: parseFloat(document.getElementById('customFiber').value) || 0,
            addedSugar: parseFloat(document.getElementById('customAddedSugar').value) || 0,
            saturatedFat: parseFloat(document.getElementById('customSaturatedFat').value) || 0,
            sodium: parseFloat(document.getElementById('customSodium').value) || 0,
        }
    };

    distributor.addCustomMeal(dayIndex, mealName, customMeal);
    closeModal();
});

// Kick off the application once the page has loaded
document.addEventListener('DOMContentLoaded', initializeApp);