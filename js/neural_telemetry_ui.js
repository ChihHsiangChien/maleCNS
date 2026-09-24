/**
 * Module 4 Port: Multi-Channel Real-Time Visualization & Telemetry Dashboard (HTML5/JS)
 *
 * Implements:
 * 1. Panel 1: Retinal Grid 32x32 Visualizer
 * 2. Panel 2: Selectable 12-Mode Retinotopic Heatmap Engine (R1-6, L1, L2, Mi1, Tm3, T4, T5, LC4, LC11, HS, VS, 8-Dir Reichardt Overview Grid)
 * 3. Panel 3: Multi-Channel Real-Time Oscilloscope (LC4, LC11, HS, VS $V_m$ waveforms + Action Potential Spikes)
 * 4. Keyboard Shortcuts ('1'-'9', '0', 'a', 'g') and Interactive Heatmap Switcher Bar
 */

class NeuralTelemetryUI {
    static CHANNELS = ["LC4", "LC11", "HS", "VS"];

    constructor() {
        // Canvases
        this.retinaCanvas = document.getElementById('retinaCanvas');
        this.retinaCtx = this.retinaCanvas ? this.retinaCanvas.getContext('2d') : null;

        this.heatmapCanvas = document.getElementById('heatmapCanvas');
        this.heatmapCtx = this.heatmapCanvas ? this.heatmapCanvas.getContext('2d') : null;

        this.oscilloscopeCanvas = document.getElementById('oscilloscopeCanvas');
        this.oscCtx = this.oscilloscopeCanvas ? this.oscilloscopeCanvas.getContext('2d') : null;

        this.activeHeatmapMode = "6"; // Default: T4_all
        this.heatmapLabels = {
            "1": "R1-R6 Raw Luminance",
            "2": "L1 ON Edge (Brightening)",
            "3": "L2 OFF Edge (Darkening)",
            "4": "Mi1 Slow Delay Buffer",
            "5": "Tm3 Fast Instant Frame",
            "6": "T4 ON Reichardt Motion",
            "7": "T5 OFF Reichardt Motion",
            "8": "LC4 Obstacle Heatmap",
            "9": "LC11 SmallTarget Heatmap",
            "0": "HS Yaw Motion Heatmap",
            "a": "VS Pitch Motion Heatmap",
            "g": "8-Dir Reichardt Grid"
        };

        // Channel Waveform Colors
        this.channelColors = {
            "LC4": "#ffff00",   // Yellow: Obstacle Avoidance
            "LC11": "#ff00ff",  // Magenta: STMD Small Target
            "HS": "#00ff66",    // Green: Yaw Optical Flow
            "VS": "#ffaa00"     // Orange: Pitch Optical Flow
        };

        // Oscilloscope History Buffers
        this.historyLen = 120;
        this.histories = {
            "LC4": [],
            "LC11": [],
            "HS": [],
            "VS": []
        };

        // Performance FPS state
        this.lastTime = performance.now();
        this.fps = 60.0;

        this._setupKeyboardListeners();
    }

