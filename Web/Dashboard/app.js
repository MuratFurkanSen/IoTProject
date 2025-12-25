/**
 * IoT Dashboard Controller
 * * Features:
 * - Fixed Size Buffer: 720 points (1 Hour view @ 5s interval).
 * - Grid Alignment: Rounds requests to nearest 5s to match server data slots.
 * - Gap Filling: Automatically inserts nulls if server data skips a 5s slot.
 * - Performance: Uses simple FIFO queue (shift/push) for live updates.
 */

class TimeSeriesBuffer {
    constructor(capacity = 720, intervalMs = 5000) {
        this.capacity = capacity;
        this.interval = intervalMs;

        // Pre-allocate arrays with nulls
        this.times = new Array(capacity).fill(null);
        this.aqi = new Array(capacity).fill(null);
        this.temp = new Array(capacity).fill(null);
        this.hum = new Array(capacity).fill(null);
        this.prs = new Array(capacity).fill(null);

        // Helper to store raw timestamps for comparison/debugging
        this.raw_times = new Array(capacity).fill(0);
    }

    /**
     * Aligns historical data to a perfect 5s grid.
     * @param {Array} rows - Sorted data from backend
     * @param {Date} alignedEndTime - The anchor time (Current Time rounded to 5s)
     */
    initFromHistory(rows, alignedEndTime) {
        // Calculate the exact start time of the buffer (End - 1h + 5s)
        const endTimeMs = alignedEndTime.getTime();
        const startTimeMs = endTimeMs - (this.capacity * this.interval) + this.interval;

        let dataIndex = 0;

        // Iterate through the 720 expected slots
        for (let i = 0; i < this.capacity; i++) {
            const targetTs = startTimeMs + (i * this.interval);

            // Check if backend data exists for this specific timestamp.
            // We use a small tolerance (1000ms) to catch data that might be slightly off-millisecond.
            let match = null;

            if (dataIndex < rows.length) {
                const rowTs = new Date(rows[dataIndex].timestamp).getTime();

                // If row matches target (within 1s tolerance)
                if (Math.abs(rowTs - targetTs) < 1000) {
                    match = rows[dataIndex];
                    dataIndex++;
                }
                // If row is older than target (duplicate/old data), skip the row and retry slot
                else if (rowTs < targetTs) {
                    dataIndex++;
                    i--;
                    continue;
                }
                // If row is newer than target, it means we have a gap. Match remains null.
            }

            // Fill the slot
            this.raw_times[i] = targetTs;
            // Format: "16:33:10" (Local Time)
            this.times[i] = new Date(targetTs).toLocaleTimeString([], { hour12: false });

            if (match) {
                this.aqi[i] = match.aqi;
                this.temp[i] = match.temp;
                this.hum[i] = match.hum;
                this.prs[i] = match.presence;
            } else {
                // No match = Gap
                this.aqi[i] = null;
                this.temp[i] = null;
                this.hum[i] = null;
                this.prs[i] = null;
            }
        }

        console.log(`[Buffer] Initialized ${this.capacity} slots. Matched ${dataIndex} points from server.`);
    }

    /**
     * Adds a live point via Queue (FIFO).
     * Removes index 0, adds new data to end.
     */
    This logic ensures that if the server sends data 15 seconds after the last point (skipping two 5-second slots), the buffer will correctly shift 3 times: inserting 2 null points for the missing times, and 1 real point for the current data. This keeps the X-axis perfectly aligned to the 5-second grid.

Here is the updated full code.

JavaScript

/**
 * IoT Dashboard Controller
 * * Features:
 * - Fixed Size Buffer: 720 points (1 Hour view @ 5s interval).
 * - Grid Alignment: Rounds requests to nearest 5s.
 * - Auto-Gap Filling: Calculates missing time slots between packets and fills them with nulls.
 */

class TimeSeriesBuffer {
    constructor(capacity = 720, intervalMs = 5000) {
        this.capacity = capacity;
        this.interval = intervalMs;

        // Pre-allocate arrays
        this.times = new Array(capacity).fill(null);
        this.aqi = new Array(capacity).fill(null);
        this.temp = new Array(capacity).fill(null);
        this.hum = new Array(capacity).fill(null);
        this.prs = new Array(capacity).fill(null);

        // Stores raw timestamps (numbers) for calculation
        this.raw_times = new Array(capacity).fill(0);
    }

