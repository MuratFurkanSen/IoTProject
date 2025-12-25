/**
 * IoT Dashboard Controller
 * Handles Mock Data, Charts, and UI Updates
 */

class MockWebSocket {
    constructor(onMessage, onStatusChange) {
        this.onMessage = onMessage;
        this.onStatusChange = onStatusChange;
        this.isConnected = false;
        this.intervalId = null;

        // Base state for random walk
        this.state = {
            aqi: 80,
            temp: 24,
            hum: 45,
            prs: 0
        };
    }

    connect() {
        console.log("WebSocket: Connecting...");
        setTimeout(() => {
            this.isConnected = true;
            this.onStatusChange(true);
            this._startEmitting();
        }, 1000);
    }

    _startEmitting() {
        // Emit data every 5 seconds
        this.intervalId = setInterval(() => {
            if (!this.isConnected) return;

            // Random Walk
            this.state.aqi += (Math.random() - 0.5) * 5;
            this.state.temp += (Math.random() - 0.5) * 0.5;
            this.state.hum += (Math.random() - 0.5) * 2;

            // Clamp
            this.state.aqi = Math.max(10, Math.min(300, this.state.aqi));
            this.state.temp = Math.max(-10, Math.min(50, this.state.temp));
            this.state.hum = Math.max(0, Math.min(100, this.state.hum));

            // Presence change probability (low)
            if (Math.random() > 0.9) {
                this.state.prs = this.state.prs === 1 ? 0 : 1;
            }

            // Simulate Smart Node Heartbeat (95% chance active)
            const nodeStatus = Math.random() > 0.05;

            const packet = {
                timestamp: Date.now(),
                nodeStatus: nodeStatus,
                sensors: {
                    aqi: Math.round(this.state.aqi),
                    temp: parseFloat(this.state.temp.toFixed(1)),
                    hum: Math.round(this.state.hum),
                    prs: this.state.prs
                },
                predictions: this._generatePredictions()
            };

            this.onMessage(packet);

            // Simulate occasional disconnect (1% chance)
            if (Math.random() > 0.99) {
                console.warn("WebSocket: Connection lost (simulated)");
                this.disconnect();
                // Auto reconnect after 3s
                setTimeout(() => this.connect(), 3000);
            }

        }, 5000);
    }

    _generatePredictions() {
        const noise = (factor) => (Math.random() - 0.5) * factor;
        return {
            p1: { aqi: Math.round(this.state.aqi + noise(5)), temp: (this.state.temp + noise(1)).toFixed(1), hum: Math.round(this.state.hum + noise(3)) },
            p5: { aqi: Math.round(this.state.aqi + noise(15)), temp: (this.state.temp + noise(2)).toFixed(1), hum: Math.round(this.state.hum + noise(8)) },
            p15: { aqi: Math.round(this.state.aqi + noise(30)), temp: (this.state.temp + noise(4)).toFixed(1), hum: Math.round(this.state.hum + noise(15)) }
        };
    }

    disconnect() {
        this.isConnected = false;
        clearInterval(this.intervalId);
        this.onStatusChange(false);
    }
}

class DashboardManager {
    constructor() {
        this.charts = {};
        this.currentRange = '1h'; // Default

        this.ui = {
            wsStatus: document.getElementById('status-ws'),
            nodeStatus: document.getElementById('status-node'),
            sensors: {
                aqi: document.getElementById('live-aqi'),
                temp: document.getElementById('live-temp'),
                hum: document.getElementById('live-hum'),
                prs: document.getElementById('live-prs')
            },
            preds: {
                // mapped dynamically
            }
        };

        this.mockWs = new MockWebSocket(
            (data) => this.handleData(data),
            (status) => this.handleWsStatus(status)
        );
    }

    init() {
        this.initCharts();
        this.setupControls();
        this.loadHistory('1h'); // Initial Load
        this.mockWs.connect();
    }

