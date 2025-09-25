// --- CONSTANTS ---

export const MS_DAY = 24 * 60 * 60 * 1000;
export const MEAL_NAMES = ["Breakfast", "Lunch", "Dinner", "Snack"];
export const MACROS = ["calories", "protein", "carbs", "fiber", "sugar", "saturatedFat", "sodium"];
export const MACRO_WEIGHTS = { calories: 1.0, protein: 0.8, carbs: 0.5, fiber: 0.6, sodium: 0.3, saturatedFat: 0.2, sugar: 0.2 };
export const PENALTY_SCALE_FACTOR = 5000;
export const WASTE_PENALTY = 10000;
export const URGENCY_PENALTY_FACTOR = 5000; // Note: Not used by GA, but kept for potential future use
export const LIMIT_VIOLATION_PENALTY = 8000;


// --- HELPER FUNCTIONS ---

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