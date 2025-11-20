// ============================================================================== //
// GENETIC OPTIMIZER.JS - WEB WORKER WITH LOCKING LOGIC
// ============================================================================== //

export function runOptimizerInWorker(params, onProgress) {
    return new Promise((resolve, reject) => {
        const workerCode = `
            const MACROS = ${JSON.stringify(params.constants.MACROS)};
            const MACRO_WEIGHTS = ${JSON.stringify(params.constants.MACRO_WEIGHTS)};
            const PENALTY_SCALE_FACTOR = ${params.constants.PENALTY_SCALE_FACTOR};
            const WASTE_PENALTY = ${params.constants.WASTE_PENALTY};
            const LIMIT_VIOLATION_PENALTY = ${params.constants.LIMIT_VIOLATION_PENALTY};
            const MS_DAY = 86400000;

            function parseDateString(s) {
                if (!s) return null;
                const parts = s.split('-').map(Number);
                if (parts.length === 3) return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
                const d = new Date(s);
                return isNaN(d) ? null : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            }

            class GeneticAlgorithmPlanner {
                constructor(units, macroGoals, startDate, totalDays, gaParams, foodDataMap, lockedUnits, customDayMacros) {
                    this.units = units;
                    this.macroGoals = macroGoals;
                    this.startDate = startDate;
                    this.totalDays = totalDays;
                    this.numUnits = units.length;
                    this.params = gaParams;
                    this.foodDataMap = foodDataMap;
                    
                    // lockedUnits: Map or Object { unitIndex: dayIndex }
                    this.lockedUnits = lockedUnits || {}; 
                    
                    // customDayMacros: Array [ {calories: 500, ...}, {calories: 0, ...} ]
                    this.customDayMacros = customDayMacros || [];

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

                _calculateDayPenalty(dayTotal, dayIndex) {
                    let penalty = 0;
                    const goals = this.macroGoals;

                    // Add custom meal macros (if any) to the calculated total from the algorithm
                    const custom = this.customDayMacros[dayIndex] || {};

                    MACROS.forEach(macro => {
                        const { min, max } = goals[macro];
                        
                        // Total = Algo Generated + Locked + Custom (Custom is passed in separately, Locked is inside dayTotal)
                        let value = (dayTotal[macro] || 0) + (custom[macro] || 0);
                        
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
                    const virtualConsumption = {};
                    
                    individual.forEach((day, unitIdx) => {
                        if (day >= 0 && day < this.totalDays) {
                            const unit = this.units[unitIdx];
                            MACROS.forEach(macro => { dailyTotals[day][macro] += unit.nutrients[macro] || 0; });
                            dailyFoodCounts[day][unit.name] = (dailyFoodCounts[day][unit.name] || 0) + 1;
                            
                            if (!unit.isVirtual) {
                                onHandConsumption[unit.name] = (onHandConsumption[unit.name] || 0) + 1;
                            } else {
                                virtualConsumption[unit.name] = (virtualConsumption[unit.name] || 0) + 1;
                            }
                        }
                    });

                    // Calculate Macro Penalties
                    dailyTotals.forEach((dayTotal, dayIndex) => {
                        totalPenalty += this._calculateDayPenalty(dayTotal, dayIndex);
                    });

                    // Calculate Max Per Day Violations
                    dailyFoodCounts.forEach((dayCounts, dayIndex) => {
                        for (const [foodName, count] of Object.entries(dayCounts)) {
                            const foodUnitExample = this.foodDataMap.get(foodName);
                            if (foodUnitExample && foodUnitExample.maxPerDay && count > foodUnitExample.maxPerDay) {
                                totalPenalty += (count - foodUnitExample.maxPerDay) * LIMIT_VIOLATION_PENALTY;
                            }
                        }
                    });
                    
                    // Calculate Waste Penalty (On Hand)
                    for (const [name, info] of this.foodDbInfo.entries()) {
                        const consumed = onHandConsumption[name] || 0;
                        const onHand = info.onHand;
                        
                        if (onHand <= consumed) continue;

                        if (info.daysUntilExpiry < this.totalDays) {
                            const unscheduled = onHand - consumed;
                            totalPenalty += unscheduled * WASTE_PENALTY;
                        } 
                        else if (info.daysUntilExpiry !== Infinity) {
                            const dailyRate = consumed / this.totalDays;
                            const projectedTotalConsumption = dailyRate * info.daysUntilExpiry;
                            
                            if (onHand > projectedTotalConsumption) {
                                const amountAtRisk = onHand - projectedTotalConsumption;
                                totalPenalty += amountAtRisk * (WASTE_PENALTY * 0.5); 
                            }
                        }
                    }
                    
                    // Calculate Waste Penalty (Virtual/Packages)
                    for (const [foodName, virtualServingsUsed] of Object.entries(virtualConsumption)) {
                        const foodData = this.foodDataMap.get(foodName);
                        if (foodData && foodData.servingsPerPackage > 1) {
                            const packagesNeeded = Math.ceil(virtualServingsUsed / foodData.servingsPerPackage);
                            const totalServingsPurchased = packagesNeeded * foodData.servingsPerPackage;
                            const unusedServings = totalServingsPurchased - virtualServingsUsed;
                            
                            if (unusedServings > 0) {
                                // Simplified risk for virtual: if we buy a pack and don't eat it all
                                totalPenalty += unusedServings * (WASTE_PENALTY * 0.1); 
                            }
                        }
                    }
                    
                    return totalPenalty;
                }

                _initializePopulation() {
                    this.population = [];
                    for (let i = 0; i < this.params.populationSize; i++) {
                        let individual = this.units.map((unit, unitIdx) => {
                             // 1. CHECK LOCK
                             if (this.lockedUnits.hasOwnProperty(unitIdx)) {
                                 return this.lockedUnits[unitIdx];
                             }

                             // 2. Standard Random Assignment
                             const assignmentProbability = 0.02;
                             const range = this.unitExpiryInfo[unitIdx].validDayRange;
                             if (range.max >= 0 && Math.random() < assignmentProbability) {
                                 return Math.floor(Math.random() * (range.max + 1));
                             }
                             return -1;
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
                    // Locked genes are naturally preserved if both parents have them (which they must)
                    const child1 = parent1.slice(0, point).concat(parent2.slice(point));
                    const child2 = parent2.slice(0, point).concat(parent1.slice(point));
                    return [this._repair(child1), this._repair(child2)];
                }

                _mutate(individual, progress) {
                    const mutStart = this.params.mutationStart / 100;
                    const mutEnd = this.params.mutationEnd / 100;
                    const mutationRate = mutStart - (mutStart - mutEnd) * progress;
                    
                    for (let i = 0; i < this.numUnits; i++) {
                        // 1. CHECK LOCK - Do not mutate locked items
                        if (this.lockedUnits.hasOwnProperty(i)) continue;

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
                        // 1. Ensure locked items stay locked
                        if (this.lockedUnits.hasOwnProperty(unitIdx)) {
                            return this.lockedUnits[unitIdx];
                        }
                        
                        // 2. Standard repair
                        const maxDay = this.unitExpiryInfo[unitIdx].validDayRange.max;
                        return day > maxDay ? maxDay : day;
                    });
                }

                run(onProgress, durationSeconds) {
                    this._initializePopulation();

                    const startTime = Date.now();
                    const durationMs = durationSeconds * 1000;
                    let gen = 0;

                    while (true) {
                        const elapsedMs = Date.now() - startTime;
                        if (elapsedMs >= durationMs) break;

                        const progress = Math.min(1.0, elapsedMs / durationMs);
                        this.population.sort((a, b) => a.fitness - b.fitness);
                        
                        if (gen % 10 === 0) { 
                            onProgress(gen, this.population[0].fitness, elapsedMs, durationMs);
                        }

                        const newPopulation = [this.population[0]]; // Elitism
                        while (newPopulation.length < this.params.populationSize) {
                            const parent1 = this._selection();
                            const parent2 = this._selection();
                            let [child1, child2] = this._crossover(parent1, parent2);
                            child1 = this._mutate(child1, progress);
                            child2 = this._mutate(child2, progress);
                            newPopulation.push({ individual: child1, fitness: this.calculateFitness(child1) });
                            if (newPopulation.length < this.params.populationSize) {
                                 newPopulation.push({ individual: child2, fitness: this.calculateFitness(child2) });
                            }
                        }
                        this.population = newPopulation;
                        gen++;
                    }
                    onProgress(gen, this.population[0].fitness, durationMs, durationMs);
                    this.population.sort((a, b) => a.fitness - b.fitness);
                    return this.population[0].individual;
                }
            }

            self.onmessage = (e) => {
                const { units, macroGoals, startDate, totalDays, gaParams, optDurationSeconds, foodDataMap, lockedUnits, customDayMacros } = e.data;
                const startDateObj = parseDateString(startDate);
                const planner = new GeneticAlgorithmPlanner(units, macroGoals, startDateObj, totalDays, gaParams, new Map(foodDataMap), lockedUnits, customDayMacros);
                
                const onWorkerProgress = (generation, fitness, elapsedMs, durationMs) => {
                    self.postMessage({ type: 'progress', generation, fitness, elapsedMs, durationMs });
                };
                
                const result = planner.run(onWorkerProgress, optDurationSeconds);
                self.postMessage({ type: 'result', result });
            };
        `;

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));

        worker.onmessage = (e) => {
            if (e.data.type === 'progress') {
                onProgress(e.data.generation, e.data.fitness, e.data.elapsedMs, e.data.durationMs);
            } else if (e.data.type === 'result') {
                resolve(e.data.result);
                worker.terminate();
                URL.revokeObjectURL(blob);
            }
        };

        worker.onerror = (e) => {
            console.error('Error in worker:', e);
            reject(new Error(`Worker error: ${e.message}`));
            worker.terminate();
            URL.revokeObjectURL(blob);
        };

        const serializableParams = {
            ...params,
            foodDataMap: Array.from(params.foodDataMap.entries())
        };

        worker.postMessage(serializableParams);
    });
}