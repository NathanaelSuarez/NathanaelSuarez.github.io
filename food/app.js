(function() {
    'use strict';

    // ============================================================================== //
    // 1. GLOBAL STATE & UTILITIES
    // ============================================================================== //

    let foodDatabase = [];
    let currentPlan = null;
    let distributorData = [];
    let editingIndex = null;
    let draggedItemInfo = null;

    const MS_DAY = 24 * 60 * 60 * 1000;
    const MEAL_NAMES = ["Breakfast", "Lunch", "Dinner", "Snack"];
    const MACRO_WEIGHTS = { calories: 1.0, protein: 0.8, carbs: 0.5, sodium: 0.3, saturatedFat: 0.2, sugar: 0.2 };
    const PENALTY_SCALE_FACTOR = 5000;

    function parseDateString(s) {
        if (!s) return null;
        const parts = s.split('-').map(Number);
        if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
            return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        }
        const d = new Date(s);
        if (isNaN(d)) return null;
        return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    }

    function isoDate(date) {
        if (!date instanceof Date || isNaN(date)) return '';
        return date.toISOString().slice(0, 10);
    }
    
    // ============================================================================== //
    // 2. CORE APP LOGIC & INITIALIZATION
    // ============================================================================== //

    function showTab(tabId) {
        document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
        document.querySelectorAll('.tab-link').forEach(button => button.classList.remove('active'));
        document.getElementById(tabId).style.display = 'block';
        document.getElementById(`tab-btn-${tabId}`).classList.add('active');
    }

    function saveState() {
        try {
            localStorage.setItem('foodPlanner_database_v5', JSON.stringify(foodDatabase));
            localStorage.setItem('foodPlanner_plan_v5', JSON.stringify(currentPlan));
            localStorage.setItem('foodPlanner_distributor_v5', JSON.stringify(distributorData));
        } catch (e) { console.error("Failed to save state:", e); }
    }

    function loadState() {
        const savedDB = localStorage.getItem('foodPlanner_database_v5');
        const savedPlan = localStorage.getItem('foodPlanner_plan_v5');
        const savedDist = localStorage.getItem('foodPlanner_distributor_v5');

        if (savedDB) {
            try { foodDatabase = JSON.parse(savedDB) || []; renderInventoryTable(); }
            catch (e) { console.error("Failed to load inventory database from storage:", e); foodDatabase = []; }
        }
        
        if (savedPlan) {
            try {
                currentPlan = JSON.parse(savedPlan);
                if (currentPlan && currentPlan.planParameters) {
                    currentPlan.planParameters.startDate = parseDateString(currentPlan.planParameters.startDate);
                    currentPlan.planParameters.endDate = parseDateString(currentPlan.planParameters.endDate);
                }
                if (currentPlan) renderPlanResults(currentPlan);
            } catch (e) { console.error("Failed to load current plan from storage:", e); currentPlan = null; }
        }

        if (savedDist) {
            try {
                distributorData = JSON.parse(savedDist) || [];
                if (distributorData.length > 0) renderDistributorGrid();
            } catch (e) { console.error("Failed to load distributor data from storage:", e); distributorData = []; }
        }
    }
    
    function initializeApp() {
        const today = new Date();
        document.getElementById('startDate').value = isoDate(today);
        document.getElementById('endDate').value = isoDate(new Date(today.getTime() + 13 * MS_DAY));
        loadState();
        showTab('inventory');
    }

    // ============================================================================== //
    // 3. INVENTORY TAB LOGIC
    // ============================================================================== //

    function renderInventoryTable() {
        const tbody = document.querySelector('#foodTable tbody');
        tbody.innerHTML = '';
        foodDatabase.sort((a, b) => a.name.localeCompare(b.name));
        foodDatabase.forEach((f, i) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${f.name}</td>
                <td>${f.servings}</td>
                <td>${f.calories}</td>
                <td>${f.protein}</td>
                <td>${f.carbs}</td>
                <td>${f.expiration}</td>
                <td>${f.shoppable ? '✅' : '❌'}</td>
                <td class="actions">
                    <button onclick="window.app.duplicateFood(${i})">Duplicate</button>
                    <button onclick="window.app.editFood(${i})">Edit</button>
                    <button onclick="window.app.deleteFood(${i})">Delete</button>
                </td>`;
            tbody.appendChild(tr);
        });
    }

    function saveFood(e) {
        e.preventDefault();
        const foodItem = {
            name: document.getElementById('name').value.trim(),
            servings: +document.getElementById('servings').value,
            calories: +document.getElementById('calories').value,
            protein: +document.getElementById('protein').value,
            carbs: +document.getElementById('carbs').value,
            sugar: +document.getElementById('sugar').value,
            saturatedFat: +document.getElementById('saturatedFat').value,
            sodium: +document.getElementById('sodium').value,
            expiration: document.getElementById('expiration').value,
            shoppable: document.getElementById('shoppable').checked
        };

        if (!foodItem.name) {
            alert("Food name cannot be empty.");
            return;
        }

        if (editingIndex === null && foodDatabase.some(f => f.name === foodItem.name)) {
            alert(`Food item "${foodItem.name}" already exists. Please choose a different name or edit the existing item.`);
            return;
        }

        if (editingIndex === null) foodDatabase.push(foodItem);
        else foodDatabase[editingIndex] = foodItem;
        
        resetForm();
        renderInventoryTable();
        saveState();
    }

    function editFood(i) {
        const f = foodDatabase[i];
        editingIndex = i;
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

    function deleteFood(i) {
        if (confirm(`Are you sure you want to delete "${foodDatabase[i].name}"? This cannot be undone.`)) {
            foodDatabase.splice(i, 1);
            renderInventoryTable();
            saveState();
        }
    }

    function duplicateFood(i) {
        const duplicatedItem = { ...foodDatabase[i] };
        duplicatedItem.name = `${duplicatedItem.name} (Copy)`;
        foodDatabase.splice(i + 1, 0, duplicatedItem);
        renderInventoryTable();
        saveState();
    }

    function resetForm() {
        document.getElementById('foodForm').reset();
        document.getElementById('shoppable').checked = true;
        editingIndex = null;
        document.getElementById('submitBtn').textContent = 'Add Food';
        document.getElementById('formTitle').textContent = 'Add New Food';
    }

    function loadJSON() {
        try {
            const arr = JSON.parse(document.getElementById('loadArea').value.trim() || '[]');
            if (!Array.isArray(arr)) throw new Error('Input is not a valid JSON array.');
            
            const validatedArr = arr.map(item => ({
                name: String(item.name || `Unnamed Item`).trim(),
                servings: Math.max(0, Number(item.servings || 0)),
                calories: Math.max(0, Number(item.calories || 0)),
                protein: Math.max(0, Number(item.protein || 0)),
                carbs: Math.max(0, Number(item.carbs || 0)),
                sugar: Math.max(0, Number(item.sugar || 0)),
                saturatedFat: Math.max(0, Number(item.saturatedFat || 0)),
                sodium: Math.max(0, Number(item.sodium || 0)),
                expiration: item.expiration ? String(item.expiration) : isoDate(new Date(Date.now() + 365 * MS_DAY)),
                shoppable: typeof item.shoppable === 'boolean' ? item.shoppable : true
            }));

            foodDatabase = validatedArr;
            renderInventoryTable();
            saveState();
            alert('Inventory loaded successfully!');
        } catch (err) {
            alert('Invalid JSON: ' + err.message);
            console.error(err);
        }
    }

    function exportJSON() {
        document.getElementById('exportArea').value = JSON.stringify(foodDatabase, null, 2);
    }
    
    function downloadJSON() {
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

    // ============================================================================== //
    // 4. QUADRATIC PROGRAMMING OPTIMIZATION
    // ============================================================================== //

    /**
     * Simplified Quadratic Programming solver using gradient descent with constraints
     * This approaches the problem as a continuous optimization then discretizes
     */
class QPOptimizer {
    constructor(units, macroGoals, startDate, totalDays) {
        this.units = units;
        this.macroGoals = macroGoals;
        this.startDate = startDate;
        this.totalDays = totalDays;
        this.numUnits = units.length;
        this.macros = Object.keys(this.macroGoals);
        
        // Precompute valid day ranges for each unit
        this.validDayRanges = units.map(unit => {
            const maxDay = unit.expiration ? 
                Math.min(totalDays - 1, Math.floor((unit.expiration.getTime() - startDate.getTime()) / MS_DAY)) :
                totalDays - 1;
            return { min: 0, max: Math.max(-1, maxDay) };
        });
    }

    /**
     * Helper to calculate the nutrient penalty for a single day's totals.
     */
    _calculateDayPenalty(dayTotal) {
        let penalty = 0;
        this.macros.forEach(macro => {
            const { min, max } = this.macroGoals[macro];
            const value = dayTotal[macro];
            const weight = MACRO_WEIGHTS[macro] || 0.1;
            
            let deviation = 0;
            if (value < min) deviation = min - value;
            else if (value > max) deviation = value - max;
            
            if (deviation > 0) {
                const normalizer = (max === Infinity ? min : max) || 1;
                const normalizedDev = deviation / normalizer;
                penalty += weight * normalizedDev * normalizedDev * PENALTY_SCALE_FACTOR;
            }
        });
        return penalty;
    }
    
    /**
     * Helper to determine if a unit is considered "wasted" when unassigned.
     */
    _isWasted(unit) {
        if (unit.type === 'on-hand' && unit.expiration) {
            const daysUntilExpiry = (unit.expiration.getTime() - this.startDate.getTime()) / MS_DAY;
            return daysUntilExpiry < this.totalDays;
        }
        return false;
    }

    /**
     * Compute the full objective function value (quadratic penalty + waste penalty).
     * Used for initialization and verification.
     */
    computeObjective(allocation) {
        const dailyTotals = this._calculateDailyTotals(allocation);
        let totalPenalty = 0;
        
        // Sum nutrient penalties for each day
        dailyTotals.forEach(dayTotal => {
            totalPenalty += this._calculateDayPenalty(dayTotal);
        });

        // Add waste penalty for unassigned, expiring items
        allocation.forEach((day, unitIdx) => {
            if (day === -1 && this._isWasted(this.units[unitIdx])) {
                totalPenalty += 500; // Waste penalty
            }
        });

        return totalPenalty;
    }

    /**
     * Helper to calculate the initial daily nutrient totals for a given allocation.
     */
    _calculateDailyTotals(allocation) {
        const dailyTotals = Array.from({ length: this.totalDays }, () => ({
            calories: 0, carbs: 0, sugar: 0, protein: 0, saturatedFat: 0, sodium: 0
        }));

        allocation.forEach((day, unitIdx) => {
            if (day >= 0 && day < this.totalDays) {
                const unit = this.units[unitIdx];
                this.macros.forEach(macro => {
                    dailyTotals[day][macro] += unit.nutrients[macro] || 0;
                });
            }
        });
        return dailyTotals;
    }
    
    /**
     * **[CORE OPTIMIZATION]**
     * Calculates the change in objective score from moving one unit, without recalculating everything.
     */
    _calculateObjectiveDelta(unit, fromDay, toDay, dailyTotals) {
        if (fromDay === toDay) return 0;

        let delta = 0;

        // 1. Calculate nutrient penalty change
        const oldTotalsFrom = (fromDay !== -1) ? { ...dailyTotals[fromDay] } : null;
        const oldTotalsTo = (toDay !== -1) ? { ...dailyTotals[toDay] } : null;
        
        const oldPenaltyFrom = oldTotalsFrom ? this._calculateDayPenalty(oldTotalsFrom) : 0;
        const oldPenaltyTo = oldTotalsTo ? this._calculateDayPenalty(oldTotalsTo) : 0;
        
        const newTotalsFrom = oldTotalsFrom ? { ...oldTotalsFrom } : null;
        if (newTotalsFrom) {
            this.macros.forEach(m => newTotalsFrom[m] -= unit.nutrients[m] || 0);
        }
        
        const newTotalsTo = oldTotalsTo ? { ...oldTotalsTo } : null;
        if (newTotalsTo) {
            this.macros.forEach(m => newTotalsTo[m] += unit.nutrients[m] || 0);
        }
        
        const newPenaltyFrom = newTotalsFrom ? this._calculateDayPenalty(newTotalsFrom) : 0;
        const newPenaltyTo = newTotalsTo ? this._calculateDayPenalty(newTotalsTo) : 0;

        delta += (newPenaltyFrom + newPenaltyTo) - (oldPenaltyFrom + oldPenaltyTo);

        // 2. Calculate waste penalty change
        const isPotentiallyWasted = this._isWasted(unit);
        if (isPotentiallyWasted) {
            if (fromDay === -1 && toDay !== -1) { // Moving from wasted to used
                delta -= 500;
            } else if (fromDay !== -1 && toDay === -1) { // Moving from used to wasted
                delta += 500;
            }
        }
        
        return delta;
    }
    
    /**
     * Initialize solution using a greedy heuristic
     */
    initializeSolution() {
        // (This function is unchanged as it's efficient enough for a one-time operation)
        const allocation = Array(this.numUnits).fill(-1);
        const dailyDeficits = Array.from({ length: this.totalDays }, () => ({
            calories: this.macroGoals.calories.min,
            protein: this.macroGoals.protein.min,
            carbs: this.macroGoals.carbs.min
        }));

        const unitIndices = Array.from({ length: this.numUnits }, (_, i) => i);
        unitIndices.sort((a, b) => {
            const urgencyA = this.units[a].expiration ? 
                (this.units[a].expiration.getTime() - this.startDate.getTime()) / MS_DAY : Infinity;
            const urgencyB = this.units[b].expiration ? 
                (this.units[b].expiration.getTime() - this.startDate.getTime()) / MS_DAY : Infinity;
            return urgencyA - urgencyB;
        });

        for (const unitIdx of unitIndices) {
            const unit = this.units[unitIdx];
            const range = this.validDayRanges[unitIdx];
            if (range.max < 0) continue;

            let bestDay = -1, bestScore = Infinity;
            for (let day = range.min; day <= range.max; day++) {
                let score = 0;
                Object.keys(dailyDeficits[day]).forEach(macro => {
                    const deficit = dailyDeficits[day][macro];
                    const provided = unit.nutrients[macro] || 0;
                    const weight = MACRO_WEIGHTS[macro] || 0.1;
                    if (deficit > 0) score -= weight * Math.min(deficit, provided);
                    else score += weight * provided * 0.1;
                });
                if (score < bestScore) {
                    bestScore = score;
                    bestDay = day;
                }
            }
            if (bestDay >= 0) {
                allocation[unitIdx] = bestDay;
                Object.keys(dailyDeficits[bestDay]).forEach(macro => {
                    dailyDeficits[bestDay][macro] -= unit.nutrients[macro] || 0;
                });
            }
        }
        return allocation;
    }

    /**
     * Local search optimization using hill climbing with incremental updates.
     */
    localSearch(allocation, iterations = 100) {
        let currentAllocation = [...allocation];
        
        // Perform one full calculation at the start
        const dailyTotals = this._calculateDailyTotals(currentAllocation);
        let currentObjective = this.computeObjective(currentAllocation);

        for (let iter = 0; iter < iterations; iter++) {
            let improved = false;
            
            // Try moving each unit to a different valid day
            for (let unitIdx = 0; unitIdx < this.numUnits; unitIdx++) {
                const unit = this.units[unitIdx];
                const currentDay = currentAllocation[unitIdx];
                const range = this.validDayRanges[unitIdx];
                
                for (let newDay = -1; newDay <= range.max; newDay++) {
                    if (newDay === currentDay) continue;
                    
                    // Use the fast delta calculation
                    const delta = this._calculateObjectiveDelta(unit, currentDay, newDay, dailyTotals);
                    
                    if (delta < -0.01) { // Accept improvement
                        currentObjective += delta;
                        
                        // Update the state incrementally
                        if (currentDay !== -1) this.macros.forEach(m => dailyTotals[currentDay][m] -= unit.nutrients[m] || 0);
                        if (newDay !== -1) this.macros.forEach(m => dailyTotals[newDay][m] += unit.nutrients[m] || 0);
                        currentAllocation[unitIdx] = newDay;
                        
                        improved = true;
                        // Since we made a move, restart the scan for this unit from its new position
                        // This is a "first improvement" strategy which is often faster
                        break; 
                    }
                }
            }
            
            if (!improved) break; // Local optimum reached
        }
        return currentAllocation;
    }

    /**
     * Main optimization routine
     */
    optimize() {
        console.log('Starting QP optimization (Fast Version)...');
        
        let bestAllocation = this.initializeSolution();
        let bestObjective = this.computeObjective(bestAllocation);
        console.log(`Initial objective: ${bestObjective.toFixed(2)}`);
        
        const numRestarts = 3;
        for (let restart = 0; restart < numRestarts; restart++) {
            let allocation = (restart === 0) ? [...bestAllocation] : this.perturbSolution(bestAllocation);
            
            allocation = this.localSearch(allocation, 50);
            const objective = this.computeObjective(allocation); // Full compute only at the end of a search
            
            if (objective < bestObjective) {
                bestObjective = objective;
                bestAllocation = allocation;
                console.log(`Restart ${restart + 1}: Improved objective to ${objective.toFixed(2)}`);
            }
        }
        
        console.log(`Final objective: ${bestObjective.toFixed(2)}`);
        return bestAllocation;
    }

    /**
     * Perturb a solution for restart
     */
    perturbSolution(allocation) {
        // (This function is unchanged)
        const perturbed = [...allocation];
        const numChanges = Math.floor(this.numUnits * 0.1);
        for (let i = 0; i < numChanges; i++) {
            const idx = Math.floor(Math.random() * this.numUnits);
            const range = this.validDayRanges[idx];
            if (range.max >= 0) {
                if (Math.random() < 0.8) {
                    perturbed[idx] = Math.floor(Math.random() * (range.max + 1));
                } else {
                    perturbed[idx] = -1;
                }
            }
        }
        return perturbed;
    }
}
    // ============================================================================== //
    // 5. PLANNER TAB LOGIC (Using QP Optimization)
    // ============================================================================== //
    
    async function generatePlan(isRecalculation = false, recalcParams = {}) {
        console.log(`%c--- Starting Plan Generation with QP (${isRecalculation ? 'Recalculation' : 'Initial'}) ---`, 'color: blue; font-weight: bold;');
        const planBtn = document.getElementById('planBtn');
        const summaryEl = document.getElementById('planSummary');

        const { consumedOnPartialDay, allowShopping = false } = recalcParams;

        if (foodDatabase.length === 0 && !isRecalculation) {
            alert("Please add food to your inventory (Tab 1) first.");
            return;
        }
        planBtn.disabled = true;
        summaryEl.textContent = 'Starting plan optimization...';

        const startDate = isRecalculation ? recalcParams.startDate : parseDateString(document.getElementById('startDate').value);
        const endDate = isRecalculation ? recalcParams.endDate : parseDateString(document.getElementById('endDate').value);
        
        if (!startDate || !endDate || endDate < startDate) {
            alert("Invalid date range selected. Ensure Start Date is before or on End Date.");
            planBtn.disabled = false;
            summaryEl.textContent = 'Plan generation failed: Invalid dates.';
            return;
        }
        
        const planDurationDays = Math.round((endDate.getTime() - startDate.getTime()) / MS_DAY) + 1;
        
        const macroIdMap = { calories: 'cal', carbs: 'carb', sugar: 'sugar', protein: 'protein', saturatedFat: 'sat', sodium: 'sodium' };
        const macros = Object.keys(macroIdMap);
        const macroGoals = isRecalculation ? recalcParams.macroGoals : {};

        if (!isRecalculation) {
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
                
                macroGoals[m] = {
                    min: Number(minEl.value || 0),
                    max: Number(maxEl.value || Infinity)
                };
            });
            if (configError) {
                alert("Configuration error: Some macro goal inputs are missing. Check console.");
                planBtn.disabled = false;
                summaryEl.textContent = 'Plan generation failed: Configuration error.';
                return;
            }
        }
        
        const inventoryForOpt = isRecalculation ? recalcParams.inventory : foodDatabase;
        let units = [];
        inventoryForOpt.forEach((item, index) => {
            const itemData = { itemIndex: index, name: item.name, nutrients: item, expiration: parseDateString(item.expiration) };
            for (let i = 0; i < item.servings; i++) units.push({ ...itemData, type: 'on-hand' });
            
            if (item.shoppable && (!isRecalculation || allowShopping)) {
                for (let i = 0; i < 200; i++) units.push({ ...itemData, type: 'virtual' });
            }
        });

        // Apply partial day consumption if recalculating
        if (consumedOnPartialDay) {
            // Adjust macro goals for the first day
            const adjustedGoals = JSON.parse(JSON.stringify(macroGoals));
            Object.keys(consumedOnPartialDay).forEach(macro => {
                if (adjustedGoals[macro]) {
                    adjustedGoals[macro].min = Math.max(0, adjustedGoals[macro].min - consumedOnPartialDay[macro]);
                    adjustedGoals[macro].max = Math.max(0, adjustedGoals[macro].max - consumedOnPartialDay[macro]);
                }
            });
            macroGoals.firstDayAdjusted = adjustedGoals;
        }
        
        // Run QP optimization
        summaryEl.textContent = 'Running optimization algorithm...';
        await new Promise(resolve => setTimeout(resolve, 10)); // Allow UI update
        
        const optimizer = new QPOptimizer(units, macroGoals, startDate, planDurationDays);
        const bestAllocation = optimizer.optimize();
        
        if (!bestAllocation) {
            planBtn.disabled = false;
            summaryEl.textContent = 'Optimization failed.';
            return;
        }

        const consumption = {};
        const dailySchedule = Array.from({ length: planDurationDays }, () => []);
        bestAllocation.forEach((dayIndex, unitIndex) => {
            if (dayIndex >= 0 && dayIndex < planDurationDays) {
                const unit = units[unitIndex];
                consumption[unit.name] = (consumption[unit.name] || 0) + 1;
                dailySchedule[dayIndex].push(unit.name);
            }
        });

        if (isRecalculation) {
            return { dailySchedule, consumption };
        }
        
        const shoppingList = [];
        const wasteAnalysis = { wasted: [], atRisk: [] };
        
        foodDatabase.forEach(item => {
            const needed = consumption[item.name] || 0;
            const onHand = item.servings;
            const toBuy = needed - onHand;

            if (toBuy > 0 && item.shoppable) {
                shoppingList.push({ name: item.name, toBuy });
            }

            const unscheduled = onHand - needed;

            if (unscheduled > 0) {
                const expiryDate = parseDateString(item.expiration);
                if (expiryDate) {
                    const daysUntilExpiry = (expiryDate.getTime() - startDate.getTime()) / MS_DAY;

                    if (daysUntilExpiry < planDurationDays) {
                        wasteAnalysis.wasted.push({ name: item.name, count: unscheduled });
                    } else {
                        if (needed > 0) {
                            const consumptionRate = needed / planDurationDays;
                            const daysToEatRemainder = unscheduled / consumptionRate;
                            const projectedFinishDays = planDurationDays + daysToEatRemainder;
                            if (projectedFinishDays > daysUntilExpiry) {
                                wasteAnalysis.atRisk.push({ name: item.name, count: unscheduled });
                            }
                        } else {
                            wasteAnalysis.atRisk.push({ name: item.name, count: unscheduled });
                        }
                    }
                }
            }
        });

        currentPlan = { 
            planParameters: { startDate: isoDate(startDate), endDate: isoDate(endDate), duration: planDurationDays, originalGoals: macroGoals }, 
            dailySchedule, consumption, shoppingList, wasteAnalysis 
        };
        
        populateDistributorFromPlan();
        renderPlanResults(currentPlan);
        saveState();

        document.getElementById('config-section').open = false;
        document.getElementById('results-section').open = true;
        document.getElementById('results-section').scrollIntoView({ behavior: 'smooth' });
        planBtn.disabled = false;
        summaryEl.textContent = `Optimization complete. Plan generated for ${planDurationDays} days.`;
    }

    function renderPlanResults(plan) {
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
    
    function renderPlanAverages() {
        if (!distributorData.length || !currentPlan || !currentPlan.planParameters || !currentPlan.planParameters.originalGoals) {
            document.getElementById('planAveragesContainer').innerHTML = 'No plan averages to display.';
            return;
        }

        const averagesContainer = document.getElementById('planAveragesContainer');
        const totalMacros = { calories: 0, carbs: 0, sugar: 0, protein: 0, saturatedFat: 0, sodium: 0 };
        const foodMap = new Map(foodDatabase.map(f => [f.name, f]));
        const macros = Object.keys(currentPlan.planParameters.originalGoals);

        distributorData.forEach(day => {
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

        const numDays = distributorData.length;
        if (numDays === 0) { averagesContainer.innerHTML = ''; return; }
        
        let html = `<strong>Daily Averages:</strong> `;
        for (const macro of macros) {
            const avg = totalMacros[macro] / numDays;
            const goal = currentPlan.planParameters.originalGoals[macro];
            const status = (goal && avg >= goal.min && avg <= goal.max) ? 'good' : 'bad';
            html += `<span class="macro-average ${status}" 
                        title="Goal: ${goal?.min ?? 'N/A'}–${goal?.max === Infinity ? '∞' : (goal?.max ?? 'N/A')}">
                        <strong>${macro}:</strong> ${Math.round(avg)}
                    </span>`;
        }
        averagesContainer.innerHTML = html;
    }

    function commitPlanToInventory() {
        if (!currentPlan || !currentPlan.consumption) {
            alert("No plan computed to commit. Generate a plan first.");
            return;
        }
        if (!confirm("This action will permanently subtract the 'consumed' food from your inventory (Tab 1). Are you sure?")) {
            return;
        }

        const consumption = currentPlan.consumption;
        foodDatabase.forEach(item => {
            const consumedCount = consumption[item.name] || 0;
            item.servings = Math.max(0, item.servings - consumedCount);
        });

        renderInventoryTable();
        saveState();
        alert("Inventory has been updated based on the plan's consumption.");
        showTab('inventory');
    }
    
    // ============================================================================== //
    // 6. DAILY PLAN GRID LOGIC (Interactive Distributor)
    // ============================================================================== //

    function populateDistributorFromPlan() {
        if (!currentPlan || !currentPlan.dailySchedule) {
            alert("No plan generated yet. Please generate a plan on the 'Create & View Plan' tab first.");
            return;
        }
        distributorData = [];

        currentPlan.dailySchedule.forEach((dayItems, dayIndex) => {
            const dayMeals = {};
            MEAL_NAMES.forEach(name => dayMeals[name] = { items: [], completed: false });

            dayItems.forEach((item, itemQueueIndex) => {
                const mealName = MEAL_NAMES[itemQueueIndex % 3];
                dayMeals[mealName].items.push(item);
            });
            distributorData.push({ day: dayIndex + 1, meals: dayMeals });
        });
        renderDistributorGrid();
    }

    function renderDistributorGrid() {
        const gridDiv = document.getElementById('plan-grid');
        const foodMap = new Map(foodDatabase.map(f => [f.name, f]));
        gridDiv.innerHTML = '';

        distributorData.forEach((dayData, dayIndex) => {
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
        saveState();
    }

    function toggleMealComplete(dayIndex, mealName) {
        if (distributorData[dayIndex] && distributorData[dayIndex].meals[mealName]) {
            distributorData[dayIndex].meals[mealName].completed = !distributorData[dayIndex].meals[mealName].completed;
            renderDistributorGrid();
        }
    }
    
    async function recalculatePlan() {
        if (!currentPlan) { alert("Generate a plan first."); return; }

        const dialogMessage = "Allow re-optimization to add new items to the shopping list?\n\n" +
                              "- Click OK (Yes) to find the best possible plan, which may require buying new food.\n" +
                              "- Click Cancel (No) to only use food you already have on hand.";
        const allowShopping = confirm(dialogMessage);
        
        let firstUncompleted = null;
        const foodMap = new Map(foodDatabase.map(f => [f.name, f]));

        for(let i = 0; i < distributorData.length; i++) {
            for(const mealName of MEAL_NAMES) {
                const meal = distributorData[i].meals[mealName];
                if (!meal) continue;

                if (!meal.completed && !firstUncompleted) {
                    firstUncompleted = { dayIndex: i, mealName: mealName };
                }
            }
        }
        
        if (!firstUncompleted) {
            alert("All meals are marked complete. Nothing left to re-optimize!");
            return;
        }

        const consumedOnPartialDay = { calories: 0, carbs: 0, sugar: 0, protein: 0, saturatedFat: 0, sodium: 0 };
        MEAL_NAMES.forEach(mealName => {
            const meal = distributorData[firstUncompleted.dayIndex].meals[mealName];
            if (meal && meal.completed) {
                 meal.items.forEach(itemName => {
                    const food = foodMap.get(itemName);
                    if (food) Object.keys(consumedOnPartialDay).forEach(macro => consumedOnPartialDay[macro] += food[macro] || 0);
                });
            }
        });

        const originalGoals = currentPlan.planParameters.originalGoals;
        
        const consumedItemsCount = {};
        distributorData.forEach((day, dayIndex) => {
            if (dayIndex < firstUncompleted.dayIndex) {
                MEAL_NAMES.forEach(mealName => {
                    const meal = day.meals[mealName];
                    if (meal && meal.items) {
                        meal.items.forEach(itemName => {
                            consumedItemsCount[itemName] = (consumedItemsCount[itemName] || 0) + 1;
                        });
                    }
                });
            } else if (dayIndex === firstUncompleted.dayIndex) {
                MEAL_NAMES.forEach(mealName => {
                    const meal = day.meals[mealName];
                    if (meal && meal.completed) {
                        meal.items.forEach(itemName => {
                            consumedItemsCount[itemName] = (consumedItemsCount[itemName] || 0) + 1;
                        });
                    }
                });
            }
        });
        
        const remainingInventory = foodDatabase.map(foodItem => {
            const consumed = consumedItemsCount[foodItem.name] || 0;
            const remainingServings = foodItem.servings - consumed;
            if (remainingServings > 0) {
                return { ...foodItem, servings: remainingServings };
            }
            return null;
        }).filter(Boolean);
        
        const originalStartDate = parseDateString(currentPlan.planParameters.startDate);
        const recalcStartDate = new Date(originalStartDate.getTime() + firstUncompleted.dayIndex * MS_DAY);
        const recalcEndDate = parseDateString(currentPlan.planParameters.endDate);
        
        if (recalcStartDate > recalcEndDate) {
            alert("No future days left to re-optimize.");
            return;
        }

        alert("Re-optimizing the remaining plan. Please wait...");
        const recalcResult = await generatePlan(true, {
            startDate: recalcStartDate,
            endDate: recalcEndDate,
            macroGoals: originalGoals,
            inventory: remainingInventory,
            consumedOnPartialDay: consumedOnPartialDay,
            allowShopping: allowShopping
        });

        if (recalcResult && recalcResult.dailySchedule) {
            distributorData.forEach((day, dayIndex) => {
                if (dayIndex >= firstUncompleted.dayIndex) {
                    MEAL_NAMES.forEach(mealName => {
                        const meal = day.meals[mealName];
                        if (meal && !meal.completed) {
                            meal.items = [];
                        }
                    });
                }
            });

            recalcResult.dailySchedule.forEach((newDayItems, i) => {
                const targetDayIndex = firstUncompleted.dayIndex + i;
                if (targetDayIndex < distributorData.length) {
                    newDayItems.forEach((item, itemQueueIndex) => {
                        const mealName = MEAL_NAMES[itemQueueIndex % 3];
                        const targetMeal = distributorData[targetDayIndex].meals[mealName];
                        if (targetMeal && !targetMeal.completed) {
                            targetMeal.items.push(item);
                        }
                    });
                }
            });
            
            const newTotalConsumption = { ...consumedItemsCount };
            for (const [name, count] of Object.entries(recalcResult.consumption)) {
                newTotalConsumption[name] = (newTotalConsumption[name] || 0) + count;
            }
            currentPlan.consumption = newTotalConsumption;

            const newShoppingList = [];
            const newWasteAnalysis = { wasted: [], atRisk: [] };
            const planDurationDays = currentPlan.planParameters.duration;
            const planStartDate = parseDateString(currentPlan.planParameters.startDate);
            
            foodDatabase.forEach(item => {
                const needed = newTotalConsumption[item.name] || 0;
                const onHand = item.servings;
                const toBuy = needed - onHand;

                if (toBuy > 0 && item.shoppable) {
                    newShoppingList.push({ name: item.name, toBuy });
                }

                const unscheduled = onHand - (needed || 0);
                if (unscheduled > 0) {
                    const expiryDate = parseDateString(item.expiration);
                    if (expiryDate) {
                        const daysUntilExpiry = (expiryDate.getTime() - planStartDate.getTime()) / MS_DAY;
                        if (daysUntilExpiry < planDurationDays) {
                            newWasteAnalysis.wasted.push({ name: item.name, count: unscheduled });
                        } else if (needed > 0) {
                            const consumptionRate = needed / planDurationDays;
                            const daysToEatRemainder = unscheduled / consumptionRate;
                            if (planDurationDays + daysToEatRemainder > daysUntilExpiry) {
                                newWasteAnalysis.atRisk.push({ name: item.name, count: unscheduled });
                            }
                        } else {
                            newWasteAnalysis.atRisk.push({ name: item.name, count: unscheduled });
                        }
                    }
                }
            });

            currentPlan.shoppingList = newShoppingList;
            currentPlan.wasteAnalysis = newWasteAnalysis;
            
            alert("Future plan has been re-optimized and updated!");
            renderPlanResults(currentPlan);
            renderDistributorGrid();
            saveState();
        } else {
            alert("Re-optimization failed to produce a valid result.");
        }
    }

    function addDragDropListeners() {
        const lists = document.querySelectorAll('.food-list');
        const items = document.querySelectorAll('.food-list li');

        items.forEach(item => {
            item.addEventListener('dragstart', e => {
                const list = e.target.closest('.food-list');
                const dayIndex = parseInt(list.dataset.dayIndex);
                const mealName = list.dataset.mealName;
                const itemIndex = parseInt(e.target.dataset.itemIndex);
                
                draggedItemInfo = { dayIndex, mealName, itemIndex, text: e.target.textContent };
                e.target.classList.add('dragging');
                e.dataTransfer.setData('text/plain', JSON.stringify(draggedItemInfo));
            });
            item.addEventListener('dragend', e => {
                e.target.classList.remove('dragging');
                draggedItemInfo = null;
            });
        });

        lists.forEach(list => {
            list.addEventListener('dragover', e => {
                e.preventDefault();
                const targetDayIndex = parseInt(list.dataset.dayIndex);
                const targetMealName = list.dataset.mealName;

                if (distributorData[targetDayIndex].meals[targetMealName] && !distributorData[targetDayIndex].meals[targetMealName].completed) {
                    list.classList.add('drag-over');
                } else {
                    list.classList.remove('drag-over');
                }
            });
            list.addEventListener('dragleave', () => list.classList.remove('drag-over'));
            list.addEventListener('drop', e => {
                e.preventDefault();
                list.classList.remove('drag-over');

                if (!draggedItemInfo) return;

                const targetDayIndex = parseInt(list.dataset.dayIndex);
                const targetMealName = list.dataset.mealName;

                if (distributorData[targetDayIndex].meals[targetMealName] && distributorData[targetDayIndex].meals[targetMealName].completed) {
                    alert("Cannot move food into a completed meal.");
                    return;
                }
                
                const itemToMove = distributorData[draggedItemInfo.dayIndex].meals[draggedItemInfo.mealName].items.splice(draggedItemInfo.itemIndex, 1)[0];
                distributorData[targetDayIndex].meals[targetMealName].items.push(itemToMove);

                renderDistributorGrid();
            });
        });
    }

    // ============================================================================== //
    // 7. EVENT LISTENERS & GLOBAL EXPOSURE
    // ============================================================================== //

    window.app = {
        showTab, saveFood, editFood, deleteFood, duplicateFood, resetForm,
        loadJSON, exportJSON, downloadJSON,
        generatePlan, commitPlanToInventory,
        toggleMealComplete, recalculatePlan,
    };

    document.addEventListener('DOMContentLoaded', initializeApp);
    document.getElementById('planBtn').addEventListener('click', () => generatePlan());

})();