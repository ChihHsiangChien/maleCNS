/**
 * Module 2 Port: 3-Stage Drosophila Optic Lobe Visual Processing Engine (HTML5/JS)
 *
 * Implements:
 * 1. Stage 1 (Lamina): Photoreceptors R1-R6 (32x32) -> L1 ON (Brightening) & L2/L3 OFF (Darkening) splitting
 * 2. Stage 2 (Medulla): Temporal delay buffers (Mi1/Mi9 slow vs Tm3/Mi4 fast, Tm9/Tm4 slow vs Tm1/Tm2 fast)
 * 3. Stage 3 (Lobula): T4a-d (ON) & T5a-d (OFF) 4-Cardinal Direction Reichardt Motion Correlators
 * 4. Synthetic Motion Generators (looming, stmd_dot, yaw_sweep, pitch_sweep, auto, mouse_interactive)
 * 5. WebCam & Video Stream Input Processing via HTML5 Canvas
 */

class OpticLobePipeline {
    constructor(gridSize = 32, stimulusMode = "auto") {
        this.gridSize = gridSize;
        this.numPixels = gridSize * gridSize;
        this.stimulusMode = stimulusMode.toLowerCase();

        this.frameCounter = 0;
        this.prevGray = new Float32Array(this.numPixels);
        this.currGray = new Float32Array(this.numPixels);

        // Delay Buffers for Medulla Stage
        this.maxDelayDepth = 2;
        this.delayBufferOn = [];
        this.delayBufferOff = [];

        // Internal Canvases for frame processing & mouse interaction
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCanvas.width = 300;
        this.offscreenCanvas.height = 300;
        this.offscreenCtx = this.offscreenCanvas.getContext('2d');

        // Mouse/Touch Interactive Cursor State
        this.mousePos = { x: 150, y: 150, isDown: false, radius: 25 };

        // WebCam Stream State
        this.videoElement = null;
        this.isWebcamActive = false;
    }

    /**
     * Binds mouse and touch listeners to target DOM canvases (Panel 1 / Panel 2).
     */
    bindTargetCanvas(canvasElem) {
        if (!canvasElem) return;

        const updatePos = (clientX, clientY) => {
            const rect = canvasElem.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                const relX = (clientX - rect.left) / rect.width * 300;
                const relY = (clientY - rect.top) / rect.height * 300;
                this.mousePos.x = Math.min(300, Math.max(0, relX));
                this.mousePos.y = Math.min(300, Math.max(0, relY));
            }
        };

        canvasElem.addEventListener('mousemove', (e) => {
            updatePos(e.clientX, e.clientY);
        });

        canvasElem.addEventListener('mousedown', (e) => {
            this.mousePos.isDown = true;
            updatePos(e.clientX, e.clientY);
        });

        window.addEventListener('mouseup', () => {
            this.mousePos.isDown = false;
        });

        // Touch support for mobile & tablet
        canvasElem.addEventListener('touchmove', (e) => {
            if (e.touches && e.touches.length > 0) {
                updatePos(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { passive: true });

        canvasElem.addEventListener('touchstart', (e) => {
            this.mousePos.isDown = true;
            if (e.touches && e.touches.length > 0) {
                updatePos(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { passive: true });

        window.addEventListener('touchend', () => {
            this.mousePos.isDown = false;
        });
    }

    /**
     * Connects to user's webcam feed.
     */
    async initWebcam() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 300, height: 300 } });
            this.videoElement = document.createElement('video');
            this.videoElement.srcObject = stream;
            this.videoElement.play();
            this.isWebcamActive = true;
            console.log("[OpticLobePipeline] WebCam stream successfully initialized.");
            return true;
        } catch (err) {
            console.warn("[OpticLobePipeline] WebCam access failed/denied, falling back to synthetic motion:", err);
            this.isWebcamActive = false;
            return false;
        }
    }

    stopWebcam() {
        if (this.videoElement && this.videoElement.srcObject) {
            const tracks = this.videoElement.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            this.videoElement = null;
        }
        this.isWebcamActive = false;
    }

    setStimulusMode(mode) {
        this.stimulusMode = mode.toLowerCase();
        if (this.stimulusMode !== 'webcam') {
            this.stopWebcam();
        }
    }

    /**
     * Generates benchmark biological visual stimuli for 4 pathways:
     * - 'stmd_dot': Small 16x16 dot moving across center (Tests LC11 / STMD)
     * - 'yaw_sweep': Vertical bar sweeping horizontally (Tests HS / Yaw)
     * - 'pitch_sweep': Horizontal bar sweeping vertically (Tests VS / Pitch)
     * - 'looming': Expanding circle (Tests LC4 / Looming)
     * - 'auto': Rotates through all 4 benchmark stimuli sequentially
     * - 'mouse_interactive': Interactive object tracking user cursor
     */
    _generateSyntheticFrame() {
        const ctx = this.offscreenCtx;
        const w = 300;
        const h = 300;

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);

