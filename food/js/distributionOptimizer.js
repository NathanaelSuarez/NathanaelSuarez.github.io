// ============================================================================== //
// DISTRIBUTION OPTIMIZER.JS - PHASE 2: DETAILED SCHEDULING
// ============================================================================== //
// This optimizer takes a pre-selected 'pool' of food items and assigns each
// item to a specific day to make daily macros as consistent as possible,
// while respecting expiration dates and daily consumption limits.
// ============================================================================== //

import { MS_DAY, MACRO_WEIGHTS, PENALTY_SCALE_FACTOR, LIMIT_VIOLATION_PENALTY } from './utils.js';

export default class DistributionOptimizer {
    constructor(foodPool, macroGoals, startDate, totalDays, optimizationStrength) {
        this.units = foodPool;
        this.macroGoals = macroGoals;
        this.startDate = startDate;
        this.totalDays = totalDays;
        this.numUnits = foodPool.length;
        this.macros = Object.keys(this.macroGoals);
        this.optimizationStrength = optimizationStrength;

        // Pre-calculate valid day ranges for each unit based on expiration
        this.unitExpiryInfo = this.units.map(unit => {
            const daysUntilExpiry = unit.expiration ?
                (unit.expiration.getTime() - startDate.getTime()) / MS_DAY : Infinity;
            const maxDay = Math.min(totalDays - 1, Math.floor(daysUntilExpiry));
            return { validDayRange: { min: 0, max: Math.max(-1, maxDay) } };
        });
    }

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
    
    computeObjective(allocation) {
        const { dailyTotals, dailyFoodCounts } = this._calculateDailyTotalsAndCounts(allocation);
        let totalPenalty = 0;
        
        // 1. Daily Macro Penalty
        dailyTotals.forEach(dayTotal => {
            totalPenalty += this._calculateDayPenalty(dayTotal);
        });

        // 2. Daily Limit Violation Penalty
        dailyFoodCounts.forEach(dayCounts => {
            for (const [foodName, count] of Object.entries(dayCounts)) {
                const foodUnitExample = this.units.find(u => u.name === foodName);
                if (foodUnitExample && foodUnitExample.maxPerDay && count > foodUnitExample.maxPerDay) {
                    totalPenalty += (count - foodUnitExample.maxPerDay) * LIMIT_VIOLATION_PENALTY;
                }
            }
        });
        // NOTE: No waste penalty here! That was handled in Phase 1.
        return totalPenalty;
    }

    _calculateDailyTotalsAndCounts(allocation) {
        const dailyTotals = Array.from({ length: this.totalDays }, () => ({
            calories: 0, carbs: 0, sugar: 0, protein: 0, saturatedFat: 0, sodium: 0, fiber: 0
        }));
        const dailyFoodCounts = Array.from({ length: this.totalDays }, () => ({}));

        allocation.forEach((day, unitIdx) => {
            if (day >= 0 && day < this.totalDays) {
                const unit = this.units[unitIdx];
                this.macros.forEach(macro => dailyTotals[day][macro] += unit.nutrients[macro] || 0);
                dailyFoodCounts[day][unit.name] = (dailyFoodCounts[day][unit.name] || 0) + 1;
            }
        });
        return { dailyTotals, dailyFoodCounts };
    }
    
    // Greedy initialization: assign each item to the day where it helps the most
    initializeSolution() {
        const allocation = Array(this.numUnits).fill(-1);
        const dailyTotals = Array.from({ length: this.totalDays }, () => ({}));

        this.units.forEach((unit, unitIdx) => {
            const range = this.unitExpiryInfo[unitIdx].validDayRange;
            if (range.max < 0) return; // Cannot be scheduled

            let bestDay = -1;
            let lowestPenaltyIncrease = Infinity;

            for (let day = range.min; day <= range.max; day++) {
                const oldDayTotal = dailyTotals[day] || {};
                const oldPenalty = this._calculateDayPenalty(oldDayTotal);
                
                const newDayTotal = { ...oldDayTotal };
                this.macros.forEach(m => newDayTotal[m] = (newDayTotal[m] || 0) + (unit.nutrients[m] || 0));
                
                const newPenalty = this._calculateDayPenalty(newDayTotal);
                const penaltyIncrease = newPenalty - oldPenalty;

                if (penaltyIncrease < lowestPenaltyIncrease) {
                    lowestPenaltyIncrease = penaltyIncrease;
                    bestDay = day;
                }
            }

            if (bestDay !== -1) {
                allocation[unitIdx] = bestDay;
                const finalDayTotal = dailyTotals[bestDay] || {};
                this.macros.forEach(m => finalDayTotal[m] = (finalDayTotal[m] || 0) + (unit.nutrients[m] || 0));
                dailyTotals[bestDay] = finalDayTotal;
            }
        });
        return allocation;
    }

    // A simple local search: try moving one item to a different valid day
    localSearch(allocation) {
        let currentAllocation = [...allocation];
        for (let unitIdx = 0; unitIdx < this.numUnits; unitIdx++) {
            const currentDay = currentAllocation[unitIdx];
            const range = this.unitExpiryInfo[unitIdx].validDayRange;
            let bestDay = currentDay;
            let bestObjective = this.computeObjective(currentAllocation);

            for (let newDay = range.min; newDay <= range.max; newDay++) {
                if (newDay === currentDay) continue;
                currentAllocation[unitIdx] = newDay;
                const newObjective = this.computeObjective(currentAllocation);
                if (newObjective < bestObjective) {
                    bestObjective = newObjective;
                    bestDay = newDay;
                }
            }
            currentAllocation[unitIdx] = bestDay; // Commit the best move for this item
        }
        return currentAllocation;
    }

    perturbSolution(allocation) {
        const perturbed = [...allocation];
        const numChanges = Math.floor(this.numUnits * 0.1);
        for (let i = 0; i < numChanges; i++) {
            const idx = Math.floor(Math.random() * this.numUnits);
            const range = this.unitExpiryInfo[idx].validDayRange;
            if (range.max >= 0) {
                 perturbed[idx] = Math.floor(Math.random() * (range.max + 1));
            }
        }
        return perturbed;
    }

    async optimize(onProgress = () => {}) {
        console.log('Starting Phase 2: Distribution Optimization...');
        let bestAllocation = this.initializeSolution();
        let bestObjective = this.computeObjective(bestAllocation);
        console.log(`Initial distribution objective: ${bestObjective.toFixed(2)}`);
        
        for (let restart = 0; restart < this.optimizationStrength; restart++) {
            // Provide progress update
            await onProgress('Distributing Meals', restart + 1, this.optimizationStrength);
            
            let allocation = this.perturbSolution(bestAllocation);
            allocation = this.localSearch(allocation);
            const objective = this.computeObjective(allocation);
            
            if (objective < bestObjective) {
                bestObjective = objective;
                bestAllocation = allocation;
                console.log(`Distribution Restart ${restart + 1}: Improved objective to ${objective.toFixed(2)}`);
            }
        }
        console.log(`Final distribution objective: ${bestObjective.toFixed(2)}`);
        return bestAllocation;
    }
}