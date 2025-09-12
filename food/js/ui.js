import * as state from './state.js';
import { MEAL_NAMES } from './utils.js';
import { toggleMealComplete, addDragDropListeners } from './distributor.js';

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
                <button onclick="window.app.duplicateFood(${i})">Duplicate</button>
                <button onclick="window.app.editFood(${i})">Edit</button>
                <button onclick="window.app.deleteFood(${i})">Delete</button>
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
    if (totalAtRisk > 0) summaryText += ` • <span class="macro-average bad" style="color: var(--warning-color);">At Risk: ${totalAtRisk}</span>`;
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
        
    document.getElementById('commitPlanBtn').style.display = 'block';

    renderPlanAverages();
}

export function renderPlanAverages() {
    if (!state.distributorData.length || !state.currentPlan || !state.currentPlan.planParameters || !state.currentPlan.planParameters.originalGoals) {
        document.getElementById('planAveragesContainer').innerHTML = 'No plan averages to display.';
        return;
    }

    const averagesContainer = document.getElementById('planAveragesContainer');
    const totalMacros = { calories: 0, carbs: 0, sugar: 0, protein: 0, saturatedFat: 0, sodium: 0, fiber: 0 };
    const foodMap = new Map(state.foodDatabase.map(f => [f.name, f]));
    const macros = Object.keys(state.currentPlan.planParameters.originalGoals);

    state.distributorData.forEach(day => {
        MEAL_NAMES.forEach(mealName => {
            const meal = day.meals[mealName];
            if (meal && meal.items) {
                meal.items.forEach(itemName => {
                    const food = foodMap.get(itemName);
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
        html += `<span class="macro-average ${status}" 
                    title="Goal: ${goal?.min ?? 'N/A'}–${goal?.max === Infinity ? '∞' : (goal?.max ?? 'N/A')}">
                    <strong>${macro}:</strong> ${Math.round(avg)}
                </span>`;
    }
    averagesContainer.innerHTML = html;
}

export function renderDistributorGrid() {
    const gridDiv = document.getElementById('plan-grid');
    const foodMap = new Map(state.foodDatabase.map(f => [f.name, f]));
    gridDiv.innerHTML = '';

    state.distributorData.forEach((dayData, dayIndex) => {
        const dayCard = document.createElement('div');
        dayCard.className = 'day-card';
        
        let dayCalories = 0;
        MEAL_NAMES.forEach(mealName => {
            const meal = dayData.meals[mealName];
            if (meal && meal.items) {
                meal.items.forEach(itemName => dayCalories += foodMap.get(itemName)?.calories || 0);
            }
        });
        
        let dayHtml = `<div class="day-header">
            <h4>Day ${dayData.day}</h4>
            <span class="calorie-count">${Math.round(dayCalories)} kcal</span>
        </div>`;

        MEAL_NAMES.forEach(mealName => {
            const meal = dayData.meals[mealName];
            const completedClass = meal?.completed ? 'completed' : '';
            dayHtml += `
                <div class="meal-slot ${completedClass}">
                    <div class="meal-header">
                        <h5>${mealName}</h5>
                        <button class="complete-btn" onclick="window.app.toggleMealComplete(${dayIndex}, '${mealName}')">
                            ${meal?.completed ? 'Undo' : 'Complete'}
                        </button>
                    </div>
                    <ul class="food-list" data-day-index="${dayIndex}" data-meal-name="${mealName}">
                        ${meal?.items.sort().map((item, itemIndex) => `
                            <li draggable="true" data-item-index="${itemIndex}">${item}</li>
                        `).join('') || ''}
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