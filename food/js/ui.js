import * as state from './state.js';
import { MEAL_NAMES, toPascalCase } from './utils.js';
import { addDragDropListeners } from './distributor.js';
import MACRO_DEFINITIONS from './macros.js';

export function showTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
    document.querySelectorAll('.tab-link').forEach(button => button.classList.remove('active'));
    document.getElementById(tabId).style.display = 'block';
    document.getElementById(`tab-btn-${tabId}`).classList.add('active');
}

export function renderInventoryTable() {
    const tbody = document.querySelector('#foodTable tbody');
    const thead = document.querySelector('#foodTable thead tr');
    thead.innerHTML = `<th>Name</th><th>On-Hand</th><th>Cost</th><th>Cal</th><th>Prot</th><th>Carb</th><th>Fiber</th><th>Expire</th><th>Max/Day</th><th>Shoppable</th><th>Actions</th>`;

    tbody.innerHTML = '';
    state.foodDatabase.sort((a, b) => a.name.localeCompare(b.name));
    state.foodDatabase.forEach((f, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${f.name}</td>
            <td>${f.servings}</td>
            <td>${f.cost ? '$' + Number(f.cost).toFixed(2) : '$0.00'}</td>
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
    document.getElementById('servingsPerPackage').value = '1'; // Reset new field
    state.setEditingIndex(null);
    document.getElementById('submitBtn').textContent = 'Add Food';
    document.getElementById('formTitle').textContent = 'Add New Food';
}

export function generateInventoryForm() {
    const container = document.getElementById('inventory-form-grid');
    if (!container) return;

    let html = `
        <div><label>Name<br><input id="name" required></label></div>
        <div><label>Servings (On-Hand)<br><input id="servings" type="number" value="0" min="0" step="any" required></label></div>
    `;

    html += MACRO_DEFINITIONS
        .map(macro => `
            <div><label>${macro.displayName} (${macro.unit})<br><input id="${macro.key}" type="number" value="0" min="0" step="any" required></label></div>
        `).join('');
    
    html += `
        <div><label>Expiration<br><input id="expiration" type="date" required></label></div>
        <div><label>Servings / Package <span class="small">(for shopping)</span><br>
            <input id="servingsPerPackage" type="number" value="1" min="1" title="For shoppable items, how many servings come in one purchased unit?">
        </label></div>
        <div><label>Max Servings / Day<br>
            <input id="maxPerDay" type="number" value="99" min="1" title="Set a daily consumption limit. Use a high number like 99 for no limit.">
        </label></div>
        <div class="shoppable-checkbox"><label>
            <input id="shoppable" type="checkbox" checked> Shoppable?
            <small>Uncheck for free/temporary items that shouldn't appear on the shopping list.</small>
        </label></div>
    `;
    container.innerHTML = html;
}

export function generateCustomMealForm() {
    const container = document.getElementById('custom-meal-form-grid');
    if (!container) return;

    let html = `<div><label>Description<br><input id="customName" required></label></div>`;
    
    html += MACRO_DEFINITIONS
        .map(macro => {
            const inputId = `custom${toPascalCase(macro.key)}`;
            return `<div><label>${macro.displayName} (${macro.unit})<br><input id="${inputId}" type="number" value="0" min="0" step="any"></label></div>`;
        }).join('');

    container.innerHTML = html;
}


export function generateMacroInputs() {
    const container = document.getElementById('macro-grid-container');
    if (!container) return;

    container.innerHTML = MACRO_DEFINITIONS.map(macro => `
        <div>
            <label class="small">${macro.displayName} (${macro.unit}) (min/max)</label>
            <div class="input-pair">
                <input id="${macro.idPrefix}Min" type="number" value="${macro.defaultMin}">
                <input id="${macro.idPrefix}Max" type="number" value="${macro.defaultMax}">
            </div>
        </div>
    `).join('');
}


export function getPlanConfigFromUI() {
    const macroGoals = {};
    MACRO_DEFINITIONS.forEach(macro => {
        macroGoals[macro.key] = {
            min: Number(document.getElementById(`${macro.idPrefix}Min`).value || 0),
            max: Number(document.getElementById(`${macro.idPrefix}Max`).value || Infinity)
        };
    });

    return {
        startDate: document.getElementById('startDate').value,
        endDate: document.getElementById('endDate').value,
        strength: parseInt(document.getElementById('optDuration').value, 10),
        allowShopping: document.getElementById('allowShopping').checked,
        macros: macroGoals
    };
}

export function populateConfigForm() {
    const config = state.planConfig;
    if (!config || Object.keys(config).length === 0) return;

    if (config.startDate) document.getElementById('startDate').value = config.startDate;
    if (config.endDate) document.getElementById('endDate').value = config.endDate;
    if (config.strength) document.getElementById('optDuration').value = config.strength;
    if (typeof config.allowShopping === 'boolean') document.getElementById('allowShopping').checked = config.allowShopping;

    if (config.macros) {
        MACRO_DEFINITIONS.forEach(macro => {
            if (config.macros[macro.key]) {
                document.getElementById(`${macro.idPrefix}Min`).value = config.macros[macro.key].min;
                const maxVal = config.macros[macro.key].max;
                document.getElementById(`${macro.idPrefix}Max`).value = maxVal === Infinity ? '' : maxVal;
            }
        });
    }
}

export function renderPlanResults(plan) {
    const finishPlanContainer = document.getElementById('finishPlanContainer');
    
    if (!plan || !plan.planParameters) {
        document.getElementById('planSummary').textContent = "No plan generated yet.";
        document.getElementById('shoppingListContainer').innerHTML = '';
        document.getElementById('wasteList').innerHTML = '';
        document.getElementById('planAveragesContainer').innerHTML = '';
        if (finishPlanContainer) finishPlanContainer.style.display = 'none';
        return;
    }
    
    if (finishPlanContainer) finishPlanContainer.style.display = 'block';

    const wastedItems = plan.wasteAnalysis?.wasted || [];
    const atRiskItems = plan.wasteAnalysis?.atRisk || [];
    const totalWasted = wastedItems.reduce((sum, item) => sum + item.count, 0);
    const totalAtRisk = atRiskItems.reduce((sum, item) => sum + item.count, 0);

    let summaryText = `Plan for ${plan.planParameters.duration} days (${plan.planParameters.startDate} to ${plan.planParameters.endDate}).`;
    if (totalWasted > 0) summaryText += ` • <span class="macro-average bad">Wasted: ${totalWasted}</span>`;
    if (totalAtRisk > 0) summaryText += ` • <span class="macro-average" style="color: var(--warning-color);">At Risk: ${totalAtRisk}</span>`;
    document.getElementById('planSummary').innerHTML = summaryText;
    
    const shoppingList = plan.shoppingList || [];
    const shoppingListHtml = shoppingList.length > 0 ?
        `<table>
            <thead>
                <tr>
                    <th>Item</th>
                    <th>Packages</th>
                    <th>Servings/Pkg</th>
                    <th>Total Servings</th>
                </tr>
            </thead>
            <tbody>
                ${shoppingList.map(item => `
                    <tr>
                        <td>${item.name}</td>
                        <td>${item.packagesToBuy}</td>
                        <td>${item.servingsPerPackage}</td>
                        <td>${item.totalServings}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>` :
        `<div class="good">No shopping needed!</div>`;
    document.getElementById('shoppingListContainer').innerHTML = shoppingListHtml;
    
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
    const allMacros = MACRO_DEFINITIONS.map(m => m.key);
    const totalMacros = {};
    allMacros.forEach(m => totalMacros[m] = 0);

    const foodMap = new Map(state.foodDatabase.map(f => [f.name, f]));
    const goalMacros = Object.keys(state.currentPlan.planParameters.originalGoals);

    state.distributorData.forEach(day => {
        MEAL_NAMES.forEach(mealName => {
            const meal = day.meals[mealName];
            if (meal && meal.items) {
                meal.items.forEach(item => {
                    const food = (typeof item === 'string') ? foodMap.get(item) : (item.isCustom ? item.macros : null);
                    if (food) {
                        allMacros.forEach(macro => totalMacros[macro] += food[macro] || 0);
                    }
                });
            }
        });
    });

    const numDays = state.distributorData.length;
    if (numDays === 0) { averagesContainer.innerHTML = ''; return; }
    
    let html = `<strong>Daily Averages:</strong> `;
    for (const macroDef of MACRO_DEFINITIONS) {
        const macroKey = macroDef.key;
        if (!goalMacros.includes(macroKey)) continue;

        const avg = totalMacros[macroKey] / numDays;
        const goal = state.currentPlan.planParameters.originalGoals[macroKey];
        const status = (goal && avg >= goal.min && avg <= goal.max) ? 'good' : 'bad';
        html += `<span class="macro-average ${status}" 
                    title="Goal: ${goal?.min ?? 'N/A'}–${goal?.max === Infinity ? '∞' : (goal?.max ?? 'N/A')}">
                    <strong>${macroDef.displayName}:</strong> ${avg.toFixed(2)}
                </span>`;
    }
    averagesContainer.innerHTML = html;
}

export function renderDistributorGrid() {
    const gridDiv = document.getElementById('plan-grid');
    const foodMap = new Map(state.foodDatabase.map(f => [f.name, f]));
    gridDiv.innerHTML = '';
    
    const finishPlanContainer = document.getElementById('finishPlanContainer');
    if (finishPlanContainer) {
        finishPlanContainer.style.display = state.distributorData.length > 0 ? 'block' : 'none';
    }


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
            state.currentPlan.shoppingList.forEach(item => shoppingMap.set(item.name, item.totalServings));
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
                                return `<li class="custom-meal" draggable="true" data-item-index="${itemIndex}" ${customTooltip}>
                                            <span>${item.name}</span>
                                            <span class="custom-controls">
                                                <button class="edit-custom-meal" data-day-index="${dayIndex}" data-meal-name="${mealName}" data-item-index="${itemIndex}">&#9998;</button>
                                                <button class="delete-custom-meal" data-day-index="${dayIndex}" data-meal-name="${mealName}" data-item-index="${itemIndex}">&times;</button>
                                            </span>
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