    initCharts() {
        const commonConfig = {
            type: 'line',
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false }, // Hide X axis for cleaner look
                    y: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8' }
                    }
                },
                elements: {
                    point: { radius: 0 }, // No dots by default
                    line: { tension: 0.1, borderWidth: 2 }
                }
            }
        };

        // Create 4 charts
        this.charts.aqi = new Chart(document.getElementById('chart-aqi'), {
            ...commonConfig,
            data: { datasets: [{ label: 'AQI', borderColor: '#06b6d4', backgroundColor: 'rgba(6, 182, 212, 0.1)', fill: true, data: [] }] }
        });

        this.charts.temp = new Chart(document.getElementById('chart-temp'), {
            ...commonConfig,
            data: { datasets: [{ label: 'Temp', borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)', fill: true, data: [] }] }
        });

        this.charts.hum = new Chart(document.getElementById('chart-hum'), {
            ...commonConfig,
            data: { datasets: [{ label: 'Humidity', borderColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.1)', fill: true, data: [] }] }
        });

        // Presence: Scatter plot (using line with no connecting lines)
        this.charts.prs = new Chart(document.getElementById('chart-prs'), {
            type: 'line',
            options: {
                ...commonConfig.options,
                showLine: false, // Scatter effect
                scales: {
                    x: { display: false },
                    y: {
                        display: true,
                        min: -0.2, // Padding
                        max: 1.2,
                        ticks: {
                            stepSize: 1,
                            callback: (val) => val === 1 ? 'DETECTED' : (val === 0 ? 'CLEAR' : ''),
                            color: '#94a3b8',
                            font: { size: 10 }
                        },
                        grid: {
                            color: (ctx) => [0, 1].includes(ctx.tick.value) ? 'rgba(255, 255, 255, 0.1)' : 'transparent'
                        }
                    }
                },
                elements: {
                    point: {
                        radius: 4,
                        hoverRadius: 6,
                        backgroundColor: (ctx) => ctx.raw === 1 ? '#10b981' : 'rgba(148, 163, 184, 0.5)'
                    }
                }
            },
            data: {
                datasets: [{
                    label: 'Presence',
                    data: [],
                    borderColor: 'transparent', // No line
                    pointBackgroundColor: '#10b981'
                }]
            }
        });
    }

    handleData(data) {
        this.updateSensorCards(data.sensors);
        this.updatePredictions(data.predictions);
        this.updateNodeStatus(data.nodeStatus);

        // Update charts live if in "1h" (Live) mode
        if (this.currentRange === '1h') {
            const time = new Date(data.timestamp).toLocaleTimeString();
            this.pushToChart(this.charts.aqi, time, data.sensors.aqi);
            this.pushToChart(this.charts.temp, time, data.sensors.temp);
            this.pushToChart(this.charts.hum, time, data.sensors.hum);
            this.pushToChart(this.charts.prs, time, data.sensors.prs);
        }
    }

    pushToChart(chart, label, value) {
        // Keep only last ~100 points for live view
        if (chart.data.labels.length > 720) { // 1h of 5s data
            chart.data.labels.shift();
            chart.data.datasets[0].data.shift();
        }
        chart.data.labels.push(label);
        chart.data.datasets[0].data.push(value);
        chart.update('none'); // Efficient update
    }

    updateSensorCards(sensors) {
        this.ui.sensors.aqi.textContent = sensors.aqi;
        this.ui.sensors.temp.textContent = sensors.temp;
        this.ui.sensors.hum.textContent = sensors.hum;

        const prsText = sensors.prs === 1 ? "DETECTED" : "CLEAR";
        this.ui.sensors.prs.textContent = prsText;
        this.ui.sensors.prs.style.color = sensors.prs === 1 ? 'var(--accent-prs)' : 'var(--text-secondary)';
    }

    updatePredictions(preds) {
        // Helper to update ID
        const set = (id, val) => document.getElementById(id).textContent = val;

        set('p1-aqi', preds.p1.aqi); set('p1-temp', preds.p1.temp); set('p1-hum', preds.p1.hum);
        set('p5-aqi', preds.p5.aqi); set('p5-temp', preds.p5.temp); set('p5-hum', preds.p5.hum);
        set('p15-aqi', preds.p15.aqi); set('p15-temp', preds.p15.temp); set('p15-hum', preds.p15.hum);
    }

    handleWsStatus(connected) {
        if (connected) {
            this.ui.wsStatus.classList.remove('status-disconnected');
            this.ui.wsStatus.classList.add('status-connected');
        } else {
            this.ui.wsStatus.classList.remove('status-connected');
            this.ui.wsStatus.classList.add('status-disconnected');
        }
    }

    updateNodeStatus(active) {
        if (active) {
            this.ui.nodeStatus.classList.remove('status-disconnected');
            this.ui.nodeStatus.classList.add('status-connected');
        } else {
            this.ui.nodeStatus.classList.remove('status-connected');
            this.ui.nodeStatus.classList.add('status-disconnected');
        }
    }

    setupControls() {
        const buttons = document.querySelectorAll('.filter-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                // UI Toggle
                buttons.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');

                // Logic
                this.currentRange = e.target.dataset.range;
                this.loadHistory(this.currentRange);
            });
        });
    }

    /**
     * Generates history with intended GAPS (missing data)
     */
    async loadHistory(range) {
        console.log("Loading history for:", range);

        // Configuration
        let points, intervalSeconds;
        // 5s resolution requested. 
        // 1h = 720 points (5s)
        // 1d = 17280 points (5s) -> Too heavy for Chart.js usually, but requested.
        // We will cap points for performance in this mock, but keep "feel" high res.

        if (range === '1h') { points = 720; intervalSeconds = 5; }
        else if (range === '1d') { points = 1000; intervalSeconds = 60 * 60 * 24 / 1000; } // Downsampled slightly for browser safety
        else if (range === '1w') { points = 1000; intervalSeconds = 60 * 60 * 24 * 7 / 1000; }
        else { points = 1000; intervalSeconds = 60 * 60 * 24 * 30 / 1000; }

        const history = {
            labels: [],
            aqi: [], temp: [], hum: [], prs: []
        };

        const now = Date.now();
        let state = { aqi: 60, temp: 22, hum: 50, prs: 0 };

        for (let i = points; i >= 0; i--) {
            const time = now - (i * intervalSeconds * 1000);

            // GAP LOGIC: 5% chance of a "gap" (missing data)
            // But usually gaps are chunks. Let's make a gap occur every ~100 points
            if (i > 50 && i < 60) {
                // Create a gap
                history.labels.push(new Date(time).toLocaleTimeString());
                history.aqi.push(null);
                history.temp.push(null);
                history.hum.push(null);
                history.prs.push(null);
                continue;
            }

            // Evolve State
            state.aqi += (Math.random() - 0.5) * 10;
            state.temp += (Math.random() - 0.5) * 2;
            state.hum += (Math.random() - 0.5) * 5;
            state.prs = Math.random() > 0.8 ? (state.prs ? 0 : 1) : state.prs;

            // Clamp
            state.aqi = Math.max(10, state.aqi);

            history.labels.push(new Date(time).toLocaleTimeString());
            history.aqi.push(Math.round(state.aqi));
            history.temp.push(parseFloat(state.temp.toFixed(1)));
            history.hum.push(Math.round(state.hum));
            history.prs.push(state.prs);
        }

        // Mass Update Charts
        this.updateChartData(this.charts.aqi, history.labels, history.aqi);
        this.updateChartData(this.charts.temp, history.labels, history.temp);
        this.updateChartData(this.charts.hum, history.labels, history.hum);
        this.updateChartData(this.charts.prs, history.labels, history.prs);
    }

    updateChartData(chart, labels, data) {
        chart.data.labels = labels;
        chart.data.datasets[0].data = data;
        chart.update();
    }
}

// Start
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new DashboardManager();
    window.dashboard.init();
});
