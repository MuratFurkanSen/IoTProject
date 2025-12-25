/**
 * Mock Backend Service
 * Simulates a server returning sensor data and predictions.
 * This is the SINGLE SOURCE OF TRUTH for data fetching.
 */
class BackendService {
    constructor() {
        // Initial dummy state to simulate continuity
        this.baseState = {
            airQuality: 75, // AQI
            temp: 24,       // Celsius
            humidity: 45,   // Percent
            presence: false
        };

        // Track last request time to simulate presence changes over time
        this.lastPresenceUpdate = Date.now();
    }

    /**
     * Public API: Fetches data "from the server".
     * Returns a Promise.
     */
    async fetchSensorData() {
        return new Promise((resolve) => {
            // Simulate network latency (300ms)
            setTimeout(() => {
                const data = this._generateRandomData();
                resolve(data);
            }, 300);
        });
    }

    /**
     * Generate historical data for the charts
     * @param {string} range '1d', '1w', '1m', '1y'
     */
    async getHistory(range) {
        return new Promise(resolve => {
            const history = { air: [], temp: [], hum: [], labels: [] };
            let points = 50; // Number of points to generate
            let interval = 0; // minutes

            // Configure generation based on range
            switch (range) {
                case '1d': interval = 30; points = 24 * 2; break; // Every 30 mins
                case '1w': interval = 60 * 4; points = 7 * 6; break; // Every 4 hours
                case '1m': interval = 60 * 24; points = 30; break; // Daily
                case '1y': interval = 60 * 24 * 30; points = 12; break; // Monthly
            }

            let time = Date.now() - (points * interval * 60 * 1000);
            let state = { ...this.baseState };

            for (let i = 0; i < points; i++) {
                // Evolve state
                state.airQuality += (Math.random() - 0.5) * 10;
                state.temp += (Math.random() - 0.5) * 2;
                state.humidity += (Math.random() - 0.5) * 5;

                // Clamp
                state.airQuality = Math.max(20, Math.min(200, state.airQuality));
                state.temp = Math.max(0, Math.min(40, state.temp));
                state.humidity = Math.max(30, Math.min(90, state.humidity));

                history.labels.push(new Date(time).toLocaleDateString(undefined, {
                    month: 'short', day: 'numeric', hour: range === '1d' ? '2-digit' : undefined
                }));
                history.air.push(Math.round(state.airQuality));
                history.temp.push(parseFloat(state.temp.toFixed(1)));
                history.hum.push(Math.round(state.humidity));

                time += interval * 60 * 1000;
            }

            resolve(history);
        });
    }

    /**
     * Private helper to generate realistic random data
     */
    _generateRandomData() {
        // Random Walk for sensor values to prevent jittery/unrealistic jumps
        this.baseState.airQuality += (Math.random() - 0.5) * 5;
        this.baseState.temp += (Math.random() - 0.5) * 0.5;
        this.baseState.humidity += (Math.random() - 0.5) * 2;

        // Clamp values to realistic ranges
        this.baseState.airQuality = Math.max(0, Math.min(500, this.baseState.airQuality));
        this.baseState.temp = Math.max(-10, Math.min(50, this.baseState.temp));
        this.baseState.humidity = Math.max(0, Math.min(100, this.baseState.humidity));

        // Presence Logic: Toggle occasionally
        if (Math.random() > 0.95) {
            this.baseState.presence = !this.baseState.presence;
            this.lastPresenceUpdate = Date.now();
        }

        const current = { ...this.baseState };

        // Generate Predictions (Simple linear internal model + noise)
        // 1m, 5m, 15m
        const predictions = {
            m1: this._predict(current, 1, 0.98),
            m5: this._predict(current, 5, 0.85),
            m15: this._predict(current, 15, 0.72)
        };

        return {
            timestamp: Date.now(),
            sensors: {
                airQuality: Math.round(current.airQuality),
                temp: parseFloat(current.temp.toFixed(1)),
                humidity: Math.round(current.humidity),
                presence: current.presence,
                lastSeen: this.lastPresenceUpdate
            },
            predictions
        };
    }

    _predict(current, minutesAhead, baseConfidence) {
        // Simple prediction algorithm: assume slight trend persistence + random noise
        // Noise increases with time
        const noiseFactor = minutesAhead * 1.5;

        return {
            airQuality: Math.round(current.airQuality + (Math.random() - 0.5) * noiseFactor),
            temp: parseFloat((current.temp + (Math.random() - 0.5) * (noiseFactor * 0.1)).toFixed(1)),
            humidity: Math.round(current.humidity + (Math.random() - 0.5) * noiseFactor),
            confidence: baseConfidence // Static for now, could be dynamic
        };
    }
}

/**
 * Dashboard Controller
 * Manages the UI, Charts, and State
 */
