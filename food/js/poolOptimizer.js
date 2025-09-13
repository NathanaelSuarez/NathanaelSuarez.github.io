// ============================================================================== //
// POOL OPTIMIZER.JS - PHASE 1: AGGREGATE PLANNING
// ============================================================================== //
// This optimizer determines the ideal *collection* of food items to consume
// over the entire planning period to meet average macro goals and minimize waste.
// It does NOT assign items to specific days.
// ============================================================================== //

import { MS_DAY, MACRO_WEIGHTS, WASTE_PENALTY, URGENCY_PENALTY_FACTOR } from './utils.js';

export default class PoolOptimizer {
    constructor(units, macroGoals, startDate, totalDays, optimizationStrength) {
        this.units = units;
        this.numUnits = units.length;
        this.totalDays = totalDays;
        this.optimizationStrength = optimizationStrength;
        this.macros = Object.keys(macroGoals);

        // --- FIX 1: Calculate MIN and MAX totals, not a midpoint target. ---
        // This is the key to solving the low-calorie problem. We need to ensure the
        // pool has enough food to meet the daily minimums, not just an average.
        this.minTotals = {};
        this.maxTotals = {};
        this.macros.forEach(macro => {
            const goal = macroGoals[macro];
            this.minTotals[macro] = goal.min * totalDays;
            this.maxTotals[macro] = (goal.max === Infinity) ? Infinity : goal.max * totalDays;
        });

        // --- FIX 2: Calculate detailed expiry info to re-introduce the Urgency Penalty. ---
        this.unitExpiryInfo = units.map(unit => {
            const daysUntilExpiry = unit.expiration ?
                (unit.expiration.getTime() - startDate.getTime()) / MS_DAY : Infinity;
            return {
                daysUntilExpiry: daysUntilExpiry,
                expiresInPlan: daysUntilExpiry < totalDays
            };
        });
    }

    computeObjective(selection) {
        let penalty = 0;
        const currentTotals = {};
        this.macros.forEach(m => currentTotals[m] = 0);

        // Sum macros for all selected items
        selection.forEach((isSelected, unitIdx) => {
            if (isSelected) {
                const unit = this.units[unitIdx];
                this.macros.forEach(m => currentTotals[m] += unit.nutrients[m] || 0);
            }
        });

        // 1. Macro Deviation Penalty (deviation from the TOTAL min/max range)
        this.macros.forEach(macro => {
            let deviation = 0;
            // Penalize for being below the total minimum or above the total maximum.
            if (currentTotals[macro] < this.minTotals[macro]) {
                deviation = this.minTotals[macro] - currentTotals[macro];
            } else if (currentTotals[macro] > this.maxTotals[macro]) {
                deviation = currentTotals[macro] - this.maxTotals[macro];
            }
            
            if (deviation > 0) {
                const weight = MACRO_WEIGHTS[macro] || 0.1;
                // Use minTotals for normalization as it's a more stable base than max.
                const normalizer = this.minTotals[macro] || 1;
                const normalizedDev = deviation / normalizer;
                penalty += weight * normalizedDev * normalizedDev;
            }
        });

        // 2. Waste & Urgency Penalty
        selection.forEach((isSelected, unitIdx) => {
            if (!isSelected && this.units[unitIdx].type === 'on-hand') {
                const unitInfo = this.unitExpiryInfo[unitIdx];
                if (unitInfo.expiresInPlan) {
                    // Huge penalty for definite waste
                    penalty += WASTE_PENALTY;
                } else if (unitInfo.daysUntilExpiry !== Infinity) {
                    // Smaller, decaying penalty for "at risk" items
                    const daysAfterPlan = unitInfo.daysUntilExpiry - this.totalDays + 1;
                    penalty += URGENCY_PENALTY_FACTOR / daysAfterPlan;
                }
            }
        });

        return penalty;
    }

    initializeSolution() {
        // Start by selecting all on-hand items that will expire during the plan
        return this.units.map((unit, i) =>
            unit.type === 'on-hand' && this.unitExpiryInfo[i].expiresInPlan
        );
    }

    // A simple local search: try flipping each item and see if it improves the score
    localSearch(selection) {
        let currentSelection = [...selection];
        let currentObjective = this.computeObjective(currentSelection);
        let improved = true;
        while (improved) {
            improved = false;
            for (let i = 0; i < this.numUnits; i++) {
                currentSelection[i] = !currentSelection[i]; // Flip the item
                const newObjective = this.computeObjective(currentSelection);
                if (newObjective < currentObjective) {
                    currentObjective = newObjective;
                    improved = true;
                } else {
                    currentSelection[i] = !currentSelection[i]; // Flip it back
                }
            }
        }
        return currentSelection;
    }

    perturbSolution(selection) {
        const perturbed = [...selection];
        const numChanges = Math.floor(this.numUnits * 0.1); // Perturb 10%
        for (let i = 0; i < numChanges; i++) {
            const idx = Math.floor(Math.random() * this.numUnits);
            perturbed[idx] = !perturbed[idx];
        }
        return perturbed;
    }

    async optimize(onProgress = () => {}) {
        console.log('Starting Phase 1: Pool Optimization...');
        let bestSelection = this.initializeSolution();
        bestSelection = this.localSearch(bestSelection);
        let bestObjective = this.computeObjective(bestSelection);
        console.log(`Initial pool objective: ${bestObjective.toFixed(2)}`);

        for (let restart = 0; restart < this.optimizationStrength; restart++) {
            // Provide progress update
            await onProgress('Selecting Food Pool', restart + 1, this.optimizationStrength);
            
            let selection = this.perturbSolution(bestSelection);
            selection = this.localSearch(selection);
            const objective = this.computeObjective(selection);
            
            if (objective < bestObjective) {
                bestObjective = objective;
                bestSelection = selection;
                console.log(`Pool Restart ${restart + 1}: Improved objective to ${objective.toFixed(2)}`);
            }
        }
        console.log(`Final pool objective: ${bestObjective.toFixed(2)}`);
        
        // Return the final list of units that were selected
        return this.units.filter((_, i) => bestSelection[i]);
    }
}