    /**
     * Aligns historical data to a perfect 5s grid.
     */
    initFromHistory(rows, alignedEndTime) {
        const endTimeMs = alignedEndTime.getTime();
        // Start time = End - (Capacity * Interval) + 1 Interval
        // (This ensures the last slot is exactly endTimeMs)
        const startTimeMs = endTimeMs - (this.capacity * this.interval) + this.interval;

        let dataIndex = 0;

        for (let i = 0; i < this.capacity; i++) {
            const targetTs = startTimeMs + (i * this.interval);
            let match = null;

            if (dataIndex < rows.length) {
                const rowTs = new Date(rows[dataIndex].timestamp).getTime();

                // Tolerance check (+/- 1s)
                if (Math.abs(rowTs - targetTs) < 1000) {
                    match = rows[dataIndex];
                    dataIndex++;
                } else if (rowTs < targetTs) {
                    // Skip old/duplicate data
                    dataIndex++;
                    i--;
                    continue;
                }
            }

            this.raw_times[i] = targetTs;
            this.times[i] = new Date(targetTs).toLocaleTimeString([], { hour12: false });

            if (match) {
                this.aqi[i] = match.aqi;
                this.temp[i] = match.temp;
                this.hum[i] = match.hum;
                this.prs[i] = match.presence;
            } else {
                this.aqi[i] = null;
                this.temp[i] = null;
                this.hum[i] = null;
                this.prs[i] = null;
            }
        }
        console.log(`[Buffer] Initialized ${this.capacity} slots.`);
    }

    /**
     * Adds a live point.
     * Calculates time difference and inserts "Spacer" (null) points
     * if the new timestamp skipped slots in the 5s grid.
     */
    addLivePoint(timestamp, sensors) {
        const ts = new Date(timestamp).getTime();

        // Get the timestamp of the very last point currently in the buffer
        // (Handle edge case where buffer might be 0/null initialized)
        let lastTs = this.raw_times[this.raw_times.length - 1];
        if (!lastTs) lastTs = ts - this.interval; // Fallback if empty

        // 1. Calculate how many 5s intervals have passed since the last point
        const diff = ts - lastTs;

        // Floor checks how many full 'steps' we need to advance.
        // E.g., if diff is 10000ms, steps = 2.
        const steps = Math.floor(diff / this.interval);

        // Safety: If data is old (steps <= 0), ignore it.
        if (steps <= 0) return;

        // Safety: Don't loop more than capacity (prevent an infinite freeze on huge jumps)
        const stepsToProcess = Math.min(steps, this.capacity);

        // 2. Loop through every missing step to keep the grid aligned
        for (let i = 0; i < stepsToProcess; i++) {
            // Shift oldest out
            this.raw_times.shift();
            this.times.shift();
            this.aqi.shift();
            this.temp.shift();
            this.hum.shift();
            this.prs.shift();

            // Calculate the time for *this* specific slot being added
            const currentStepTs = lastTs + ((i + 1) * this.interval);
            const formattedTime = new Date(currentStepTs).toLocaleTimeString([], { hour12: false });

            // Push the time info
            this.raw_times.push(currentStepTs);
            this.times.push(formattedTime);

            // Is this the final step? (The actual data point we received)
            const isTarget = (i === stepsToProcess - 1);

            if (isTarget) {
                // Fill with actual sensor data
                this.aqi.push(sensors.aqi);
                this.temp.push(sensors.temp);
                this.hum.push(sensors.hum);
                this.prs.push(sensors.prs);
            } else {
                // It is a gap/intermediate step -> Fill with Null
                this.aqi.push(null);
                this.temp.push(null);
                this.hum.push(null);
                this.prs.push(null);
            }
        }
    }
}

class DashboardManager {
    constructor() {
        this.charts = {};

        // Single Fixed Buffer: 720 points, 5000ms (5s) interval
        this.buffer = new TimeSeriesBuffer(720, 5000);

        // Track the exact end time requested to ensure grid alignment
        this.requestedEndTime = null;

        this.ui = {
            wsStatus: document.getElementById('status-ws'),
            nodeStatus: document.getElementById('status-node'),
            sensors: {
                aqi: document.getElementById('live-aqi'),
                temp: document.getElementById('live-temp'),
                hum: document.getElementById('live-hum'),
                prs: document.getElementById('live-prs')
            },
            preds: {}
        };

        this.ws = null;
        this.reconnectTimer = null;
    }

    init() {
        this.initCharts();
        this.connectWebSocket();
    }

    connectWebSocket() {
        if (this.ws) this.ws.close();

        this.ws = new WebSocket('ws://localhost:8765');

        this.ws.onopen = () => {
            console.log('WS Connected');
            this.handleWsStatus(true);
            this.loadHistory(); // Load 1h history immediately
        };

        this.ws.onclose = () => {
            console.log('WS Disconnected');
            this.handleWsStatus(false);
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

            // Add to fixed queue
            this.buffer.addLivePoint(transformed.timestamp, transformed.sensors);

            this.handleData(transformed);
        } else if (msg.type === 'historical') {
            console.log(`[WS] Received ${msg.raw.length} historical rows.`);

            // Hydrate the buffer using the strictly aligned time we requested
            if (this.requestedEndTime) {
                this.buffer.initFromHistory(msg.raw, this.requestedEndTime);
                this.refreshChartsFromBuffer();
            }
        } else if (msg.type === 'smart_node_status') {
            this.updateNodeStatus(msg.status === 'Online');
        }
    }

