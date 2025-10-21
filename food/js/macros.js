/**
 * ===================================================================
 * MACRO DEFINITIONS
 * ===================================================================
 * This is the single source of truth for all nutritional macros.
 * To add a new macro, simply add a new object to this array.
 *
 * Each object needs the following properties:
 * - key:          The internal JavaScript key (camelCase).
 * - displayName:  The user-facing name for labels and titles.
 * - unit:         The unit of measurement (e.g., 'g', 'mg', 'kcal').
 * - idPrefix:     A short, unique prefix used to build HTML element IDs (e.g., 'cal' -> calMin, calMax).
 * - defaultMin:   The default minimum value for the planner form.
 * - defaultMax:   The default maximum value for the planner form. Use a high number for no practical max.
 * - weight:       The importance weight for the genetic algorithm's fitness calculation.
 */
const MACRO_DEFINITIONS = [
    {
        key: 'calories',
        displayName: 'Calories',
        unit: 'kcal',
        idPrefix: 'cal',
        defaultMin: 1900,
        defaultMax: 2100,
        weight: 4.0
    },
    {
        key: 'protein',
        displayName: 'Protein',
        unit: 'g',
        idPrefix: 'protein',
        defaultMin: 100,
        defaultMax: 150,
        weight: 0.9
    },
    {
        key: 'carbs',
        displayName: 'Carbs',
        unit: 'g',
        idPrefix: 'carb',
        defaultMin: 150,
        defaultMax: 280,
        weight: 0.7
    },
    {
        key: 'totalFat',
        displayName: 'Total Fat',
        unit: 'g',
        idPrefix: 'totalFat',
        defaultMin: 50,
        defaultMax: 75,
        weight: 0.7
    },
    {
        key: 'saturatedFat',
        displayName: 'Saturated Fat',
        unit: 'g',
        idPrefix: 'sat',
        defaultMin: 0,
        defaultMax: 13,
        weight: 0.5
    },
    {
        key: 'transFat',
        displayName: 'Trans Fat',
        unit: 'g',
        idPrefix: 'transFat',
        defaultMin: 0,
        defaultMax: 0,
        weight: 0.8
    },
    {
        key: 'fiber',
        displayName: 'Fiber',
        unit: 'g',
        idPrefix: 'fiber',
        defaultMin: 28,
        defaultMax: 40,
        weight: 0.6
    },
    {
        key: 'totalSugars',
        displayName: 'Total Sugars',
        unit: 'g',
        idPrefix: 'totalSugars',
        defaultMin: 0,
        defaultMax: 100,
        weight: 0.3
    },
    {
        key: 'addedSugar',
        displayName: 'Added Sugar',
        unit: 'g',
        idPrefix: 'addedSugar',
        defaultMin: 0,
        defaultMax: 20,
        weight: 0.8
    },
    {
        key: 'sodium',
        displayName: 'Sodium',
        unit: 'mg',
        idPrefix: 'sodium',
        defaultMin: 500,
        defaultMax: 1500,
        weight: 0.6
    },
    {
        key: 'cholesterol',
        displayName: 'Cholesterol',
        unit: 'mg',
        idPrefix: 'cholesterol',
        defaultMin: 0,
        defaultMax: 300,
        weight: 0.3
    },
    {
        key: 'potassium',
        displayName: 'Potassium',
        unit: 'mg',
        idPrefix: 'potassium',
        defaultMin: 3000,
        defaultMax: 4700,
        weight: 0.5
    },
    {
        key: 'calcium',
        displayName: 'Calcium',
        unit: 'mg',
        idPrefix: 'calcium',
        defaultMin: 1000,
        defaultMax: 2500,
        weight: 0.4
    },
    {
        key: 'iron',
        displayName: 'Iron',
        unit: 'mg',
        idPrefix: 'iron',
        defaultMin: 20,
        defaultMax: 45,
        weight: 0.5
    },
    {
        key: 'vitaminD',
        displayName: 'Vitamin D',
        unit: 'mcg',
        idPrefix: 'vitaminD',
        defaultMin: 15,
        defaultMax: 100,
        weight: 0.4
    },
    {
        key: 'cost',
        displayName: 'Cost',
        unit: '$ Per serving',
        idPrefix: 'cost',
        defaultMin: 0,
        defaultMax: 3,
        weight: 1.0
    }
];

export default MACRO_DEFINITIONS;