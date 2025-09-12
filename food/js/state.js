import { parseDateString } from './utils.js';

// Centralized application state
export let foodDatabase = [];
export let currentPlan = null;
export let distributorData = [];
export let editingIndex = null;
export let draggedItemInfo = null;

// Functions to modify state (if simple assignment isn't enough)
export function setFoodDatabase(data) { foodDatabase = data; }
export function setCurrentPlan(data) { currentPlan = data; }
export function setDistributorData(data) { distributorData = data; }
export function setEditingIndex(index) { editingIndex = index; }
export function setDraggedItemInfo(info) { draggedItemInfo = info; }


// --- LOCAL STORAGE ---

export function saveState() {
    try {
        localStorage.setItem('foodPlanner_database_v5', JSON.stringify(foodDatabase));
        localStorage.setItem('foodPlanner_plan_v5', JSON.stringify(currentPlan));
        localStorage.setItem('foodPlanner_distributor_v5', JSON.stringify(distributorData));
    } catch (e) {
        console.error("Failed to save state:", e);
    }
}

export function loadState() {
    // Load Inventory
    const savedDB = localStorage.getItem('foodPlanner_database_v5');
    if (savedDB) {
        try {
            foodDatabase = JSON.parse(savedDB) || [];
        } catch (e) {
            console.error("Failed to load inventory database from storage:", e);
            foodDatabase = [];
        }
    }

    // Load Plan
    const savedPlan = localStorage.getItem('foodPlanner_plan_v5');
    if (savedPlan) {
        try {
            currentPlan = JSON.parse(savedPlan);
            if (currentPlan && currentPlan.planParameters) {
                currentPlan.planParameters.startDate = parseDateString(currentPlan.planParameters.startDate);
                currentPlan.planParameters.endDate = parseDateString(currentPlan.planParameters.endDate);
            }
        } catch (e) {
            console.error("Failed to load current plan from storage:", e);
            currentPlan = null;
        }
    }

    // Load Distributor Data
    const savedDist = localStorage.getItem('foodPlanner_distributor_v5');
    if (savedDist) {
        try {
            distributorData = JSON.parse(savedDist) || [];
        } catch (e) {
            console.error("Failed to load distributor data from storage:", e);
            distributorData = [];
        }
    }
}