    /**
     * 1. Aligns Current Time to nearest 5s (floor).
     * 2. Requests data from (AlignedTime - 1h) to AlignedTime.
     * 3. Uses Local Time strings.
     */
    loadHistory() {
        // Align "Now" to nearest 5s grid
        const now = new Date();
        const alignedEnd = this.floorToInterval(now, 5);

        // Start = End - 1 Hour
        const alignedStart = new Date(alignedEnd.getTime() - (60 * 60 * 1000));

        this.requestedEndTime = alignedEnd; // Store for buffer init

        console.log(`[History] Requesting ${this.getLocalISOString(alignedStart)} to ${this.getLocalISOString(alignedEnd)}`);

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'get_historical_time_interval',
                start: this.getLocalISOString(alignedStart),
                end: this.getLocalISOString(alignedEnd)
            }));
        }
    }

    /** Helper: Floor date to nearest X seconds */
    floorToInterval(date, intervalSeconds = 5) {
        const ms = 1000 * intervalSeconds;
        return new Date(Math.floor(date.getTime() / ms) * ms);
    }

    /** Helper: Get Local ISO String (YYYY-MM-DD HH:MM:SS) */
    getLocalISOString(date) {
        const offset = date.getTimezoneOffset() * 60000;
        return new Date(date - offset).toISOString().slice(0, 19).replace('T', ' ');
    }

    transformLiveData(msg) {
        const [ts, aqi, temp, hum, prs] = msg.raw;
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
            nodeStatus: true
        };
    }

    handleData(data) {
        this.updateSensorCards(data.sensors);
        this.updatePredictions(data.predictions);
        this.updateNodeStatus(data.nodeStatus);
        this.refreshChartsFromBuffer();
    }

    refreshChartsFromBuffer() {
        // Direct assignment of fixed arrays to chart
        this.updateChartData(this.charts.aqi, this.buffer.times, this.buffer.aqi);
        this.updateChartData(this.charts.temp, this.buffer.times, this.buffer.temp);
        this.updateChartData(this.charts.hum, this.buffer.times, this.buffer.hum);
        this.updateChartData(this.charts.prs, this.buffer.times, this.buffer.prs);
    }

    updateChartData(chart, labels, data) {
        chart.data.labels = labels;
        chart.data.datasets[0].data = data;
        chart.update('none'); // No animation for high-frequency updates
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
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };
        if (preds.p1) { set('p1-aqi', preds.p1.aqi); set('p1-temp', preds.p1.temp); set('p1-hum', preds.p1.hum); }
        if (preds.p5) { set('p5-aqi', preds.p5.aqi); set('p5-temp', preds.p5.temp); set('p5-hum', preds.p5.hum); }
        if (preds.p15) { set('p15-aqi', preds.p15.aqi); set('p15-temp', preds.p15.temp); set('p15-hum', preds.p15.hum); }
    }

    handleWsStatus(connected) {
        const action = connected ? 'add' : 'remove';
        const inverse = connected ? 'remove' : 'add';
        this.ui.wsStatus.classList[action]('status-connected');
        this.ui.wsStatus.classList[inverse]('status-disconnected');
    }

    updateNodeStatus(active) {
        const action = active ? 'add' : 'remove';
        const inverse = active ? 'remove' : 'add';
        this.ui.nodeStatus.classList[action]('status-connected');
        this.ui.nodeStatus.classList[inverse]('status-disconnected');
    }

    initCharts() {
        const commonConfig = {
            type: 'line',
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8' }
                    }
                },
                elements: {
                    point: { radius: 0 },
                    line: { tension: 0.1, borderWidth: 2 }
                }
            }
        };

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

        // Presence Chart (Stepped Visuals)
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
                        borderWidth: 3,
                        stepped: 'after' // Correct visual logic for binary state holding
                    },
                    point: {
                        pointStyle: 'rect',
                        radius: 0,
                        hoverRadius: 4,
                        backgroundColor: (ctx) => ctx.raw === 1 ? '#10b981' : 'rgba(148, 163, 184, 0.5)'
                    }
                }
            },
            data: {
                datasets: [{
                    label: 'Presence',
                    data: [],
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
}

// Start Application
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new DashboardManager();
    window.dashboard.init();
});