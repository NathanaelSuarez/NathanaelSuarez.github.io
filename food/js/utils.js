import MACRO_DEFINITIONS from './macros.js';

// --- CONSTANTS ---

export const MS_DAY = 24 * 60 * 60 * 1000;
export const MEAL_NAMES = ["Breakfast", "Lunch", "Dinner", "Snack"];

// Dynamically generate MACROS array and MACRO_WEIGHTS object from the config file
export const MACROS = MACRO_DEFINITIONS.map(m => m.key);
export const MACRO_WEIGHTS = Object.fromEntries(MACRO_DEFINITIONS.map(m => [m.key, m.weight]));

export const PENALTY_SCALE_FACTOR = 5000;

// UPDATED: Set to 20000 per your request.
export const WASTE_PENALTY = 50000; 

export const URGENCY_PENALTY_FACTOR = 5000; 
export const LIMIT_VIOLATION_PENALTY = 8000;

// --- DIVERSITY SETTINGS ---
// How much we penalize the plan for being boring
export const DIVERSITY_WEIGHT = 20000; 

// How many nutritionally distinct items we want in the plan (minimum)
export const MIN_UNIQUE_CLUSTERS = 40; 

// The 'distance' between foods required to consider them different.
// 0.0 = must be exact clones. 1.0 = extremely different.
// 0.15 is a sweet spot where "Chunky PB" and "Smooth PB" are the same, but "Apple" and "Banana" are different.
export const SIMILARITY_THRESHOLD = 0.05;


// --- HELPER FUNCTIONS ---

export function toPascalCase(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

export function parseDateString(s) {
    if (s instanceof Date && !isNaN(s)) return s;

    if (!s) return null;
    const parts = s.split('-').map(Number);
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    }
    const d = new Date(s);
    if (isNaN(d)) return null;
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export function isoDate(date) {
    if (!date instanceof Date || isNaN(date)) return '';
    return date.toISOString().slice(0, 10);
}