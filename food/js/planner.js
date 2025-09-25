// ============================================================================== //
// PLANNER.JS - MEAL PLAN GENERATION AND MANAGEMENT (GA VERSION)
// ============================================================================== //
// This file is responsible for:
// 1. Orchestrating meal plan generation using the GeneticAlgorithmPlanner.
// 2. Handling user input for plan parameters.
// 3. Processing the optimizer's output to create the daily schedule, shopping
//    list, and waste analysis.
// 4. Handling both initial plan generation and re-optimization requests.
// ============================================================================== //

import * as state from './state.js';
import { MS_DAY, parseDateString, isoDate, MEAL_NAMES, MACROS } from './utils.js';
import { renderPlanResults, renderDistributorGrid } from './ui.js';
import GeneticAlgorithmPlanner from './geneticOptimizer.js';


function populateDistributorFromPlan() {
    if (!state.currentPlan || !state.currentPlan.dailySchedule) return;

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

export async function generatePlan(isRecalculation = false, options = {}) {
    console.log(`%c--- Starting New GA Plan Generation ---`, 'color: blue; font-weight: bold;');
    const planBtn = document.getElementById('planBtn');
    const summaryEl = document.getElementById('planSummary');

    planBtn.disabled = true;
    document.getElementById('config-section').open = false;
    document.getElementById('results-section').open = true;
    document.getElementById('results-section').scrollIntoView({ behavior: 'smooth' });
    
    // --- Determine Parameters (from UI or options object) ---
    const optimizationStrength = isRecalculation ? options.strength : parseInt(document.getElementById('numGenerations').value, 10);
    const shoppingAllowed = isRecalculation ? options.allowShopping : document.getElementById('allowShopping').checked;
    const startDate = isRecalculation ? options.startDate : parseDateString(document.getElementById('startDate').value);
    const endDate = isRecalculation ? options.endDate : parseDateString(document.getElementById('endDate').value);
    const sourceInventory = isRecalculation ? options.inventory : state.foodDatabase;
    const consumedOnPartialDay = isRecalculation ? options.consumedOnPartialDay : null;
    
    if (sourceInventory.length === 0 && !shoppingAllowed) {
        alert("Please add food to your inventory or allow shopping.");
        planBtn.disabled = false;
        return;
    }
    if (!startDate || !endDate || endDate < startDate) {
        alert("Invalid date range selected.");
        planBtn.disabled = false;
        return;
    }

    const gaParams = {
        generations: optimizationStrength,
        populationSize: 20,
        mutationStart: 1,
        mutationEnd: 0.2,
        initStrategy: 'greedy'
    };

    const updateProgress = async (generation, bestScore) => {
        summaryEl.innerHTML = `Optimizing...<br>
            <strong>Generation:</strong> ${generation + 1} / ${gaParams.generations}<br>
            <strong>Best Score (Penalty):</strong> ${bestScore.toFixed(2)}`;
        await new Promise(resolve => setTimeout(resolve, 0));
    };

    summaryEl.textContent = 'Preparing for optimization...';

    const planDurationDays = Math.round((endDate.getTime() - startDate.getTime()) / MS_DAY) + 1;
    const macroGoals = {};
    const macroIdMap = { calories: 'cal', carbs: 'carb', sugar: 'sugar', protein: 'protein', saturatedFat: 'sat', sodium: 'sodium', fiber: 'fiber' };
    MACROS.forEach(m => {
        const idPrefix = macroIdMap[m];
        macroGoals[m] = { 
            min: Number(document.getElementById(idPrefix + 'Min').value || 0), 
            max: Number(document.getElementById(idPrefix + 'Max').value || Infinity) 
        };
    });
    
    // --- *** NEW: Create a unified "units" array with virtual items for shopping *** ---
    let units = [];
    // 1. Add all on-hand items
    sourceInventory.forEach(item => {
        for (let i = 0; i < item.servings; i++) {
            units.push({ name: item.name, nutrients: item, maxPerDay: item.maxPerDay, expiration: item.expiration, isVirtual: false });
        }
    });

    // 2. If shopping is allowed, add a pool of "virtual" shoppable items
    if (shoppingAllowed) {
        // This gives the GA up to 15 of each shoppable item to "buy" during the plan.
        const VIRTUAL_SHOPPING_POOL_SIZE = 15; 
        const masterInventory = state.foodDatabase; // Use master list for all shoppable options

        masterInventory.forEach(item => {
            if (item.shoppable) {
                for (let i = 0; i < VIRTUAL_SHOPPING_POOL_SIZE; i++) {
                    units.push({ name: item.name, nutrients: item, maxPerDay: item.maxPerDay, expiration: item.expiration, isVirtual: true });
                }
            }
        });
    }

    // ==========================================================
    // RUN THE GENETIC ALGORITHM
    // ==========================================================
    // The GA now optimizes on-hand and shoppable items simultaneously.
    // We pass `shoppingAllowed: false` to the GA constructor because the slow, internal greedy loop is no longer needed.
    const planner = new GeneticAlgorithmPlanner(units, macroGoals, startDate, planDurationDays, gaParams, false, consumedOnPartialDay);
    const bestIndividual = await planner.run(updateProgress);
    
    // --- Process the final results ---
    const dailySchedule = Array.from({ length: planDurationDays }, () => []);
    const onHandConsumption = {};
    const shoppingListMap = {};

    bestIndividual.forEach((dayIndex, unitIndex) => {
        if (dayIndex >= 0) {
            const unit = units[unitIndex];
            dailySchedule[dayIndex].push(unit.name);

            if (unit.isVirtual) {
                shoppingListMap[unit.name] = (shoppingListMap[unit.name] || 0) + 1;
            } else {
                onHandConsumption[unit.name] = (onHandConsumption[unit.name] || 0) + 1;
            }
        }
    });
    
    // --- *** REMOVED the slow, post-GA greedy shopping loop. The GA handles it now. *** ---
    
    const shoppingList = Object.entries(shoppingListMap).map(([name, toBuy]) => ({ name, toBuy }));
    const totalConsumption = { ...onHandConsumption };
    shoppingList.forEach(item => totalConsumption[item.name] = (totalConsumption[item.name] || 0) + item.toBuy);

    const wasteAnalysis = { wasted: [], atRisk: [] };
    sourceInventory.forEach(item => {
        const consumed = onHandConsumption[item.name] || 0;
        const unscheduled = item.servings - consumed;
        if (unscheduled > 0) {
            const expiryDate = parseDateString(item.expiration);
            if (expiryDate) {
                const daysUntilExpiry = (expiryDate.getTime() - startDate.getTime()) / MS_DAY;
                if (daysUntilExpiry < planDurationDays) {
                    wasteAnalysis.wasted.push({ name: item.name, count: unscheduled });
                } else {
                    const consumptionRate = consumed / planDurationDays;
                    const daysToEatRemainder = consumptionRate > 0 ? unscheduled / consumptionRate : Infinity;
                    if (planDurationDays + daysToEatRemainder > daysUntilExpiry) {
                        wasteAnalysis.atRisk.push({ name: item.name, count: unscheduled });
                    }
                }
            }
        }
    });

    const planResult = { 
        planParameters: { startDate: isoDate(startDate), endDate: isoDate(endDate), duration: planDurationDays, originalGoals: macroGoals }, 
        dailySchedule, consumption: totalConsumption, shoppingList, wasteAnalysis 
    };

    if (isRecalculation) {
        planBtn.disabled = false;
        return planResult; // Return result for the recalculate function to process
    }

    // For a normal plan, update state and UI directly
    state.setCurrentPlan(planResult);
    populateDistributorFromPlan();
    renderPlanResults(planResult);
    renderDistributorGrid();
    state.saveState();
    planBtn.disabled = false;
}