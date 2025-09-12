// ============================================================================== //
// PLANNER.JS - MEAL PLAN GENERATION AND MANAGEMENT
// ============================================================================== //
// This file is responsible for:
// 1. Orchestrating the meal plan generation using the QPOptimizer.
// 2. Handling the user's input for plan parameters (dates, macro goals, optimization strength).
// 3. Processing the optimizer's output to create the daily schedule, shopping list, and waste analysis.
// 4. Updating the application state with the new plan.
// 5. Providing the functionality to commit the plan to the inventory.
// ============================================================================== //

import * as state from './state.js';
import { MS_DAY, parseDateString, isoDate, MEAL_NAMES } from './utils.js';
import { renderPlanResults, renderDistributorGrid, renderInventoryTable, showTab } from './ui.js';
import QPOptimizer from './optimizer.js';

/**
 * Populates the distributorData state from a newly generated plan's daily schedule.
 * Each day in the plan gets a corresponding entry in distributorData, with meals
 * initially marked as not completed.
 */
function populateDistributorFromPlan() {
    if (!state.currentPlan || !state.currentPlan.dailySchedule) {
        alert("No plan generated yet. Please generate a plan on the 'Create & View Plan' tab first.");
        return;
    }
    const distributor = [];
    state.currentPlan.dailySchedule.forEach((dayItems, dayIndex) => {
        const dayMeals = {};
        // Initialize all meal slots for the day
        MEAL_NAMES.forEach(name => dayMeals[name] = { items: [], completed: false });

        // Distribute planned items across meal slots
        dayItems.forEach((item, itemQueueIndex) => {
            const mealName = MEAL_NAMES[itemQueueIndex % MEAL_NAMES.length];
            dayMeals[mealName].items.push(item);
        });
        distributor.push({ day: dayIndex + 1, meals: dayMeals });
    });
    state.setDistributorData(distributor);
}

/**
 * Generates a new meal plan based on user configuration or recalculation parameters.
 * @param {boolean} isRecalculation - True if this is a re-optimization of an existing plan.
 * @param {object} [recalcParams={}] - Parameters specific to recalculation (startDate, endDate, etc.).
 * @returns {Promise<object|void>} - Returns plan data if successful during recalculation, otherwise updates state.
 */
