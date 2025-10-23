// ============================================================================== //
// GENETIC OPTIMIZER.JS - COMPLETE MEAL PLANNER
// ============================================================================== //
// This file contains a Genetic Algorithm to solve the entire meal scheduling
// problem in a single phase. It assigns on-hand food items to specific days
// to minimize macro deviations and waste, and can incorporate a greedy
// shopping algorithm to fill nutritional gaps.
// ============================================================================== //

import * as state from './state.js';
import { MS_DAY, MACRO_WEIGHTS, PENALTY_SCALE_FACTOR, WASTE_PENALTY, LIMIT_VIOLATION_PENALTY, MACROS, parseDateString } from './utils.js';

export default class GeneticAlgorithmPlanner {
    constructor(units, macroGoals, startDate, totalDays, gaParams, allowShopping, consumedOnFirstDay = null) {
        this.units = units;
        this.macroGoals = macroGoals;
        this.startDate = startDate;
        this.totalDays = totalDays;
        this.numUnits = units.length;
        this.params = gaParams;
        this.allowShopping = allowShopping;
        this.consumedOnFirstDay = consumedOnFirstDay;

        this.unitExpiryInfo = units.map(unit => {
            const daysUntilExpiry = unit.expiration ?
                (parseDateString(unit.expiration).getTime() - startDate.getTime()) / MS_DAY : Infinity;
            const maxDay = Math.min(totalDays - 1, Math.floor(daysUntilExpiry));
            return {
                daysUntilExpiry,
                validDayRange: { min: 0, max: Math.max(-1, maxDay) }
            };
        });
        
        this.foodDbInfo = new Map();
        this.units.forEach((unit, index) => {
            if (unit.isVirtual) return;
            const existingInfo = this.foodDbInfo.get(unit.name);
            if (existingInfo) {
                existingInfo.onHand += 1;
            } else {
                const daysUntilExpiry = this.unitExpiryInfo[index].daysUntilExpiry;
                this.foodDbInfo.set(unit.name, {
                    onHand: 1,
                    daysUntilExpiry: daysUntilExpiry
                });
            }
        });
    }

