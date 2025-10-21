import MACRO_DEFINITIONS from './macros.js';

// --- CONSTANTS ---

export const MS_DAY = 24 * 60 * 60 * 1000;
export const MEAL_NAMES = ["Breakfast", "Lunch", "Dinner", "Snack"];

// Dynamically generate MACROS array and MACRO_WEIGHTS object from the config file
export const MACROS = MACRO_DEFINITIONS.map(m => m.key);
export const MACRO_WEIGHTS = Object.fromEntries(MACRO_DEFINITIONS.map(m => [m.key, m.weight]));

export const PENALTY_SCALE_FACTOR = 5000;
export const WASTE_PENALTY = 10000;
export const URGENCY_PENALTY_FACTOR = 5000; // Note: Not used by GA, but kept for potential future use
export const LIMIT_VIOLATION_PENALTY = 8000;


// --- HELPER FUNCTIONS ---

/**
 * NEW: Converts a camelCase string to PascalCase.
 * e.g., "totalFat" -> "TotalFat"
 */
export function toPascalCase(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

export function parseDateString(s) {
    // --- FIX: If s is already a Date object, return it immediately. ---
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