class DashboardController {
    constructor() {
        this.backend = new BackendService();
        this.charts = {};
        this.history = {
            air: [],
            temp: [],
            hum: []
        };
        this.maxHistoryPoints = 50; // Keep chart clean
        this.isLive = true; // Flag to track if we are in live mode
    }

    async init() {
        this._initCharts();
        this._setupEventListeners();

        // Initial Load
        await this.update();

        // Polling Loop (Every 3 seconds)
        setInterval(() => this.update(), 3000);
    }

    _initCharts() {
        const commonOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    display: false,
                    grid: { display: false }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: 'rgba(255, 255, 255, 0.5)' }
                }
            },
            elements: {
                point: { radius: 0 },
                line: { tension: 0.4 } // Smooth curves
            }
        };

        this.charts.air = new Chart(document.getElementById('chart-air-canvas'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'AQI',
                    data: [],
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6, 182, 212, 0.1)',
                    fill: true,
                    borderWidth: 2
                }]
            },
            options: commonOptions
        });

        this.charts.temp = new Chart(document.getElementById('chart-temp-canvas'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Temp (°C)',
                    data: [],
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    fill: true,
                    borderWidth: 2
                }]
            },
            options: commonOptions
        });

        this.charts.hum = new Chart(document.getElementById('chart-hum-canvas'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Humidity (%)',
                    data: [],
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    fill: true,
                    borderWidth: 2
                }]
            },
            options: commonOptions
        });
    }

    async update() {
        const data = await this.backend.fetchSensorData();
        this._updateUI(data);

        // Only update charts if we are in live mode
        if (this.isLive) {
            this._updateCharts(data);
        }
    }

    async loadHistory(range) {
        this.isLive = false; // Stop live chart updates
        const history = await this.backend.getHistory(range);

        // Helper to reset a chart
        const resetChart = (chart, labels, data) => {
            chart.data.labels = labels;
            chart.data.datasets[0].data = data;
            chart.update();
        };

        resetChart(this.charts.air, history.labels, history.air);
        resetChart(this.charts.temp, history.labels, history.temp);
        resetChart(this.charts.hum, history.labels, history.hum);
    }

    _updateUI(data) {
        // Update Sensor Cards
        document.getElementById('val-air').textContent = data.sensors.airQuality;
        document.getElementById('val-temp').textContent = data.sensors.temp;
        document.getElementById('val-hum').textContent = data.sensors.humidity;

        // Presence
        const presenceEl = document.getElementById('val-presence');
        const cardPresence = document.getElementById('card-presence');
        const lastSeenEl = document.getElementById('last-seen-time');

        if (data.sensors.presence) {
            presenceEl.textContent = "Detected";
            presenceEl.style.color = "var(--accent-prs)";
            cardPresence.style.borderColor = "var(--accent-prs)";
        } else {
            presenceEl.textContent = "Nobody";
            presenceEl.style.color = "var(--text-secondary)";
            cardPresence.style.borderColor = "var(--glass-border)";
        }

        // Format Last Seen (Relative time)
        const secondsAgo = Math.floor((Date.now() - data.sensors.lastSeen) / 1000);
        lastSeenEl.textContent = secondsAgo < 60 ? 'Just now' : `${Math.floor(secondsAgo / 60)}m ago`;

        // Update Predictions
        this._updatePredictionCard('1m', data.predictions.m1);
        this._updatePredictionCard('5m', data.predictions.m5);
        this._updatePredictionCard('15m', data.predictions.m15);
    }

    _updatePredictionCard(timeKey, predData) {
        document.getElementById(`pred-${timeKey}-air`).textContent = predData.airQuality;
        document.getElementById(`pred-${timeKey}-temp`).textContent = predData.temp;
        document.getElementById(`pred-${timeKey}-hum`).textContent = predData.humidity;
    }

    _updateCharts(data) {
        const timeLabel = new Date(data.timestamp).toLocaleTimeString();

        // Push new data
        this._pushChartData(this.charts.air, timeLabel, data.sensors.airQuality);
        this._pushChartData(this.charts.temp, timeLabel, data.sensors.temp);
        this._pushChartData(this.charts.hum, timeLabel, data.sensors.humidity);
    }

    _pushChartData(chart, label, value) {
        if (chart.data.labels.length > this.maxHistoryPoints) {
            chart.data.labels.shift();
            chart.data.datasets[0].data.shift();
        }
        chart.data.labels.push(label);
        chart.data.datasets[0].data.push(value);
        chart.update();
    }

    _setupEventListeners() {
        const buttons = document.querySelectorAll('.time-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                buttons.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                const range = e.target.dataset.range;
                console.log(`Loading history for: ${range}`);
                this.loadHistory(range);
            });
        });
    }
}

// Start the App
document.addEventListener('DOMContentLoaded', () => {
    const app = new DashboardController();
    app.init();
});
