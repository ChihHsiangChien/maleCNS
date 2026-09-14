/**
 * Connectome Brain Neural Simulation & Evolutionary Agent for Space Invaders
 *
 * Implements fruit fly retinotopic vision (32x32 ommatidia array),
 * directional motion selective neurons (T4/T5), looming threat neurons (LC4),
 * visual alignment neurons (LC11), neurotransmitter dynamics (ACh/GABA),
 * and evolutionary genetic algorithm training.
 */

class ConnectomeBrain {
    constructor(gridSize = 32) {
        this.gridSize = gridSize;
        this.numOmmatidia = gridSize * gridSize;
        
        this.prevRetina = new Float32Array(this.numOmmatidia);
        this.currRetina = new Float32Array(this.numOmmatidia);
        this.motionVector = new Float32Array(this.numOmmatidia);
        
        // Synaptic Genome Weights (Evolutionary Parameters)
        this.weights = {
            // T4/T5 Motion Directional Weights (Left vs Right preference)
            w_T4_left: 1.5,
            w_T4_right: 1.5,
            
            // LC4 Looming Threat Reaction Weight (Lower visual field)
            w_LC4_dodge: 2.5,
            
            // LC11 Visual Target Centering Weight (Shooting alignment)
            w_LC11_shoot: 2.0,
            
            // Neurotransmitter Polarity Scaling
            gain_ACh: 1.2,    // Excitatory gain
            gain_GABA: -1.0,  // Inhibitory gain
            
            // Activation Threshold Filter
            activationThreshold: 0.15,
            leakFactor: 0.65
        };

        // Internal Membrane Potentials
        this.v_left = 0.0;
        this.v_right = 0.0;
        this.v_lc4_threat = 0.0;
        this.v_lc11_shoot = 0.0;

        // Motor Command Signals
        this.motorSignals = {
            moveLeft: false,
            moveRight: false,
            shoot: false
        };

        // Historical Oscilloscope Buffer
        this.historyLen = 80;
        this.vHistory = [];
    }

    /**
     * Processes game canvas image frame and calculates neural response.
     * @param {HTMLCanvasElement} gameCanvas 
     * @returns {Object} Motor signals and neural diagnostic state
     */
    processFrame(gameCanvas, playerX = 200, playerW = 32) {
        const ctx = gameCanvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, gameCanvas.width, gameCanvas.height);
        const data = imgData.data;

        // 1. Retinal Downscaling to (32 x 32)
        const cellW = gameCanvas.width / this.gridSize;
        const cellH = gameCanvas.height / this.gridSize;

        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                const srcX = Math.floor((x + 0.5) * cellW);
                const srcY = Math.floor((y + 0.5) * cellH);
                const idx = (srcY * gameCanvas.width + srcX) * 4;

