/**
 * IoT Dashboard Controller
 */

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

        this.ws = null;
        this.reconnectTimer = null;
    }

    init() {
        this.initCharts();
        this.setupControls();
        this.connectWebSocket();
    }

    connectWebSocket() {
        if (this.ws) {
            this.ws.close();
        }

        const currentPort = window.location.port; // Determine logical port if needed, but we hardcoded 8765
        this.ws = new WebSocket('ws://localhost:8765');

        this.ws.onopen = () => {
            console.log('WS Connected');
            this.handleWsStatus(true);
            this.loadHistory(this.currentRange);
        };

        this.ws.onclose = () => {
            console.log('WS Disconnected');
            this.handleWsStatus(false);
            // Retry
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 5000);
        };

        this.ws.onerror = (err) => {
            console.error('WS Error', err);
            this.handleWsStatus(false);
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this.handleMessage(msg);
            } catch (e) {
                console.error("Parse Error", e);
            }
        };
    }

    handleMessage(msg) {
        if (msg.type === 'live') {
            const transformed = this.transformLiveData(msg);
            this.handleData(transformed);
        } else if (msg.type === 'historical') {
            this.handleHistoricalData(msg.raw);
        } else if (msg.type === 'smart_node_status') {
            this.updateNodeStatus(msg.status === 'Online');
        }
    }

    transformLiveData(msg) {
        // Server: { raw: [ts, aqi, temp, hum, prs], prediction: { aqi: {1m, 5m, 15m}, ... } }
        // Client: { timestamp, sensors: {aqi, temp, hum, prs}, predictions: {p1, p5, p15}, nodeStatus: true }

        const [ts, aqi, temp, hum, prs] = msg.raw;

        // Transform Predictions
        // Server: { aqi: {1m: val, ...}, ... }
        // We need: { p1: {aqi, temp, hum}, ... }

        const preds = { p1: {}, p5: {}, p15: {} };
        if (msg.prediction) {
            ['aqi', 'temp', 'hum'].forEach(sensor => {
                if (msg.prediction[sensor]) {
                    preds.p1[sensor] = msg.prediction[sensor]['1m']?.toFixed(1) || '--';
                    preds.p5[sensor] = msg.prediction[sensor]['5m']?.toFixed(1) || '--';
                    preds.p15[sensor] = msg.prediction[sensor]['15m']?.toFixed(1) || '--';
                }
            });
        }

        return {
            timestamp: ts,
            sensors: {
                aqi: Math.round(aqi),
                temp: parseFloat(temp).toFixed(1),
                hum: Math.round(hum),
                prs: prs
            },
            predictions: preds,
            nodeStatus: true // Assumed alive if we get live data
        };
    }

    handleHistoricalData(data) {
        // data is unique array of dicts from server
        // [{timestamp, aqi, temp, hum, presence}, ...]

        const labels = [];
        const aqi = [];
        const temp = [];
        const hum = [];
        const prs = [];

        data.forEach(row => {
            const time = new Date(row.timestamp).toLocaleTimeString();
            labels.push(time);
            aqi.push(row.aqi);
            temp.push(row.temp);
            hum.push(row.hum);
            prs.push(row.presence);
        });

        this.updateChartData(this.charts.aqi, labels, aqi);
        this.updateChartData(this.charts.temp, labels, temp);
        this.updateChartData(this.charts.hum, labels, hum);
        this.updateChartData(this.charts.prs, labels, prs);
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

        // Presence: Stepped Line with Dash points (No Vertical Lines)
        this.charts.prs = new Chart(document.getElementById('chart-prs'), {
            type: 'line',
            options: {
                ...commonConfig.options,
                scales: {
                    x: { display: false },
                    y: {
                        display: true,
                        min: -0.2,
                        max: 1.2,
                        ticks: {
                            stepSize: 1,
                            callback: (val) => val === 1 ? 'DETECTED' : (val === 0 ? 'CLEAR' : ''),
                            color: '#94a3b8',
                            font: { size: 10 }
                        },
                        grid: {
                            color: (ctx) => [0, 1].includes(ctx.tick.value) ? 'rgba(255, 255, 255, 0.05)' : 'transparent'
                        }
                    }
                },
                elements: {
                    line: {
                        tension: 0,
                        borderWidth: 3, // Thicker dash
                        stepped: true
                    },
                    point: {
                        pointStyle: 'rect',
                        radius: 0, // Hide points, rely on the line segments for the "dash" look
                        hoverRadius: 4,
                        backgroundColor: (ctx) => ctx.raw === 1 ? '#10b981' : 'rgba(148, 163, 184, 0.5)'
                    }
                }
            },
            data: {
                datasets: [{
                    label: 'Presence',
                    data: [],
                    // Segment styling: 
                    // - Green if High->High
                    // - Gray if Low->Low
                    // - Transparent if Changed (Removes vertical line)
                    segment: {
                        borderColor: ctx => {
                            if (ctx.p0.parsed.y !== ctx.p1.parsed.y) return 'transparent';
                            return ctx.p0.parsed.y === 1 ? '#10b981' : 'rgba(148, 163, 184, 0.2)';
                        }
                    }
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
        // Keep only last ~130 points (approx 10 mins?) or 720 for 1h
        // Let's rely on server history load for full context, this is just for appending
        if (chart.data.labels.length > 720) {
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
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        if (preds.p1) { set('p1-aqi', preds.p1.aqi); set('p1-temp', preds.p1.temp); set('p1-hum', preds.p1.hum); }
        if (preds.p5) { set('p5-aqi', preds.p5.aqi); set('p5-temp', preds.p5.temp); set('p5-hum', preds.p5.hum); }
        if (preds.p15) { set('p15-aqi', preds.p15.aqi); set('p15-temp', preds.p15.temp); set('p15-hum', preds.p15.hum); }
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

    loadHistory(range) {
        console.log("Loading history for:", range);

        // Calculate Time Range
        const end = new Date();
        const start = new Date(); // copy

        if (range === '1h') start.setHours(end.getHours() - 1);
        else if (range === '1d') start.setDate(end.getDate() - 1);
        else if (range === '1w') start.setDate(end.getDate() - 7);
        else if (range === '1m') start.setMonth(end.getMonth() - 1);

        // Send WS Request
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'get_historical_time_interval',
                start: start.toISOString().replace('T', ' ').split('.')[0], // Format matching 'YYYY-MM-DD HH:MM:SS' roughly or what server expects
                end: end.toISOString().replace('T', ' ').split('.')[0]
            }));
        }
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