    _calculateDayPenalty(dayTotal) {
        let penalty = 0;
        MACROS.forEach(macro => {
            const { min, max } = this.macroGoals[macro];
            const value = dayTotal[macro] || 0;
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

    calculateFitness(individual) {
        let totalPenalty = 0;
        const dailyTotals = Array.from({ length: this.totalDays }, () => Object.fromEntries(MACROS.map(key => [key, 0])));
        const dailyFoodCounts = Array.from({ length: this.totalDays }, () => ({}));
        const onHandConsumption = {}; 
        
        if (this.consumedOnFirstDay && this.totalDays > 0) {
            MACROS.forEach(m => dailyTotals[0][m] += this.consumedOnFirstDay.macros[m] || 0);
        }
        
        individual.forEach((day, unitIdx) => {
            if (day >= 0 && day < this.totalDays) {
                const unit = this.units[unitIdx];
                MACROS.forEach(macro => { dailyTotals[day][macro] += unit.nutrients[macro] || 0; });
                dailyFoodCounts[day][unit.name] = (dailyFoodCounts[day][unit.name] || 0) + 1;
                
                if (!unit.isVirtual) {
                    onHandConsumption[unit.name] = (onHandConsumption[unit.name] || 0) + 1;
                }
            }
        });

        // Augment the first day's counts with pre-consumed items for maxPerDay checking
        if (this.consumedOnFirstDay?.itemCounts && this.totalDays > 0) {
            for (const [foodName, count] of Object.entries(this.consumedOnFirstDay.itemCounts)) {
                dailyFoodCounts[0][foodName] = (dailyFoodCounts[0][foodName] || 0) + count;
            }
        }

        dailyTotals.forEach(dayTotal => totalPenalty += this._calculateDayPenalty(dayTotal));

        dailyFoodCounts.forEach(dayCounts => {
            for (const [foodName, count] of Object.entries(dayCounts)) {
                const foodUnitExample = state.foodDatabase.find(f => f.name === foodName);
                if (foodUnitExample && foodUnitExample.maxPerDay && count > foodUnitExample.maxPerDay) {
                    totalPenalty += (count - foodUnitExample.maxPerDay) * LIMIT_VIOLATION_PENALTY;
                }
            }
        });
        
        for (const [name, info] of this.foodDbInfo.entries()) {
            const consumed = onHandConsumption[name] || 0;
            const unscheduled = info.onHand - consumed;
            if (unscheduled <= 0) continue; 
            if (info.daysUntilExpiry < this.totalDays) {
                totalPenalty += unscheduled * WASTE_PENALTY;
            } else if (info.daysUntilExpiry !== Infinity) {
                const consumptionRate = consumed / this.totalDays;
                const daysToEatRemainder = consumptionRate > 0 ? (unscheduled / consumptionRate) : Infinity;
                if (this.totalDays + daysToEatRemainder > info.daysUntilExpiry) {
                    totalPenalty += unscheduled * (WASTE_PENALTY / 4); // At-risk penalty
                }
            }
        }
        return totalPenalty;
    }

    _initializePopulation() {
        this.population = [];
        for (let i = 0; i < this.params.populationSize; i++) {
            // Create a "sparse" individual where almost all items are unassigned (-1).
            // This provides an "empty start" so the GA's primary task is to add
            // items to the schedule. A small amount of initial assignment provides
            // diversity for the algorithm to work with.
            let individual = this.units.map((unit, unitIdx) => {
                 // Give each item a very small chance to be assigned on initialization
                 const assignmentProbability = 0.02; // 2% chance
                 const range = this.unitExpiryInfo[unitIdx].validDayRange;
                 if (range.max >= 0 && Math.random() < assignmentProbability) {
                     return Math.floor(Math.random() * (range.max + 1));
                 }
                 return -1; // Default to unassigned
            });
            this.population.push({ individual, fitness: this.calculateFitness(individual) });
        }
    }
    
    _selection() {
        const tournamentSize = 3;
        let best = null;
        for (let i = 0; i < tournamentSize; i++) {
            const randomIndividual = this.population[Math.floor(Math.random() * this.population.length)];
            if (best === null || randomIndividual.fitness < best.fitness) best = randomIndividual;
        }
        return best.individual;
    }

    _crossover(parent1, parent2) {
        const point = Math.floor(Math.random() * this.numUnits);
        const child1 = parent1.slice(0, point).concat(parent2.slice(point));
        const child2 = parent2.slice(0, point).concat(parent1.slice(point));
        return [this._repair(child1), this._repair(child2)];
    }

    _mutate(individual, currentGeneration) {
        const mutStart = this.params.mutationStart / 100;
        const mutEnd = this.params.mutationEnd / 100;
        const progress = currentGeneration / this.params.generations;
        const mutationRate = mutStart - (mutStart - mutEnd) * progress;
        for (let i = 0; i < this.numUnits; i++) {
            if (Math.random() < mutationRate) {
                const range = this.unitExpiryInfo[i].validDayRange;
                if (range.max >= 0) {
                    individual[i] = Math.floor(Math.random() * (range.max + 2)) - 1; 
                }
            }
        }
        return this._repair(individual);
    }

    _repair(individual) { 
        return individual.map((day, unitIdx) => {
            const maxDay = this.unitExpiryInfo[unitIdx].validDayRange.max;
            return day > maxDay ? maxDay : day;
        });
    }

    async run(onProgress) {
        this._initializePopulation();
        for (let gen = 0; gen < this.params.generations; gen++) {
            this.population.sort((a, b) => a.fitness - b.fitness);
            if (gen % 10 === 0 || gen === this.params.generations - 1) { 
                await onProgress(gen, this.population[0].fitness);
            }
            const newPopulation = [this.population[0]]; // Elitism
            while (newPopulation.length < this.params.populationSize) {
                const parent1 = this._selection();
                const parent2 = this._selection();
                let [child1, child2] = this._crossover(parent1, parent2);
                child1 = this._mutate(child1, gen);
                child2 = this._mutate(child2, gen);
                newPopulation.push({ individual: child1, fitness: this.calculateFitness(child1) });
                if (newPopulation.length < this.params.populationSize) {
                     newPopulation.push({ individual: child2, fitness: this.calculateFitness(child2) });
                }
            }
            this.population = newPopulation;
        }
        this.population.sort((a, b) => a.fitness - b.fitness);
        return this.population[0].individual;
    }
}