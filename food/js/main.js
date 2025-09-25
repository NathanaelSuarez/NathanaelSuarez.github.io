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
    // Set default values for date inputs
    const today = new Date();
    document.getElementById('startDate').value = utils.isoDate(today);
    document.getElementById('endDate').value = utils.isoDate(new Date(today.getTime() + 13 * utils.MS_DAY));

    // Load any saved data
    state.loadState();

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
    document.getElementById('planBtn').addEventListener('click', () => planner.generatePlan());
    document.getElementById('recalcBtn').addEventListener('click', distributor.recalculatePlan);

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
    
    // Handles clicks for 'Complete' buttons in the daily plan grid
    document.getElementById('plan-grid').addEventListener('click', e => {
        const button = e.target.closest('.complete-btn');
        if (!button) return;
        const list = button.closest('.meal-slot').querySelector('.food-list');
        const dayIndex = list.dataset.dayIndex;
        const mealName = list.dataset.mealName;

        if (dayIndex !== undefined && mealName) {
            distributor.toggleMealComplete(parseInt(dayIndex, 10), mealName);
        }
    });
}

// Kick off the application once the page has loaded
document.addEventListener('DOMContentLoaded', initializeApp);