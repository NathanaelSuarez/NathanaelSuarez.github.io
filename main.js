class Recommender {
    constructor() {
        this.history = JSON.parse(localStorage.getItem('history')) || [];
        this.model = JSON.parse(localStorage.getItem('model')) || { params: [], data: [] };
        this.embeddings = [];
        this.currentSet = [];
        this.poolSize = 50;
        this.trainingInterval = 5;
        this.loadSettings();
    }

    async init() {
        try {
            await this.loadEmbeddings();
            this.showNextSet();
            this.updateCounter();
        } catch (error) {
            console.error('Initialization error:', error);
        }
    }

    async loadEmbeddings() {
        const response = await fetch('/files/embeddings.json');
        this.embeddings = await response.json();
    }

    loadSettings() {
        this.poolSize = parseInt(localStorage.getItem('poolSize')) || 20;
        this.trainingInterval = parseInt(localStorage.getItem('trainingInterval')) || 5;
        
        document.getElementById('poolSize').value = this.poolSize;
        document.getElementById('poolValue').textContent = this.poolSize;
        document.getElementById('trainingInterval').value = this.trainingInterval;
        document.getElementById('trainingValue').textContent = this.trainingInterval;
    }

    getRandomSubset() {
        return [...this.embeddings]
            .sort(() => Math.random() - 0.5)
            .slice(0, this.poolSize);
    }

    covariance(x, y) {
        const n = x.length;
        const meanX = x.reduce((a, b) => a + b, 0) / n;
        const meanY = y.reduce((a, b) => a + b, 0) / n;
        return x.reduce((sum, xi, i) => sum + (xi - meanX) * (y[i] - meanY), 0) / n;
    }

    getTopFeatures(X, y, numFeatures = 1) {
        const covariances = X[0].map((_, i) => {
            const xCol = X.map(row => row[i]);
            return this.covariance(xCol, y);
        });
        
        return covariances
            .map((cov, i) => ({ index: i, cov: Math.abs(cov) }))
            .sort((a, b) => b.cov - a.cov)
            .slice(0, numFeatures)
            .map(f => f.index);
    }

    trainModel() {
        const X = this.model.data.map(entry => entry.embedding);
        const y = this.model.data.map(entry => entry.selected);
        const numParams = Math.floor(this.history.length / this.trainingInterval);
        const features = this.getTopFeatures(X, y, numParams);
        
        const params = features.map(fi => {
            const xCol = X.map(row => row[fi]);
            return this.covariance(xCol, y) / this.variance(xCol);
        });
        
        this.model.params = params.map((p, i) => ({ coeff: p, feature: features[i] }));
        localStorage.setItem('model', JSON.stringify(this.model));
    }

    variance(arr) {
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        return arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
    }

    scoreImage(embedding) {
        return this.model.params.reduce((sum, param) => 
            sum + param.coeff * embedding[param.feature], 0);
    }

    showNextSet(skip = false) {
        if (!skip) {
            this.updateProgress();
        }

        const container = document.getElementById('imageContainer');
        container.innerHTML = '';
        
        const availableImages = this.getRandomSubset();
        let candidates = [];

        if (!skip && this.history.length >= this.trainingInterval && this.model.params.length > 0) {
            candidates = availableImages
                .map(img => ({ ...img, score: this.scoreImage(img.embedding) }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 4);
        } else {
            candidates = availableImages.sort(() => Math.random() - 0.5).slice(0, 4);
        }

        this.currentSet = candidates;
        candidates.forEach(img => {
            const imgElem = document.createElement('div');
            imgElem.className = 'image-item';
            imgElem.innerHTML = `
                <img src="/${img.path}" 
                     alt="Recommendation" 
                     onerror="this.style.display='none'">
            `;
            imgElem.addEventListener('click', () => this.handleSelection(img));
            container.appendChild(imgElem);
        });
    }

    handleSelection(selectedImg) {
        const timestamp = Date.now();
        this.currentSet.forEach(img => {
            this.model.data.push({
                embedding: img.embedding,
                selected: img.path === selectedImg.path ? 1 : 0,
                timestamp
            });
        });

        this.history.push(selectedImg.path);
        localStorage.setItem('history', JSON.stringify(this.history));
        
        if (this.model.data.length > 200) {
            this.model.data = this.model.data.slice(-200);
        }

        this.updateModelStatus();
        this.updateCounter();

        if (this.history.length % this.trainingInterval === 0) {
            this.trainModel();
        }

        this.showNextSet();
    }

    updateProgress() {
        const progress = (this.history.length % this.trainingInterval) / this.trainingInterval * 100;
        document.getElementById('progressBar').style.width = `${progress}%`;
    }

    updateCounter() {
        const remaining = this.trainingInterval - (this.history.length % this.trainingInterval);
        document.getElementById('counter').textContent = `${remaining}/${this.trainingInterval}`;
    }

    updateModelStatus() {
        document.getElementById('modelStatus').textContent = this.model.params.length > 0 
            ? `Model active (${this.model.params.length} features)` 
            : "Exploring randomly";
    }
}

function clearAll() {
    localStorage.clear();
    location.reload();
}

// Initialize
const recommender = new Recommender();

// Event listeners
document.getElementById('poolSize').addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    document.getElementById('poolValue').textContent = value;
    recommender.poolSize = value;
    localStorage.setItem('poolSize', value.toString());
});

document.getElementById('trainingInterval').addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    document.getElementById('trainingValue').textContent = value;
    recommender.trainingInterval = value;
    localStorage.setItem('trainingInterval', value.toString());
    recommender.updateCounter();
    recommender.updateProgress();
});

document.getElementById('skipBtn').addEventListener('click', () => recommender.showNextSet(true));
document.getElementById('clearBtn').addEventListener('click', clearAll);

window.addEventListener('DOMContentLoaded', () => recommender.init());
