import * as state from './state.js';
import { renderInventoryTable, resetForm } from './ui.js';
import { isoDate, MS_DAY } from './utils.js';

export function saveFood(e) {
    e.preventDefault();
    const foodItem = {
        name: document.getElementById('name').value.trim(),
        servings: +document.getElementById('servings').value,
        calories: +document.getElementById('calories').value,
        protein: +document.getElementById('protein').value,
        carbs: +document.getElementById('carbs').value,
        fiber: +document.getElementById('fiber').value,
        sugar: +document.getElementById('sugar').value,
        saturatedFat: +document.getElementById('saturatedFat').value,
        sodium: +document.getElementById('sodium').value,
        expiration: document.getElementById('expiration').value,
        maxPerDay: parseInt(document.getElementById('maxPerDay').value, 10) || 99,
        shoppable: document.getElementById('shoppable').checked
    };

    if (!foodItem.name) {
        alert("Food name cannot be empty.");
        return;
    }

    if (state.editingIndex === null && state.foodDatabase.some(f => f.name === foodItem.name)) {
        alert(`Food item "${foodItem.name}" already exists. Please choose a different name or edit the existing item.`);
        return;
    }

    if (state.editingIndex === null) state.foodDatabase.push(foodItem);
    else state.foodDatabase[state.editingIndex] = foodItem;
    
    resetForm();
    renderInventoryTable();
    state.saveState();
}

export function editFood(i) {
    const f = state.foodDatabase[i];
    state.setEditingIndex(i);
    Object.keys(f).forEach(key => {
        const el = document.getElementById(key);
        if (el) {
            if (el.type === 'checkbox') el.checked = f[key];
            else el.value = f[key];
        }
    });
    document.getElementById('submitBtn').textContent = 'Update Food';
    document.getElementById('formTitle').textContent = `Edit Food: ${f.name}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function deleteFood(i) {
    if (confirm(`Are you sure you want to delete "${state.foodDatabase[i].name}"? This cannot be undone.`)) {
        state.foodDatabase.splice(i, 1);
        renderInventoryTable();
        state.saveState();
    }
}

export function duplicateFood(i) {
    const duplicatedItem = { ...state.foodDatabase[i] };
    duplicatedItem.name = `${duplicatedItem.name} (Copy)`;
    state.foodDatabase.splice(i + 1, 0, duplicatedItem);
    renderInventoryTable();
    state.saveState();
}

export function loadJSON() {
    try {
        const arr = JSON.parse(document.getElementById('loadArea').value.trim() || '[]');
        if (!Array.isArray(arr)) throw new Error('Input is not a valid JSON array.');
        
        const validatedArr = arr.map(item => ({
            name: String(item.name || `Unnamed Item`).trim(),
            servings: Math.max(0, Number(item.servings || 0)),
            calories: Math.max(0, Number(item.calories || 0)),
            protein: Math.max(0, Number(item.protein || 0)),
            carbs: Math.max(0, Number(item.carbs || 0)),
            fiber: Math.max(0, Number(item.fiber || 0)),
            sugar: Math.max(0, Number(item.sugar || 0)),
            saturatedFat: Math.max(0, Number(item.saturatedFat || 0)),
            sodium: Math.max(0, Number(item.sodium || 0)),
            expiration: item.expiration ? String(item.expiration) : isoDate(new Date(Date.now() + 365 * MS_DAY)),
            maxPerDay: parseInt(item.maxPerDay, 10) || 99,
            shoppable: typeof item.shoppable === 'boolean' ? item.shoppable : true
        }));
        
        state.setFoodDatabase(validatedArr);
        renderInventoryTable();
        state.saveState();
        alert('Inventory loaded successfully!');
    } catch (err) {
        alert('Invalid JSON: ' + err.message);
        console.error(err);
    }
}

export function exportJSON() {
    document.getElementById('exportArea').value = JSON.stringify(state.foodDatabase, null, 2);
}

export function downloadJSON() {
    exportJSON();
    const blob = new Blob([document.getElementById('exportArea').value], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'food_inventory.json';
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
}