        let mode = this.stimulusMode;
        if (mode === "auto") {
            const phase = Math.floor(this.frameCounter / 50) % 4;
            const modes = ["looming", "stmd_dot", "yaw_sweep", "pitch_sweep"];
            mode = modes[phase];
        }

        ctx.fillStyle = '#ffffff';

        if (mode === "stmd_dot") {
            // Small Target Motion Stimulus (Triggers LC11 STMD without surround inhibition)
            const dotX = (this.frameCounter * 10) % w;
            const dotY = 150;
            ctx.beginPath();
            ctx.arc(dotX, dotY, 8, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#00ffff';
            ctx.font = '12px Inter, sans-serif';
            ctx.fillText("STMD Small Target (LC11)", 10, 25);

        } else if (mode === "yaw_sweep") {
            // Horizontal Sweeping Bar Stimulus (Triggers HS Yaw optical flow)
            const barX = (this.frameCounter * 12) % w;
            ctx.fillRect(barX, 0, 35, h);

            ctx.fillStyle = '#00ff66';
            ctx.font = '12px Inter, sans-serif';
            ctx.fillText("Horizontal Yaw Sweep (HS)", 10, 25);

        } else if (mode === "pitch_sweep") {
            // Vertical Sweeping Bar Stimulus (Triggers VS Pitch optical flow)
            const barY = (this.frameCounter * 12) % h;
            ctx.fillRect(0, barY, w, 35);

            ctx.fillStyle = '#ffaa00';
            ctx.font = '12px Inter, sans-serif';
            ctx.fillText("Vertical Pitch Sweep (VS)", 10, 25);

        } else if (mode === "mouse_interactive") {
            // Mouse/Touch Interactive Target
            const r = this.mousePos.isDown ? 45 : 20;
            ctx.beginPath();
            ctx.arc(this.mousePos.x, this.mousePos.y, r, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ff0055';
            ctx.font = '12px Inter, sans-serif';
            ctx.fillText("Interactive Cursor Stimulus", 10, 25);

        } else {
            // Looming Avoidance Stimulus (Expanding Circle - Triggers LC4 Looming Avoidance)
            const t = this.frameCounter * 0.12;
            const radius = Math.floor(15 + 100 * (0.5 + 0.5 * Math.sin(t)));
            ctx.beginPath();
            ctx.arc(150, 150, radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffff00';
            ctx.font = '12px Inter, sans-serif';
            ctx.fillText("Looming Avoidance (LC4)", 10, 25);
        }

        return ctx.getImageData(0, 0, w, h);
    }

    /**
     * Processes next frame through 3-Stage Optic Lobe Model.
     * Returns: { rawImageData, retinalGray, motionVector, heatmaps }
     */
    readFrame() {
        this.frameCounter++;

        let imgData;
        if (this.isWebcamActive && this.videoElement && this.videoElement.readyState === 4) {
            this.offscreenCtx.drawImage(this.videoElement, 0, 0, 300, 300);
            imgData = this.offscreenCtx.getImageData(0, 0, 300, 300);
        } else {
            imgData = this._generateSyntheticFrame();
        }

        // --- Stage 1: Photoreceptors & Signal Splitting (Lamina) ---
        const data = imgData.data;
        const cellW = 300 / this.gridSize;
        const cellH = 300 / this.gridSize;

        const downscaledGray = new Float32Array(this.numPixels);
        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                const srcX = Math.floor((x + 0.5) * cellW);
                const srcY = Math.floor((y + 0.5) * cellH);
                const idx = (srcY * 300 + srcX) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];
                // Grayscale luminance
                downscaledGray[y * this.gridSize + x] = 0.299 * r + 0.587 * g + 0.114 * b;
            }
        }

        if (this.frameCounter === 1) {
            this.prevGray.set(downscaledGray);
        }

        // Signed intensity difference: ΔI = curr - prev
        const l1_on = new Float32Array(this.numPixels);
        const l2_off = new Float32Array(this.numPixels);

        for (let i = 0; i < this.numPixels; i++) {
            const diff = downscaledGray[i] - this.prevGray[i];
            // L1 ON channel (brightening ΔI > 0)
            const onVal = Math.max(0.0, diff);
            // L2/L3 OFF channel (darkening ΔI < 0)
            const offVal = Math.max(0.0, -diff);

            // Noise thresholding (> 6.0)
            l1_on[i] = (onVal >= 6.0 ? onVal : 0.0) / 255.0;
            l2_off[i] = (offVal >= 6.0 ? offVal : 0.0) / 255.0;
        }