                // Grayscale luminance
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];
                const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;

                const oIdx = y * this.gridSize + x;
                this.currRetina[oIdx] = lum;
                
                // Motion Difference: |curr - prev|
                this.motionVector[oIdx] = Math.abs(this.currRetina[oIdx] - this.prevRetina[oIdx]);
                this.prevRetina[oIdx] = this.currRetina[oIdx];
            }
        }

        // 2. Compute Sub-Network Membrane Potentials with Relative Spatial Coordinates
        this._computeNeuralDynamics(playerX, playerW, gameCanvas.width);

        // 3. Update History Buffer
        const netPotential = (this.v_left + this.v_right + this.v_lc4_threat + this.v_lc11_shoot);
        this.vHistory.push(netPotential);
        if (this.vHistory.length > this.historyLen) {
            this.vHistory.shift();
        }

        return {
            retina: this.currRetina,
            motion: this.motionVector,
            motor: this.motorSignals,
            potentials: {
                v_left: this.v_left,
                v_right: this.v_right,
                v_threat: this.v_lc4_threat,
                v_shoot: this.v_lc11_shoot,
                net: netPotential
            }
        };
    }

    /**
     * Internal neural matrix calculation engine with relative spatial coordinates, reciprocal inhibition & wall-stuck prevention.
     */
    _computeNeuralDynamics(playerX = 200, playerW = 32, canvasW = 400) {
        let driveLeft = 0.0;
        let driveRight = 0.0;
        let driveThreatLeft = 0.0;
        let driveThreatRight = 0.0;
        let driveShoot = 0.0;

        // Calculate player position in 32x32 ommatidia grid coordinates
        const playerGridX = (playerX + playerW / 2) / canvasW * this.gridSize;

        // 1. Calculate Alien Swarm Luminance Centroid (Center of Mass X)
        let totalAlienLum = 0.0;
        let alienSumX = 0.0;

        for (let y = 0; y < Math.floor(this.gridSize * 0.75); y++) {
            for (let x = 0; x < this.gridSize; x++) {
                const idx = y * this.gridSize + x;
                const lum = this.currRetina[idx];
                if (lum > 0.15) {
                    totalAlienLum += lum;
                    alienSumX += x * lum;
                }
            }
        }

        let alienCentroidX = playerGridX;
        if (totalAlienLum > 0.5) {
            alienCentroidX = alienSumX / totalAlienLum;
        }

        // 2. Optical Motion & Centroid Attraction (T4/T5 Directional Tracking)
        const targetDiffX = alienCentroidX - playerGridX;
        if (Math.abs(targetDiffX) > 1.2) {
            if (targetDiffX < 0) {
                // Aliens are to the left -> Drive Left
                driveLeft += Math.min(3.0, Math.abs(targetDiffX) * 0.25) * this.weights.w_T4_left * this.weights.gain_ACh;
            } else {
                // Aliens are to the right -> Drive Right
                driveRight += Math.min(3.0, Math.abs(targetDiffX) * 0.25) * this.weights.w_T4_right * this.weights.gain_ACh;
            }
        }

        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                const idx = y * this.gridSize + x;
                const m = this.motionVector[idx];
                const lum = this.currRetina[idx];

                // 3. High-Sensitivity LC4 Looming Threat Detector for Enemy Missiles (y > 16)
                if (y > Math.floor(this.gridSize * 0.5)) {
                    if (m > 0.04) {
                        const dx = x - playerGridX;
                        // If missile is approaching near player ship (-3 <= dx <= 3)
                        if (Math.abs(dx) <= 3.5) {
                            if (dx <= 0) {
                                // Missile approaching on left side -> Dodge RIGHT
                                driveThreatRight += m * this.weights.w_LC4_dodge * 4.0;
                            } else {
                                // Missile approaching on right side -> Dodge LEFT
                                driveThreatLeft += m * this.weights.w_LC4_dodge * 4.0;
                            }
                        }
                    }
                }

                // 4. LC11 Visual Target Centering Detector (Overhead alignment for Shooting)
                if (Math.abs(x - playerGridX) <= 2.2 && y < Math.floor(this.gridSize * 0.8)) {
                    if (lum > 0.2) {
                        driveShoot += lum * this.weights.w_LC11_shoot;
                    }
                }
            }
        }

        // Leaky Integration & Reciprocal Inhibition (T4 Left vs T5 Right Mutual Inhibition)
        const leak = this.weights.leakFactor;

        this.v_left = (leak * this.v_left) + driveLeft;
        this.v_right = (leak * this.v_right) + driveRight;

        // Reciprocal Inhibition (Biological opponent processing)
        const inhFactor = 0.4;
        const tempLeft = Math.max(0, this.v_left - inhFactor * this.v_right);
        const tempRight = Math.max(0, this.v_right - inhFactor * this.v_left);
        this.v_left = tempLeft;
        this.v_right = tempRight;

        // Evasive Threat Overrides Normal Tracking
        if (driveThreatLeft > 0.3 || driveThreatRight > 0.3) {
            if (driveThreatLeft > driveThreatRight) {
                this.v_left += driveThreatLeft * 3.0;
            } else {
                this.v_right += driveThreatRight * 3.0;
            }
        }

        // Prevent Wall-Stuck Accumulation: Decay potential when pressed against outer walls
        if (playerGridX >= this.gridSize - 2.5) {
            // Pressed against right wall -> Drain right potential so it can turn left freely
            this.v_right *= 0.2;
        } else if (playerGridX <= 2.5) {
            // Pressed against left wall -> Drain left potential so it can turn right freely
            this.v_left *= 0.2;
        }

        this.v_lc4_threat = (leak * this.v_lc4_threat) + (driveThreatLeft + driveThreatRight);
        this.v_lc11_shoot = (leak * this.v_lc11_shoot) + driveShoot;

        // Motor Output Decision Logic
        const moveThreshold = 0.6;
        this.motorSignals.moveLeft = this.v_left > this.v_right && this.v_left > moveThreshold;
        this.motorSignals.moveRight = this.v_right > this.v_left && this.v_right > moveThreshold;
        
        // Shoot command when overhead target detected or aligned
        this.motorSignals.shoot = this.v_lc11_shoot > 0.6 || (Math.random() < 0.35 && Math.abs(targetDiffX) < 4.0);
    }

    /**
     * Mutates weights for evolutionary training.
     */
    mutate(rate = 0.15) {
        for (let key in this.weights) {
            if (Math.random() < rate) {
                this.weights[key] += (Math.random() * 0.4 - 0.2);
                if (key.startsWith('w_')) {
                    this.weights[key] = Math.max(0.1, Math.min(5.0, this.weights[key]));
                }
            }
        }
    }

    /**
     * Clones brain instance for genetic algorithm.
     */
    clone() {
        const newBrain = new ConnectomeBrain(this.gridSize);
        newBrain.weights = JSON.parse(JSON.stringify(this.weights));
        return newBrain;
    }
}