export async function generatePlan(isRecalculation = false, recalcParams = {}) {
    console.log(`%c--- Starting Plan Generation with QP (${isRecalculation ? 'Recalculation' : 'Initial'}) ---`, 'color: blue; font-weight: bold;');
    const planBtn = document.getElementById('planBtn');
    const summaryEl = document.getElementById('planSummary');

    // Pre-check for inventory when not recalculating
    if (state.foodDatabase.length === 0 && !isRecalculation) {
        alert("Please add food to your inventory (Tab 1) first.");
        return;
    }

    planBtn.disabled = true; // Disable button to prevent multiple submissions
    
    // Determine optimization strength and allow shopping setting
    const optimizationStrength = isRecalculation ?
        recalcParams.strength :
        parseInt(document.getElementById('numGenerations').value, 10) || 5;
    
    // NEW: Read the "Allow Shopping" checkbox state
    const shoppingAllowed = isRecalculation ?
        recalcParams.allowShopping :
        document.getElementById('allowShopping').checked;
    
    const { consumedOnPartialDay } = recalcParams; // Only relevant for recalculation

    summaryEl.textContent = `Starting plan optimization with strength ${optimizationStrength}...`;

    // Determine plan dates
    const startDate = isRecalculation ? recalcParams.startDate : parseDateString(document.getElementById('startDate').value);
    const endDate = isRecalculation ? recalcParams.endDate : parseDateString(document.getElementById('endDate').value);
    
    // Validate date range
    if (!startDate || !endDate || endDate < startDate) {
        alert("Invalid date range selected. Ensure Start Date is before or on End Date.");
        planBtn.disabled = false;
        summaryEl.textContent = 'Plan generation failed: Invalid dates.';
        return;
    }
    
    const planDurationDays = Math.round((endDate.getTime() - startDate.getTime()) / MS_DAY) + 1;
    
    // Define macro goals
    const macroIdMap = { calories: 'cal', carbs: 'carb', sugar: 'sugar', protein: 'protein', saturatedFat: 'sat', sodium: 'sodium', fiber: 'fiber' };
    const macros = Object.keys(macroIdMap);
    const macroGoals = isRecalculation ? recalcParams.macroGoals : {};

    if (!isRecalculation) {
        // For initial plan generation, read goals from UI
        let configError = false;
        macros.forEach(m => {
            const idPrefix = macroIdMap[m];
            const minEl = document.getElementById(idPrefix + 'Min');
            const maxEl = document.getElementById(idPrefix + 'Max');
            if (!minEl || !maxEl) {
                console.error(`Missing HTML input for macro: ${m} (ID prefix: ${idPrefix})`);
                configError = true;
                return;
            }
            macroGoals[m] = { min: Number(minEl.value || 0), max: Number(maxEl.value || Infinity) };
        });
        if (configError) {
            alert("Configuration error: Some macro goal inputs are missing. Check console.");
            planBtn.disabled = false;
            summaryEl.textContent = 'Plan generation failed: Configuration error.';
            return;
        }
    }
    
    // Prepare units for the optimizer
    const inventoryForOpt = isRecalculation ? recalcParams.inventory : state.foodDatabase;
    let units = [];
    inventoryForOpt.forEach((item, index) => {
        const itemData = { itemIndex: index, name: item.name, nutrients: item, expiration: parseDateString(item.expiration), maxPerDay: item.maxPerDay };
        // Add all on-hand servings as individual units
        for (let i = 0; i < item.servings; i++) {
            units.push({ ...itemData, type: 'on-hand' });
        }
        // NEW: Conditionally add virtual (shoppable) units based on 'shoppingAllowed'
        if (item.shoppable && shoppingAllowed) {
            // Add a large number of 'virtual' units for shoppable items
            // This allows the optimizer to "buy" them if needed
            for (let i = 0; i < 200; i++) { 
                units.push({ ...itemData, type: 'virtual' });
            }
        }
    });

    // Adjust macro goals for the first day during recalculation if some meals are already consumed
    if (consumedOnPartialDay) {
        const adjustedGoals = JSON.parse(JSON.stringify(macroGoals));
        Object.keys(consumedOnPartialDay).forEach(macro => {
            if (adjustedGoals[macro]) {
                adjustedGoals[macro].min = Math.max(0, adjustedGoals[macro].min - consumedOnPartialDay[macro]);
                adjustedGoals[macro].max = Math.max(0, adjustedGoals[macro].max - consumedOnPartialDay[macro]);
            }
        });
        // Store adjusted goals for the optimizer
        macroGoals.firstDayAdjusted = adjustedGoals; 
    }
    
    summaryEl.textContent = 'Running optimization algorithm...';
    // Small delay to allow UI to update
    await new Promise(resolve => setTimeout(resolve, 10)); 
    
    // Initialize and run the optimizer
    const optimizer = new QPOptimizer(units, macroGoals, startDate, planDurationDays, optimizationStrength);
    const bestAllocation = optimizer.optimize();
    
    if (!bestAllocation) {
        planBtn.disabled = false;
        summaryEl.textContent = 'Optimization failed. Try adjusting goals or adding more food.';
        return;
    }

    // Process the optimizer's output
    const consumption = {};
    const dailySchedule = Array.from({ length: planDurationDays }, () => []);
    bestAllocation.forEach((dayIndex, unitIndex) => {
        if (dayIndex >= 0 && dayIndex < planDurationDays) {
            const unit = units[unitIndex];
            consumption[unit.name] = (consumption[unit.name] || 0) + 1;
            dailySchedule[dayIndex].push(unit.name);
        }
    });

    // If this is a recalculation, return the results for distributor.js to merge
    if (isRecalculation) {
        return { dailySchedule, consumption };
    }
    
    // Calculate shopping list and waste analysis for initial plan
    const shoppingList = [];
    const wasteAnalysis = { wasted: [], atRisk: [] };
    
    state.foodDatabase.forEach(item => {
        const needed = consumption[item.name] || 0;
        const onHand = item.servings;
        const toBuy = needed - onHand;
        
        // Add to shopping list if more is needed than on-hand and item is shoppable
        if (toBuy > 0 && item.shoppable) {
            shoppingList.push({ name: item.name, toBuy });
        }

        // Analyze potential waste for on-hand items not fully consumed
        const unscheduled = onHand - needed;
        if (unscheduled > 0) {
            const expiryDate = parseDateString(item.expiration);
            if (expiryDate) {
                // Days until expiry relative to plan start
                const daysUntilExpiry = (expiryDate.getTime() - startDate.getTime()) / MS_DAY;
                
                if (daysUntilExpiry < planDurationDays) {
                    // Item expires BEFORE the plan ends
                    wasteAnalysis.wasted.push({ name: item.name, count: unscheduled });
                } else {
                    // Item expires AFTER the plan ends
                    if (needed > 0) {
                        // If some of the item is eaten, project when remainder would be eaten
                        const consumptionRate = needed / planDurationDays;
                        const daysToEatRemainder = unscheduled / consumptionRate;
                        const projectedFinishDays = planDurationDays + daysToEatRemainder;
                        if (projectedFinishDays > daysUntilExpiry) {
                            wasteAnalysis.atRisk.push({ name: item.name, count: unscheduled });
                        }
                    } else {
                        // If none of the item is eaten, it's at risk of expiring if not used
                        wasteAnalysis.atRisk.push({ name: item.name, count: unscheduled });
                    }
                }
            }
        }
    });

    // Construct the new plan object and update state
    const newPlan = { 
        planParameters: { startDate: isoDate(startDate), endDate: isoDate(endDate), duration: planDurationDays, originalGoals: macroGoals }, 
        dailySchedule, consumption, shoppingList, wasteAnalysis 
    };
    state.setCurrentPlan(newPlan);
    
    // Populate and render distributor grid with the new plan
    populateDistributorFromPlan();
    renderPlanResults(newPlan);
    renderDistributorGrid();
    state.saveState(); // Persist the updated state

    // Adjust UI visibility
    document.getElementById('config-section').open = false;
    document.getElementById('results-section').open = true;
    document.getElementById('results-section').scrollIntoView({ behavior: 'smooth' });
    
    planBtn.disabled = false; // Re-enable the button
    summaryEl.textContent = `Optimization complete. Plan generated for ${planDurationDays} days.`;
}

/**
 * Commits the current plan's consumption to the food inventory, reducing servings on hand.
 */
export function commitPlanToInventory() {
    if (!state.currentPlan || !state.currentPlan.consumption) {
        alert("No plan computed to commit. Generate a plan first.");
        return;
    }
    if (!confirm("This action will permanently subtract the 'consumed' food from your inventory (Tab 1). Are you sure?")) {
        return;
    }

    const consumption = state.currentPlan.consumption;
    state.foodDatabase.forEach(item => {
        const consumedCount = consumption[item.name] || 0;
        item.servings = Math.max(0, item.servings - consumedCount);
    });

    renderInventoryTable(); // Refresh inventory display
    state.saveState(); // Persist updated inventory
    alert("Inventory has been updated based on the plan's consumption.");
    showTab('inventory'); // Switch to inventory tab
}