    _setupKeyboardListeners() {
        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            if (this.heatmapLabels[key]) {
                this.activeHeatmapMode = key;
                this._updateActiveButtonUI();
            }
        });
    }

    setHeatmapMode(mode) {
        if (this.heatmapLabels[mode]) {
            this.activeHeatmapMode = mode;
            this._updateActiveButtonUI();
        }
    }

    _updateActiveButtonUI() {
        const btns = document.querySelectorAll('.heatmap-btn');
        btns.forEach(btn => {
            if (btn.getAttribute('data-mode') === this.activeHeatmapMode) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        const labelElem = document.getElementById('heatmapTitleLabel');
        if (labelElem) {
            labelElem.textContent = `[${this.activeHeatmapMode}] ${this.heatmapLabels[this.activeHeatmapMode] || ''}`;
        }
    }

    /**
     * Updates and renders all 3 telemetry visual panels.
     */
    update(opticData, neuralResult) {
        const now = performance.now();
        const dt = (now - this.lastTime) / 1000.0;
        this.lastTime = now;
        if (dt > 0) {
            this.fps = 0.9 * this.fps + 0.1 * (1.0 / dt);
        }

        const channels = neuralResult.channels || {};

        // Update history buffers
        NeuralTelemetryUI.CHANNELS.forEach(ch => {
            const v = channels[ch] ? channels[ch].membranePotential : 0.0;
            this.histories[ch].push(v);
            if (this.histories[ch].length > this.historyLen) {
                this.histories[ch].shift();
            }
        });

        // 1. Render Retinal Canvas
        this._renderRetinalGrid(opticData.retinalGray);

        // 2. Render Heatmap Canvas
        this._renderHeatmap(opticData, neuralResult);

        // 3. Render Oscilloscope Canvas
        this._renderOscilloscope(neuralResult);

        // 4. Update Stats & Metrics DOM
        this._updateDOMMetrics(channels);
    }

    _renderRetinalGrid(retinalGray) {
        if (!this.retinaCtx) return;
        const ctx = this.retinaCtx;
        const w = this.retinaCanvas.width;
        const h = this.retinaCanvas.height;
        const gs = 32;
        const cellW = w / gs;
        const cellH = h / gs;

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);

        if (!retinalGray) return;

        for (let y = 0; y < gs; y++) {
            for (let x = 0; x < gs; x++) {
                const val = retinalGray[y * gs + x] || 0;
                const norm = Math.min(255, Math.max(0, Math.floor(val)));
                ctx.fillStyle = `rgb(${norm},${norm},${norm})`;
                ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
            }
        }

        // Draw subtle grid overlay lines
        ctx.strokeStyle = 'rgba(40, 60, 90, 0.4)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= gs; i += 4) {
            ctx.beginPath();
            ctx.moveTo(i * cellW, 0);
            ctx.lineTo(i * cellW, h);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(0, i * cellH);
            ctx.lineTo(w, i * cellH);
            ctx.stroke();
        }
    }

    _renderHeatmap(opticData, neuralResult) {
        if (!this.heatmapCtx) return;
        const ctx = this.heatmapCtx;
        const w = this.heatmapCanvas.width;
        const h = this.heatmapCanvas.height;
        const gs = 32;

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);

        const mode = this.activeHeatmapMode;
        const heatmaps = opticData.heatmaps || {};
        const channels = neuralResult.channels || {};

        if (mode === "g") {
            // 8-Direction Reichardt Overview Grid (2 rows x 4 cols)
            const dirs = [
                { key: "T4a", label: "T4 R (ON)" }, { key: "T4b", label: "T4 L (ON)" }, { key: "T4c", label: "T4 U (ON)" }, { key: "T4d", label: "T4 D (ON)" },
                { key: "T5a", label: "T5 R (OFF)" }, { key: "T5b", label: "T5 L (OFF)" }, { key: "T5c", label: "T5 U (OFF)" }, { key: "T5d", label: "T5 D (OFF)" }
            ];

            const subW = w / 4;
            const subH = h / 2;

            dirs.forEach((d, idx) => {
                const r = Math.floor(idx / 4);
                const c = idx % 4;
                const arr = heatmaps[d.key] || new Float32Array(gs * gs);
                this._drawSubHeatmap(ctx, arr, c * subW, r * subH, subW, subH, d.label);
            });
            return;
        }

        // Single Heatmap Mode
        let targetMap = opticData.motionVector;
        if (["8", "9", "0", "a"].includes(mode)) {
            const chMap = { "8": "LC4", "9": "LC11", "0": "HS", "a": "VS" };
            const chName = chMap[mode];
            targetMap = channels[chName] ? channels[chName].spatialMap : new Float32Array(gs * gs);
        } else {
            const modeMap = {
                "1": "R1_R6", "2": "L1_ON", "3": "L2_OFF",
                "4": "Mi1_slow", "5": "Tm3_fast", "6": "T4_all", "7": "T5_all"
            };
            const mapKey = modeMap[mode] || "motion_vector";
            targetMap = heatmaps[mapKey] || opticData.motionVector;
        }

        this._drawSubHeatmap(ctx, targetMap, 0, 0, w, h, null);
    }

    _drawSubHeatmap(ctx, dataArr, offsetX, offsetY, width, height, label) {
        const gs = 32;
        const cellW = width / gs;
        const cellH = height / gs;

        for (let y = 0; y < gs; y++) {
            for (let x = 0; x < gs; x++) {
                const val = dataArr[y * gs + x] || 0.0;
                // JET colormap approximation: black -> blue -> cyan -> green -> yellow -> red
                ctx.fillStyle = this._getJetColor(val);
                ctx.fillRect(offsetX + x * cellW, offsetY + y * cellH, cellW, cellH);
            }
        }

        if (label) {
            ctx.fillStyle = '#ffffff';
            ctx.font = '10px Inter, sans-serif';
            ctx.fillText(label, offsetX + 4, offsetY + 12);
        }
    }

    _getJetColor(v) {
        const val = Math.min(1.0, Math.max(0.0, v * 1.5));
        if (val === 0) return '#000000';
        const r = Math.floor(255 * Math.min(1.0, Math.max(0.0, 1.5 - Math.abs(val * 4 - 3))));
        const g = Math.floor(255 * Math.min(1.0, Math.max(0.0, 1.5 - Math.abs(val * 4 - 2))));
        const b = Math.floor(255 * Math.min(1.0, Math.max(0.0, 1.5 - Math.abs(val * 4 - 1))));
        return `rgb(${r},${g},${b})`;
    }

    _renderOscilloscope(neuralResult) {
        if (!this.oscCtx) return;
        const ctx = this.oscCtx;
        const w = this.oscilloscopeCanvas.width;
        const h = this.oscilloscopeCanvas.height;

        ctx.fillStyle = '#04060b';
        ctx.fillRect(0, 0, w, h);

        const channels = neuralResult.channels || {};

        // Find max potential in recent history for dynamic responsive auto-scaling (minimum range 10.0 mV)
        let maxObservedV = 10.0;
        NeuralTelemetryUI.CHANNELS.forEach(ch => {
            const hist = this.histories[ch];
            for (let v of hist) {
                if (v > maxObservedV && v < 50.0) maxObservedV = v;
            }
        });
        const displayMaxV = Math.min(45.0, maxObservedV * 1.3);

        // Draw horizontal grid voltage reference lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;

        const gridSteps = [0, displayMaxV * 0.33, displayMaxV * 0.66, displayMaxV];
        gridSteps.forEach((vStep) => {
            const yPos = h - 25 - (vStep / displayMaxV) * (h - 50);
            ctx.beginPath();
            ctx.moveTo(0, yPos);
            ctx.lineTo(w, yPos);
            ctx.stroke();

            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.font = '13px "JetBrains Mono", monospace';
            ctx.fillText(`${vStep.toFixed(1)}mV`, 8, yPos - 4);
        });

        // Draw Spike Threshold Line (37.5 mV) if in range
        if (displayMaxV >= 28.0) {
            const ySpike = h - 25 - (37.5 / displayMaxV) * (h - 50);
            ctx.strokeStyle = 'rgba(255, 0, 85, 0.6)';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(0, ySpike);
            ctx.lineTo(w, ySpike);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#ff0055';
            ctx.font = 'bold 12px "JetBrains Mono", monospace';
            ctx.fillText("⚡ SPIKE THRESH (37.5mV)", w - 190, ySpike - 4);
        }

        // Draw channel waveforms with high line width, glowing shadow, and full height scaling
        NeuralTelemetryUI.CHANNELS.forEach(ch => {
            const hist = this.histories[ch];
            if (hist.length < 2) return;

            const isFiring = channels[ch] ? channels[ch].isFiring : false;

            ctx.save();
            ctx.strokeStyle = this.channelColors[ch];
            ctx.lineWidth = isFiring ? 5 : 3.5;
            ctx.shadowColor = this.channelColors[ch];
            ctx.shadowBlur = isFiring ? 16 : 8;
            ctx.beginPath();

            for (let i = 0; i < hist.length; i++) {
                const val = hist[i];
                const xPos = (i / (this.historyLen - 1)) * w;
                const yPos = Math.max(15, Math.min(h - 15, h - 25 - (val / displayMaxV) * (h - 50)));

                if (i === 0) ctx.moveTo(xPos, yPos);
                else ctx.lineTo(xPos, yPos);
            }
            ctx.stroke();

            // Draw current value tip indicator
            if (hist.length > 0) {
                const lastVal = hist[hist.length - 1];
                const lastX = w - 6;
                const lastY = Math.max(15, Math.min(h - 15, h - 25 - (lastVal / displayMaxV) * (h - 50)));
                ctx.fillStyle = this.channelColors[ch];
                ctx.beginPath();
                ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.restore();
        });
    }

    _updateDOMMetrics(channels) {
        NeuralTelemetryUI.CHANNELS.forEach(ch => {
            const chData = channels[ch] || {};
            const v = chData.membranePotential || 0.0;
            const isFiring = chData.isFiring || false;

            const valElem = document.getElementById(`val_${ch}`);
            const barElem = document.getElementById(`bar_${ch}`);
            const badgeElem = document.getElementById(`badge_${ch}`);

            if (valElem) valElem.textContent = `${v.toFixed(1)} mV`;
            if (barElem) {
                const pct = Math.min(100, (v / 50.0) * 100);
                barElem.style.width = `${pct}%`;
            }
            if (badgeElem) {
                if (isFiring) {
                    badgeElem.className = 'spike-badge active';
                    badgeElem.textContent = '⚡ FIRE!';
                } else {
                    badgeElem.className = 'spike-badge';
                    badgeElem.textContent = 'REST';
                }
            }

            // Update SVG Topology Circuit Diagram Nodes
            const topoNode = document.getElementById(`topo_${ch}`);
            if (topoNode) {
                if (isFiring) {
                    topoNode.setAttribute('stroke-width', '4');
                    topoNode.setAttribute('filter', 'drop-shadow(0 0 10px #ff0055)');
                } else if (v > 5.0) {
                    topoNode.setAttribute('stroke-width', '3');
                    topoNode.setAttribute('filter', 'drop-shadow(0 0 6px #00f0ff)');
                } else {
                    topoNode.setAttribute('stroke-width', '2');
                    topoNode.removeAttribute('filter');
                }
            }
        });

        const fpsElem = document.getElementById('statFps');
        if (fpsElem) fpsElem.textContent = `${this.fps.toFixed(1)} FPS`;
    }
}
