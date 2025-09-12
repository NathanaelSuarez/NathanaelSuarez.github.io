// ============================================================================== //
// APP.JS - MAIN ORCHESTRATOR
// ============================================================================== //
// This file is responsible for:
// 1. Importing all other modules.
// 2. Handling state persistence (saving to/loading from localStorage).
// 3. Initializing the application on page load.
// 4. Setting up all primary event listeners, replacing the old `onclick` attributes.
// ============================================================================== //

import * as state from './state.js';
import * as utils from './utils.js';
import * as inventory from './inventory.js';
import * as planner from './planner.js';
import * as ui from './ui.js';

// ============================================================================== //
// 1. STATE PERSISTENCE
// ============================================================================== //

/**
 * Saves the entire application state to localStorage.
 * This function is exported so other modules can call it after they modify the state.
 */
export function saveState() {
    try {
        localStorage.setItem('foodPlanner_database_v5', JSON.stringify(state.foodDatabase));
        localStorage.setItem('foodPlanner_plan_v5', JSON.stringify(state.currentPlan));
        localStorage.setItem('foodPlanner_distributor_v5', JSON.stringify(state.distributorData));
    } catch (e) {
        console.error("Failed to save state:", e);
    }
}

/**
 * Loads the application state from localStorage on startup.
 */
function loadState() {
    const savedDB = localStorage.getItem('foodPlanner_database_v5');
    const savedPlan = localStorage.getItem('foodPlanner_plan_v5');
    const savedDist = localStorage.getItem('foodPlanner_distributor_v5');

    if (savedDB) {
        try {
            state.setFoodDatabase(JSON.parse(savedDB) || []);
        } catch (e) {
            console.error("Failed to load inventory database from storage:", e);
            state.setFoodDatabase([]);
        }
    }

    if (savedPlan) {
        try {
            const plan = JSON.parse(savedPlan);
            if (plan && plan.planParameters) {
                // Re-hydrate date strings into Date objects
                plan.planParameters.startDate = utils.parseDateString(plan.planParameters.startDate);
                plan.planParameters.endDate = utils.parseDateString(plan.planParameters.endDate);
                state.setCurrentPlan(plan);
            }
        } catch (e) {
            console.error("Failed to load current plan from storage:", e);
            state.setCurrentPlan(null);
        }
    }

    if (savedDist) {
        try {
            state.setDistributorData(JSON.parse(savedDist) || []);
        } catch (e) {
            console.error("Failed to load distributor data from storage:", e);
            state.setDistributorData([]);
        }
    }
}

// ============================================================================== //
// 2. INITIALIZATION & EVENT LISTENERS
// ============================================================================== //

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
    loadState();

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
 * This replaces all `onclick=""` attributes in the HTML.
 */
function addEventListeners() {
    // --- Tab Navigation ---
    document.getElementById('tab-btn-inventory').addEventListener('click', () => ui.showTab('inventory'));
    document.getElementById('tab-btn-planner').addEventListener('click', () => ui.showTab('planner'));

    // --- Inventory Form & Actions ---
    document.getElementById('foodForm').addEventListener('submit', inventory.saveFood);
    document.getElementById('foodForm').querySelector('button[type="button"]').addEventListener('click', inventory.resetForm);

    // --- Inventory Import/Export ---
    document.querySelector('button[onclick*="loadJSON"]').onclick = inventory.loadJSON;
    document.querySelector('button[onclick*="exportJSON"]').onclick = inventory.exportJSON;
    document.querySelector('button[onclick*="downloadJSON"]').onclick = inventory.downloadJSON;


    // --- Planner Actions ---
    document.getElementById('planBtn').addEventListener('click', () => planner.generatePlan());
    document.getElementById('recalcBtn').addEventListener('click', ui.recalculatePlan);
    document.getElementById('commitPlanBtn').addEventListener('click', planner.commitPlanToInventory);

    // --- Event Delegation for Dynamic Elements ---
    // Handles clicks on buttons inside the inventory table (Edit, Delete, Duplicate)
    document.querySelector('#foodTable tbody').addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        // Find the index of the row the button is in
        const tr = button.closest('tr');
        const allRows = Array.from(tr.parentElement.children);
        const index = allRows.indexOf(tr);

        if (button.textContent.includes('Duplicate')) {
            inventory.duplicateFood(index);
        } else if (button.textContent.includes('Edit')) {
            inventory.editFood(index);
        } else if (button.textContent.includes('Delete')) {
            inventory.deleteFood(index);
        }
    });
    
    // Handles clicks for 'Complete' buttons in the daily plan grid
    // This is another example of event delegation
    document.getElementById('plan-grid').addEventListener('click', e => {
        const button = e.target.closest('.complete-btn');
        if (!button) return;

        // The rendering logic in ui.js should add these data attributes
        const mealSlot = button.closest('.meal-slot');
        const list = mealSlot.querySelector('.food-list');
        const dayIndex = list.dataset.dayIndex;
        const mealName = list.dataset.mealName;

        if (dayIndex !== undefined && mealName) {
            ui.toggleMealComplete(parseInt(dayIndex, 10), mealName);
        }
    });
}

// Kick off the application once the page has loaded
document.addEventListener('DOMContentLoaded', initializeApp);