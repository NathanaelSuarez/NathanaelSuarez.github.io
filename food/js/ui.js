import * as state from './state.js';
import { MEAL_NAMES } from './utils.js';
import { addDragDropListeners } from './distributor.js';

export function showTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
    document.querySelectorAll('.tab-link').forEach(button => button.classList.remove('active'));
    document.getElementById(tabId).style.display = 'block';
    document.getElementById(`tab-btn-${tabId}`).classList.add('active');
}

export function renderInventoryTable() {
    const tbody = document.querySelector('#foodTable tbody');
    tbody.innerHTML = '';
    state.foodDatabase.sort((a, b) => a.name.localeCompare(b.name));
    state.foodDatabase.forEach((f, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${f.name}</td>
            <td>${f.servings}</td>
            <td>${f.calories}</td>
            <td>${f.protein}</td>
            <td>${f.carbs}</td>
            <td>${f.fiber || 0}</td>
            <td>${f.expiration}</td>
            <td>${f.maxPerDay || 99}</td>
            <td>${f.shoppable ? '✅' : '❌'}</td>
            <td class="actions">
                <button>Duplicate</button>
                <button>Edit</button>
                <button>Delete</button>
            </td>`;
        tbody.appendChild(tr);
    });
}

export function resetForm() {
    document.getElementById('foodForm').reset();
    document.getElementById('shoppable').checked = true;
    document.getElementById('maxPerDay').value = '99';
    state.setEditingIndex(null);
    document.getElementById('submitBtn').textContent = 'Add Food';
    document.getElementById('formTitle').textContent = 'Add New Food';
}

/**
 * Reads all values from the configuration form and returns them as an object.
 */
export function getPlanConfigFromUI() {
    const macroIdMap = { calories: 'cal', carbs: 'carb', addedSugar: 'addedSugar', protein: 'protein', saturatedFat: 'sat', sodium: 'sodium', fiber: 'fiber' };
    const macroGoals = {};
    Object.keys(macroIdMap).forEach(m => {
        const idPrefix = macroIdMap[m];
        macroGoals[m] = {
            min: Number(document.getElementById(idPrefix + 'Min').value || 0),
            max: Number(document.getElementById(idPrefix + 'Max').value || Infinity)
        };
    });

    return {
        startDate: document.getElementById('startDate').value,
        endDate: document.getElementById('endDate').value,
        strength: parseInt(document.getElementById('numGenerations').value, 10),
        allowShopping: document.getElementById('allowShopping').checked,
        macros: macroGoals
    };
}

/**
 * Populates the configuration form with values from the state.planConfig object.
 */
export function populateConfigForm() {
    const config = state.planConfig;
    if (!config || Object.keys(config).length === 0) return;

    if (config.startDate) document.getElementById('startDate').value = config.startDate;
    if (config.endDate) document.getElementById('endDate').value = config.endDate;
    if (config.strength) document.getElementById('numGenerations').value = config.strength;
    if (typeof config.allowShopping === 'boolean') document.getElementById('allowShopping').checked = config.allowShopping;

    if (config.macros) {
        const macroIdMap = { calories: 'cal', carbs: 'carb', addedSugar: 'addedSugar', protein: 'protein', saturatedFat: 'sat', sodium: 'sodium', fiber: 'fiber' };
        Object.keys(macroIdMap).forEach(m => {
            if (config.macros[m]) {
                const idPrefix = macroIdMap[m];
                document.getElementById(idPrefix + 'Min').value = config.macros[m].min;
                document.getElementById(idPrefix + 'Max').value = config.macros[m].max === Infinity ? '' : config.macros[m].max;
            }
        });
    }
}

export function renderPlanResults(plan) {
    if (!plan || !plan.planParameters) {
        document.getElementById('planSummary').textContent = "No plan data available to display results.";
        return;
    }
    
    const wastedItems = plan.wasteAnalysis?.wasted || [];
    const atRiskItems = plan.wasteAnalysis?.atRisk || [];
    const totalWasted = wastedItems.reduce((sum, item) => sum + item.count, 0);
    const totalAtRisk = atRiskItems.reduce((sum, item) => sum + item.count, 0);

    let summaryText = `Plan for ${plan.planParameters.duration} days (${plan.planParameters.startDate} to ${plan.planParameters.endDate}).`;
    if (totalWasted > 0) summaryText += ` • <span class="macro-average bad">Wasted: ${totalWasted}</span>`;
    if (totalAtRisk > 0) summaryText += ` • <span class="macro-average" style="color: var(--warning-color);">At Risk: ${totalAtRisk}</span>`;
    document.getElementById('planSummary').innerHTML = summaryText;
    
    const shoppingList = plan.shoppingList || [];
    document.getElementById('shoppingListContainer').innerHTML = shoppingList.length > 0 ?
        `<table><thead><tr><th>Item</th><th>Servings to Buy</th></tr></thead><tbody>${shoppingList.map(item => `<tr><td>${item.name}</td><td>${item.toBuy}</td></tr>`).join('')}</tbody></table>` :
        `<div class="good">No shopping needed!</div>`;
    
    let wasteHtml = '';
    if (wastedItems.length > 0) {
        wasteHtml += `<div class="danger" style="font-weight: 600;">Definite Waste (expires during plan):</div><ul>${wastedItems.map(item => `<li>${item.name}: ${item.count} servings</li>`).join('')}</ul>`;
    }
    if (atRiskItems.length > 0) {
        wasteHtml += `<div class="warning" style="font-weight: 600; margin-top: 8px; color: var(--warning-color);">At Risk (projected to expire after plan):</div><ul>${atRiskItems.map(item => `<li>${item.name}: ${item.count} servings are projected to expire before they can be eaten at the current rate.</li>`).join('')}</ul>`;
    }
    document.getElementById('wasteList').innerHTML = wasteHtml || `<div class="good">No on-hand food will be wasted or at risk based on this plan.</div>`;
        
    renderPlanAverages();
}

export function renderPlanAverages() {
    if (!state.distributorData.length || !state.currentPlan || !state.currentPlan.planParameters || !state.currentPlan.planParameters.originalGoals) {
        document.getElementById('planAveragesContainer').innerHTML = 'No plan averages to display.';
        return;
    }

    const averagesContainer = document.getElementById('planAveragesContainer');
    const totalMacros = { calories: 0, carbs: 0, addedSugar: 0, protein: 0, saturatedFat: 0, sodium: 0, fiber: 0 };
    const foodMap = new Map(state.foodDatabase.map(f => [f.name, f]));
    const macros = Object.keys(state.currentPlan.planParameters.originalGoals);

    state.distributorData.forEach(day => {
        MEAL_NAMES.forEach(mealName => {
            const meal = day.meals[mealName];
            if (meal && meal.items) {
                meal.items.forEach(item => {
                    const food = (typeof item === 'string') ? foodMap.get(item) : (item.isCustom ? item.macros : null);
                    if (food) {
                        macros.forEach(macro => totalMacros[macro] += food[macro] || 0);
                    }
                });
            }
        });
    });

    const numDays = state.distributorData.length;
    if (numDays === 0) { averagesContainer.innerHTML = ''; return; }
    
    let html = `<strong>Daily Averages:</strong> `;
    for (const macro of macros) {
        const avg = totalMacros[macro] / numDays;
        const goal = state.currentPlan.planParameters.originalGoals[macro];
        const status = (goal && avg >= goal.min && avg <= goal.max) ? 'good' : 'bad';
        const displayName = macro.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
        html += `<span class="macro-average ${status}" 
                    title="Goal: ${goal?.min ?? 'N/A'}–${goal?.max === Infinity ? '∞' : (goal?.max ?? 'N/A')}">
                    <strong>${displayName}:</strong> ${Math.round(avg)}
                </span>`;
    }
    averagesContainer.innerHTML = html;
}

export function renderDistributorGrid() {
    const gridDiv = document.getElementById('plan-grid');
    const foodMap = new Map(state.foodDatabase.map(f => [f.name, f]));
    gridDiv.innerHTML = '';

    const completedCounts = new Map();
    const shoppingMap = new Map();

    if (state.currentPlan) {
        state.distributorData.forEach(dayData => {
            MEAL_NAMES.forEach(mealName => {
                const meal = dayData.meals[mealName];
                if (meal?.completed) {
                    (meal.items || []).forEach(itemName => {
                        if (typeof itemName === 'string') {
                            completedCounts.set(itemName, (completedCounts.get(itemName) || 0) + 1);
                        }
                    });
                }
            });
        });
        if (state.currentPlan.shoppingList) {
            state.currentPlan.shoppingList.forEach(item => shoppingMap.set(item.name, item.toBuy));
        }
    }

    state.distributorData.forEach((dayData, dayIndex) => {
        const dayCard = document.createElement('div');
        dayCard.className = 'day-card';
        
        let dayCalories = 0;
        MEAL_NAMES.forEach(mealName => {
            const meal = dayData.meals[mealName];
            if (meal && meal.items) {
                meal.items.forEach(item => {
                    if (typeof item === 'string') {
                        dayCalories += foodMap.get(item)?.calories || 0;
                    } else if (item && item.isCustom) {
                        dayCalories += item.macros.calories;
                    }
                });
            }
        });
        
        let dayHtml = `<div class="day-header">
            <h4>Day ${dayIndex + 1}</h4>
            <span class="calorie-count">${Math.round(dayCalories)} kcal</span>
        </div>`;

        MEAL_NAMES.forEach(mealName => {
            const meal = dayData.meals[mealName];
            const completedClass = meal?.completed ? 'completed' : '';
            dayHtml += `
                <div class="meal-slot ${completedClass}">
                    <div class="meal-header">
                        <h5>${mealName}</h5>
                        <div>
                            <button class="add-custom-btn" data-day-index="${dayIndex}" data-meal-name="${mealName}">+ Custom</button>
                            <button class="complete-btn">${meal?.completed ? 'Undo' : 'Complete'}</button>
                        </div>
                    </div>
                    <ul class="food-list" data-day-index="${dayIndex}" data-meal-name="${mealName}">
                        ${(meal?.items || []).sort().map((item, itemIndex) => {
                            if (typeof item === 'string') {
                                let tooltipText = '';
                                if (state.currentPlan) {
                                    const foodItem = foodMap.get(item);
                                    const initialServings = foodItem ? foodItem.servings : 0;
                                    const purchasedServings = shoppingMap.get(item) || 0;
                                    const totalAvailable = initialServings + purchasedServings;
                                    const numCompleted = completedCounts.get(item) || 0;
                                    const numRemaining = totalAvailable - numCompleted;
                                    tooltipText = `title="${numCompleted} serving(s) completed. ${numRemaining}/${totalAvailable} total servings remaining."`;
                                }
                                return `<li draggable="true" data-item-index="${itemIndex}" ${tooltipText}>${item}</li>`;
                            } else if (item && item.isCustom) {
                                const customTooltip = `title="Custom Item: ${item.macros.calories}cal, ${item.macros.protein}p, ${item.macros.carbs}c"`;
                                return `<li class="custom-meal" ${customTooltip}>
                                            <span>${item.name}</span>
                                            <button class="delete-custom-meal" data-day-index="${dayIndex}" data-meal-name="${mealName}" data-item-index="${itemIndex}">&times;</button>
                                        </li>`;
                            }
                            return '';
                        }).join('')}
                    </ul>
                </div>`;
        });
        dayCard.innerHTML = dayHtml;
        gridDiv.appendChild(dayCard);
    });

    addDragDropListeners();
    renderPlanAverages();
    state.saveState();
}