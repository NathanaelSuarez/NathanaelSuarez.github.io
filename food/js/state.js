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

/**
 * Safely saves the application state to localStorage.
 * Uses a custom replacer to ensure Date objects are serialized as YYYY-MM-DD strings.
 * Saves each part independently — failure in one doesn't wipe others.
 */
export function saveState() {
    try {
        // Serialize inventory
        const dbJson = JSON.stringify(foodDatabase);
        
        // Serialize plan with Date-to-string conversion
        const planJson = JSON.stringify(currentPlan, (key, value) => {
            if (value instanceof Date && !isNaN(value)) {
                return value.toISOString().slice(0, 10); // "YYYY-MM-DD"
            }
            return value;
        });
        
        // Serialize distributor
        const distJson = JSON.stringify(distributorData);

        // Only save if serialization produced valid strings
        if (dbJson !== undefined) {
            localStorage.setItem('foodPlanner_database_v5', dbJson);
        }
        if (planJson !== undefined) {
            localStorage.setItem('foodPlanner_plan_v5', planJson);
        }
        if (distJson !== undefined) {
            localStorage.setItem('foodPlanner_distributor_v5', distJson);
        }

    } catch (e) {
        console.error("🚨 Failed to save state:", e);
        alert("⚠️ Warning: Could not save current state. Your changes may be lost if you refresh or close the tab.");
    }
}

/**
 * Loads state from localStorage with defensive checks and type validation.
 * Converts date strings back to Date objects where needed.
 */
export function loadState() {
    // Load Inventory
    const savedDB = localStorage.getItem('foodPlanner_database_v5');
    if (savedDB) {
        try {
            const parsed = JSON.parse(savedDB);
            if (Array.isArray(parsed)) {
                foodDatabase = parsed;
            } else {
                console.warn("Loaded inventory is not an array. Resetting to empty.");
                foodDatabase = [];
            }
        } catch (e) {
            console.error("Failed to load inventory database:", e);
            foodDatabase = [];
        }
    }

    // Load Plan
    const savedPlan = localStorage.getItem('foodPlanner_plan_v5');
    if (savedPlan) {
        try {
            const parsed = JSON.parse(savedPlan);
            if (parsed && typeof parsed === 'object') {
                currentPlan = parsed;
                // Convert date strings back to Date objects
                if (currentPlan.planParameters?.startDate) {
                    currentPlan.planParameters.startDate = parseDateString(currentPlan.planParameters.startDate);
                }
                if (currentPlan.planParameters?.endDate) {
                    currentPlan.planParameters.endDate = parseDateString(currentPlan.planParameters.endDate);
                }
            } else {
                console.warn("Loaded plan is invalid. Ignoring.");
                currentPlan = null;
            }
        } catch (e) {
            console.error("Failed to load current plan:", e);
            currentPlan = null;
        }
    }

    // Load Distributor Data
    const savedDist = localStorage.getItem('foodPlanner_distributor_v5');
    if (savedDist) {
        try {
            const parsed = JSON.parse(savedDist);
            if (Array.isArray(parsed)) {
                distributorData = parsed;
            } else {
                console.warn("Loaded distributor data is not an array. Resetting to empty.");
                distributorData = [];
            }
        } catch (e) {
            console.error("Failed to load distributor data:", e);
            distributorData = [];
        }
    }
}