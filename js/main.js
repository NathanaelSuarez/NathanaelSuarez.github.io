import * as state from './state.js';
import { MS_DAY, isoDate } from './utils.js';
import { showTab, renderInventoryTable, renderPlanResults, renderDistributorGrid, resetForm } from './ui.js';
import { saveFood, editFood, deleteFood, duplicateFood, loadJSON, exportJSON, downloadJSON } from './inventory.js';
import { generatePlan, commitPlanToInventory } from './planner.js';
import { toggleMealComplete, recalculatePlan } from './distributor.js';

function initializeApp() {
    const today = new Date();
    document.getElementById('startDate').value = isoDate(today);
    document.getElementById('endDate').value = isoDate(new Date(today.getTime() + 13 * MS_DAY));
    
    // Load state from localStorage using the state module
    state.loadState();

    // Initial render based on loaded state from the state module
    renderInventoryTable();
    if (state.currentPlan) renderPlanResults(state.currentPlan);
    if (state.distributorData.length > 0) renderDistributorGrid();
    
    showTab('inventory');
}

// Expose functions to the global scope for inline event handlers
window.app = {
    // UI
    showTab,
    resetForm,
    // Inventory
    saveFood,
    editFood,
    deleteFood,
    duplicateFood,
    loadJSON,
    exportJSON,
    downloadJSON,
    // Planner
    generatePlan,
    commitPlanToInventory,
    // Distributor
    toggleMealComplete,
    recalculatePlan,
};

// --- APP INITIALIZATION ---
document.addEventListener('DOMContentLoaded', initializeApp);

// --- EVENT LISTENERS FOR ELEMENTS WITHOUT INLINE HANDLERS ---
document.getElementById('planBtn').addEventListener('click', () => generatePlan());