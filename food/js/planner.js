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
// Import our TWO new optimizers
import PoolOptimizer from './poolOptimizer.js';
import DistributionOptimizer from './distributionOptimizer.js';


function populateDistributorFromPlan() {
    if (!state.currentPlan || !state.currentPlan.dailySchedule) {
        alert("No plan generated yet. Please generate a plan on the 'Create & View Plan' tab first.");
        return;
    }
    const distributor = [];
    state.currentPlan.dailySchedule.forEach((dayItems, dayIndex) => {
        const dayMeals = {};
        MEAL_NAMES.forEach(name => dayMeals[name] = { items: [], completed: false });

        dayItems.forEach((item, itemQueueIndex) => {
            const mealName = MEAL_NAMES[itemQueueIndex % MEAL_NAMES.length];
            dayMeals[mealName].items.push(item);
        });
        distributor.push({ day: dayIndex + 1, meals: dayMeals });
    });
    state.setDistributorData(distributor);
}

// NOTE: The `isRecalculation` logic has been removed for simplicity in this major refactor.
// It would need to be re-implemented carefully within the new two-phase system.
export async function generatePlan() {
    console.log(`%c--- Starting New Two-Phase Plan Generation ---`, 'color: blue; font-weight: bold;');
    const planBtn = document.getElementById('planBtn');
    const summaryEl = document.getElementById('planSummary');

    if (state.foodDatabase.length === 0) {
        alert("Please add food to your inventory (Tab 1) first.");
        return;
    }
    planBtn.disabled = true;
    
    // This is our new progress update function!
    const updateProgress = async (phase, current, total) => {
        summaryEl.innerHTML = `Optimizing...<br>
            <strong>Phase:</strong> ${phase}<br>
            <strong>Step:</strong> ${current} / ${total}`;
        // This is a crucial trick to force the browser to repaint the UI
        // before the next (blocking) computation step.
        await new Promise(resolve => setTimeout(resolve, 0));
    };

    summaryEl.textContent = 'Preparing for optimization...';
    
    const optimizationStrength = parseInt(document.getElementById('numGenerations').value, 10) || 50;
    const shoppingAllowed = document.getElementById('allowShopping').checked;
    
    const startDate = parseDateString(document.getElementById('startDate').value);
    const endDate = parseDateString(document.getElementById('endDate').value);
    
    if (!startDate || !endDate || endDate < startDate) {
        alert("Invalid date range selected.");
        planBtn.disabled = false;
        return;
    }
    
    const planDurationDays = Math.round((endDate.getTime() - startDate.getTime()) / MS_DAY) + 1;
    const macroIdMap = { calories: 'cal', carbs: 'carb', sugar: 'sugar', protein: 'protein', saturatedFat: 'sat', sodium: 'sodium', fiber: 'fiber' };
    const macros = Object.keys(macroIdMap);
    const macroGoals = {};

    macros.forEach(m => {
        const idPrefix = macroIdMap[m];
        macroGoals[m] = { 
            min: Number(document.getElementById(idPrefix + 'Min').value || 0), 
            max: Number(document.getElementById(idPrefix + 'Max').value || Infinity) 
        };
    });
    
    // Prepare units for the optimizer
    let units = [];
    state.foodDatabase.forEach((item, index) => {
        const itemData = { itemIndex: index, name: item.name, nutrients: item, expiration: parseDateString(item.expiration), maxPerDay: item.maxPerDay };
        for (let i = 0; i < item.servings; i++) units.push({ ...itemData, type: 'on-hand' });
        if (item.shoppable && shoppingAllowed) {
            for (let i = 0; i < 200; i++) units.push({ ...itemData, type: 'virtual' });
        }
    });

    // ==========================================================
    // PHASE 1: Run the Pool Optimizer
    // ==========================================================
    const poolOptimizer = new PoolOptimizer(units, macroGoals, startDate, planDurationDays, optimizationStrength);
    const foodPool = await poolOptimizer.optimize(updateProgress);

    if (!foodPool || foodPool.length === 0) {
        planBtn.disabled = false;
        summaryEl.textContent = 'Optimization failed in Phase 1 (Pool Selection). Could not find a viable set of food.';
        return;
    }

    // ==========================================================
    // PHASE 2: Run the Distribution Optimizer
    // ==========================================================
    const distOptimizer = new DistributionOptimizer(foodPool, macroGoals, startDate, planDurationDays, optimizationStrength);
    const bestAllocation = await distOptimizer.optimize(updateProgress);
    
    if (!bestAllocation) {
        planBtn.disabled = false;
        summaryEl.textContent = 'Optimization failed in Phase 2 (Distribution).';
        return;
    }

    // --- Process the final results (same as before) ---
    const consumption = {};
    const dailySchedule = Array.from({ length: planDurationDays }, () => []);
    bestAllocation.forEach((dayIndex, unitIndex) => {
        if (dayIndex >= 0 && dayIndex < planDurationDays) {
            const unit = foodPool[unitIndex];
            consumption[unit.name] = (consumption[unit.name] || 0) + 1;
            dailySchedule[dayIndex].push(unit.name);
        }
    });

    const shoppingList = [];
    const wasteAnalysis = { wasted: [], atRisk: [] };
    
    state.foodDatabase.forEach(item => {
        const needed = consumption[item.name] || 0;
        const onHand = item.servings;
        const toBuy = needed - onHand;
        if (toBuy > 0 && item.shoppable) shoppingList.push({ name: item.name, toBuy });
        const unscheduled = onHand - (consumption[item.name] || 0);
        if (unscheduled > 0) {
            const expiryDate = parseDateString(item.expiration);
            if (expiryDate) {
                const daysUntilExpiry = (expiryDate.getTime() - startDate.getTime()) / MS_DAY;
                if (daysUntilExpiry < planDurationDays) {
                    wasteAnalysis.wasted.push({ name: item.name, count: unscheduled });
                } else if (needed > 0) {
                    const consumptionRate = needed / planDurationDays;
                    const daysToEatRemainder = unscheduled / consumptionRate;
                    if (planDurationDays + daysToEatRemainder > daysUntilExpiry) {
                        wasteAnalysis.atRisk.push({ name: item.name, count: unscheduled });
                    }
                } else {
                   wasteAnalysis.atRisk.push({ name: item.name, count: unscheduled });
                }
            }
        }
    });

    const newPlan = { 
        planParameters: { startDate: isoDate(startDate), endDate: isoDate(endDate), duration: planDurationDays, originalGoals: macroGoals }, 
        dailySchedule, consumption, shoppingList, wasteAnalysis 
    };
    state.setCurrentPlan(newPlan);
    
    populateDistributorFromPlan();
    renderPlanResults(newPlan);
    renderDistributorGrid();
    state.saveState();

    document.getElementById('config-section').open = false;
    document.getElementById('results-section').open = true;
    document.getElementById('results-section').scrollIntoView({ behavior: 'smooth' });
    planBtn.disabled = false;
    // Keep the summary text from renderPlanResults
}

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

    renderInventoryTable();
    state.saveState();
    alert("Inventory has been updated based on the plan's consumption.");
    showTab('inventory');
}