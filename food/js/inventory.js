import * as state from './state.js';
import { renderInventoryTable, resetForm } from './ui.js';
import { isoDate, MS_DAY } from './utils.js';
import MACRO_DEFINITIONS from './macros.js';

export function saveFood(e) {
    e.preventDefault();
    const foodItem = {
        name: document.getElementById('name').value.trim(),
        servings: +document.getElementById('servings').value,
        expiration: document.getElementById('expiration').value,
        maxPerDay: parseInt(document.getElementById('maxPerDay').value, 10) || 99,
        shoppable: document.getElementById('shoppable').checked,
        servingsPerPackage: parseInt(document.getElementById('servingsPerPackage').value, 10) || 1, // NEW
    };

    // Dynamically add all macro values from the form
    MACRO_DEFINITIONS.forEach(macro => {
        const input = document.getElementById(macro.key);
        if (input) { // Check if input exists (e.g., 'cost' is filtered out)
            foodItem[macro.key] = +input.value || 0;
        }
    });


    if (!foodItem.name) {
        alert("Food name cannot be empty.");
        return;
    }

    const existingItemIndex = state.foodDatabase.findIndex(f => f.name === foodItem.name);
    if (existingItemIndex !== -1 && existingItemIndex !== state.editingIndex) {
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
        
        const validatedArr = arr.map(item => {
            const validatedItem = {
                name: String(item.name || `Unnamed Item`).trim(),
                servings: Math.max(0, Number(item.servings || 0)),
                expiration: item.expiration ? String(item.expiration) : isoDate(new Date(Date.now() + 365 * MS_DAY)),
                maxPerDay: parseInt(item.maxPerDay, 10) || 99,
                shoppable: typeof item.shoppable === 'boolean' ? item.shoppable : true,
                servingsPerPackage: parseInt(item.servingsPerPackage, 10) || 1, // NEW
            };

            MACRO_DEFINITIONS.forEach(macro => {
                // Special case for addedSugar to maintain backwards compatibility with 'sugar' key
                if (macro.key === 'addedSugar') {
                    validatedItem[macro.key] = Math.max(0, Number(item.addedSugar || item.sugar || 0));
                } else {
                    validatedItem[macro.key] = Math.max(0, Number(item[macro.key] || 0));
                }
            });

            return validatedItem;
        });
        
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