import { MS_DAY, MACRO_WEIGHTS, PENALTY_SCALE_FACTOR, WASTE_PENALTY, URGENCY_PENALTY_FACTOR, LIMIT_VIOLATION_PENALTY } from './utils.js';

export default class QPOptimizer {
    constructor(units, macroGoals, startDate, totalDays, optimizationStrength) {
        this.units = units;
        this.macroGoals = macroGoals;
        this.startDate = startDate;
        this.totalDays = totalDays;
        this.numUnits = units.length;
        this.macros = Object.keys(this.macroGoals);
        this.optimizationStrength = optimizationStrength || 5;

        this.unitExpiryInfo = units.map(unit => {
            const daysUntilExpiry = unit.expiration ?
                (unit.expiration.getTime() - startDate.getTime()) / MS_DAY : Infinity;
            
            const maxDay = daysUntilExpiry === Infinity ?
                           totalDays - 1 :
                           Math.min(totalDays - 1, Math.floor(daysUntilExpiry));
            
            return {
                daysUntilExpiry: daysUntilExpiry,
                validDayRange: { min: 0, max: Math.max(-1, maxDay) }
            };
        });
    }

    _getUnassignedPenalty(unitInfo) {
        if (unitInfo.daysUntilExpiry < this.totalDays) {
            return WASTE_PENALTY;
        }
        if (unitInfo.daysUntilExpiry !== Infinity) {
            return URGENCY_PENALTY_FACTOR / (unitInfo.daysUntilExpiry - this.totalDays + 1);
        }
        return 0;
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
        
        dailyTotals.forEach(dayTotal => {
            totalPenalty += this._calculateDayPenalty(dayTotal);
        });

        dailyFoodCounts.forEach(dayCounts => {
            for (const [foodName, count] of Object.entries(dayCounts)) {
                const foodUnitExample = this.units.find(u => u.name === foodName);
                if (foodUnitExample && foodUnitExample.maxPerDay && count > foodUnitExample.maxPerDay) {
                    totalPenalty += (count - foodUnitExample.maxPerDay) * LIMIT_VIOLATION_PENALTY;
                }
            }
        });

        allocation.forEach((day, unitIdx) => {
            if (day === -1 && this.units[unitIdx].type === 'on-hand') {
                totalPenalty += this._getUnassignedPenalty(this.unitExpiryInfo[unitIdx]);
            }
        });

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
                this.macros.forEach(macro => {
                    dailyTotals[day][macro] += unit.nutrients[macro] || 0;
                });
                dailyFoodCounts[day][unit.name] = (dailyFoodCounts[day][unit.name] || 0) + 1;
            }
        });
        return { dailyTotals, dailyFoodCounts };
    }
    
    _calculateObjectiveDelta(unit, unitIdx, fromDay, toDay, dailyTotals, dailyFoodCounts) {
        if (fromDay === toDay) return 0;
        let delta = 0;
        const oldTotalsFrom = (fromDay !== -1) ? { ...dailyTotals[fromDay] } : null;
        const oldTotalsTo = (toDay !== -1) ? { ...dailyTotals[toDay] } : null;
        const oldPenaltyFrom = oldTotalsFrom ? this._calculateDayPenalty(oldTotalsFrom) : 0;
        const oldPenaltyTo = oldTotalsTo ? this._calculateDayPenalty(oldTotalsTo) : 0;
        const newTotalsFrom = oldTotalsFrom ? { ...oldTotalsFrom } : null;
        if (newTotalsFrom) this.macros.forEach(m => newTotalsFrom[m] -= unit.nutrients[m] || 0);
        const newTotalsTo = oldTotalsTo ? { ...oldTotalsTo } : null;
        if (newTotalsTo) this.macros.forEach(m => newTotalsTo[m] += unit.nutrients[m] || 0);
        const newPenaltyFrom = newTotalsFrom ? this._calculateDayPenalty(newTotalsFrom) : 0;
        const newPenaltyTo = newTotalsTo ? this._calculateDayPenalty(newTotalsTo) : 0;
        delta += (newPenaltyFrom + newPenaltyTo) - (oldPenaltyFrom + oldPenaltyTo);

        if (unit.type === 'on-hand') {
            const unitInfo = this.unitExpiryInfo[unitIdx];
            const unassignedPenalty = this._getUnassignedPenalty(unitInfo);
            if (fromDay === -1 && toDay !== -1) delta -= unassignedPenalty;
            else if (fromDay !== -1 && toDay === -1) delta += unassignedPenalty;
        }
        
        const limit = unit.maxPerDay || 99;
        if (fromDay !== -1) {
            const currentCount = dailyFoodCounts[fromDay][unit.name] || 0;
            if (currentCount > limit && currentCount - 1 <= limit) {
                delta -= LIMIT_VIOLATION_PENALTY * (currentCount - limit);
            }
        }
        if (toDay !== -1) {
            const currentCount = dailyFoodCounts[toDay][unit.name] || 0;
            if (currentCount >= limit) {
                delta += LIMIT_VIOLATION_PENALTY;
            }
        }
        return delta;
    }
    
    initializeSolution() {
        const allocation = Array(this.numUnits).fill(-1);
        const dailyDeficits = Array.from({ length: this.totalDays }, () => ({
            calories: this.macroGoals.calories.min, protein: this.macroGoals.protein.min, carbs: this.macroGoals.carbs.min
        }));
        const unitIndices = Array.from({ length: this.numUnits }, (_, i) => i);
        unitIndices.sort((a, b) => this.unitExpiryInfo[a].daysUntilExpiry - this.unitExpiryInfo[b].daysUntilExpiry);

        for (const unitIdx of unitIndices) {
            const unit = this.units[unitIdx];
            const range = this.unitExpiryInfo[unitIdx].validDayRange;
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

    localSearch(allocation, iterations = 100) {
        let currentAllocation = [...allocation];
        const { dailyTotals, dailyFoodCounts } = this._calculateDailyTotalsAndCounts(currentAllocation);
        let currentObjective = this.computeObjective(currentAllocation);
        for (let iter = 0; iter < iterations; iter++) {
            let improved = false;
            for (let unitIdx = 0; unitIdx < this.numUnits; unitIdx++) {
                const unit = this.units[unitIdx];
                const currentDay = currentAllocation[unitIdx];
                const range = this.unitExpiryInfo[unitIdx].validDayRange;
                const possibleDays = [-1];
                for(let d=range.min; d <= range.max; d++) possibleDays.push(d);
                for (const newDay of possibleDays) {
                    if (newDay === currentDay) continue;
                    const delta = this._calculateObjectiveDelta(unit, unitIdx, currentDay, newDay, dailyTotals, dailyFoodCounts);
                    if (delta < -0.01) { 
                        currentObjective += delta;
                        if (currentDay !== -1) {
                            this.macros.forEach(m => dailyTotals[currentDay][m] -= unit.nutrients[m] || 0);
                            dailyFoodCounts[currentDay][unit.name]--;
                            if(dailyFoodCounts[currentDay][unit.name] === 0) delete dailyFoodCounts[currentDay][unit.name];
                        }
                        if (newDay !== -1) {
                            this.macros.forEach(m => dailyTotals[newDay][m] += unit.nutrients[m] || 0);
                            dailyFoodCounts[newDay][unit.name] = (dailyFoodCounts[newDay][unit.name] || 0) + 1;
                        }
                        currentAllocation[unitIdx] = newDay;
                        improved = true;
                        break; 
                    }
                }
            }
            if (!improved) break; 
        }
        return currentAllocation;
    }

    optimize() {
        console.log('Starting QP optimization with Urgency Penalty and Daily Limits...');
        let bestAllocation = this.initializeSolution();
        let bestObjective = this.computeObjective(bestAllocation);
        console.log(`Initial objective: ${bestObjective.toFixed(2)}`);
        const numRestarts = this.optimizationStrength;
        console.log(`Running with ${numRestarts} restarts (strength)...`);
        for (let restart = 0; restart < numRestarts; restart++) {
            let allocation = (restart === 0) ? [...bestAllocation] : this.perturbSolution(bestAllocation);
            allocation = this.localSearch(allocation, 50);
            const objective = this.computeObjective(allocation);
            if (objective < bestObjective) {
                bestObjective = objective;
                bestAllocation = allocation;
                console.log(`Restart ${restart + 1}: Improved objective to ${objective.toFixed(2)}`);
            }
        }
        console.log(`Final objective: ${bestObjective.toFixed(2)}`);
        return bestAllocation;
    }

    perturbSolution(allocation) {
        const perturbed = [...allocation];
        const numChanges = Math.floor(this.numUnits * 0.1);
        for (let i = 0; i < numChanges; i++) {
            const idx = Math.floor(Math.random() * this.numUnits);
            const range = this.unitExpiryInfo[idx].validDayRange;
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