        this.prevGray.set(downscaledGray);

        // --- Stage 2: Temporal Delay Buffers (Medulla) ---
        this.delayBufferOn.push(new Float32Array(l1_on));
        this.delayBufferOff.push(new Float32Array(l2_off));

        if (this.delayBufferOn.length > this.maxDelayDepth) {
            this.delayBufferOn.shift();
            this.delayBufferOff.shift();
        }

        const mi1_slow = this.delayBufferOn[0];                                // Delayed ON signal (Mi1/Mi9)
        const tm3_fast = this.delayBufferOn[this.delayBufferOn.length - 1];     // Instant ON signal (Tm3/Mi4)
        const tm9_slow = this.delayBufferOff[0];                               // Delayed OFF signal (Tm9/Tm4)
        const tm1_fast = this.delayBufferOff[this.delayBufferOff.length - 1];   // Instant OFF signal (Tm1/Tm2)

        // --- Stage 3: Directional Correlation (Lobula: Reichardt Correlators) ---
        const t4a = new Float32Array(this.numPixels); // ON Right
        const t4b = new Float32Array(this.numPixels); // ON Left
        const t4c = new Float32Array(this.numPixels); // ON Up
        const t4d = new Float32Array(this.numPixels); // ON Down

        const t5a = new Float32Array(this.numPixels); // OFF Right
        const t5b = new Float32Array(this.numPixels); // OFF Left
        const t5c = new Float32Array(this.numPixels); // OFF Up
        const t5d = new Float32Array(this.numPixels); // OFF Down

        const gs = this.gridSize;
        for (let y = 0; y < gs; y++) {
            for (let x = 0; x < gs; x++) {
                const idx = y * gs + x;

                // Shifted coordinates with wrap-around boundary logic
                const xRight = (x + 1) % gs;
                const xLeft  = (x - 1 + gs) % gs;
                const yUp    = (y - 1 + gs) % gs;
                const yDown  = (y + 1) % gs;

                // T4 (ON) 4 Directions
                t4a[idx] = mi1_slow[y * gs + xLeft] * tm3_fast[idx];  // Motion to Right
                t4b[idx] = mi1_slow[y * gs + xRight] * tm3_fast[idx]; // Motion to Left
                t4c[idx] = mi1_slow[yDown * gs + x] * tm3_fast[idx];  // Motion Up
                t4d[idx] = mi1_slow[yUp * gs + x] * tm3_fast[idx];    // Motion Down

                // T5 (OFF) 4 Directions
                t5a[idx] = tm9_slow[y * gs + xLeft] * tm1_fast[idx];  // Motion to Right
                t5b[idx] = tm9_slow[y * gs + xRight] * tm1_fast[idx]; // Motion to Left
                t5c[idx] = tm9_slow[yDown * gs + x] * tm1_fast[idx];  // Motion Up
                t5d[idx] = tm9_slow[yUp * gs + x] * tm1_fast[idx];    // Motion Down
            }
        }

        const t4_all = new Float32Array(this.numPixels);
        const t5_all = new Float32Array(this.numPixels);
        const motion_vector = new Float32Array(this.numPixels);

        for (let i = 0; i < this.numPixels; i++) {
            t4_all[i] = t4a[i] + t4b[i] + t4c[i] + t4d[i];
            t5_all[i] = t5a[i] + t5b[i] + t5c[i] + t5d[i];
            const rawM = t4_all[i] + t5_all[i] + 0.5 * (l1_on[i] + l2_off[i]);
            motion_vector[i] = Math.min(1.0, Math.max(0.0, rawM));
        }

        const heatmaps = {
            "R1_R6": downscaledGray,
            "L1_ON": l1_on,
            "L2_OFF": l2_off,
            "Mi1_slow": mi1_slow,
            "Tm3_fast": tm3_fast,
            "Tm9_slow": tm9_slow,
            "Tm1_fast": tm1_fast,
            "T4a": t4a, "T4b": t4b, "T4c": t4c, "T4d": t4d,
            "T5a": t5a, "T5b": t5b, "T5c": t5c, "T5d": t5d,
            "T4_all": t4_all,
            "T5_all": t5_all,
            "motion_vector": motion_vector
        };

        return {
            rawImageData: imgData,
            retinalGray: downscaledGray,
            motionVector: motion_vector,
            heatmaps: heatmaps
        };
    }
}
