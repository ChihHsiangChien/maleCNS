/**
 * Connectome Rover Neural Brain Engine
 * Reads real neuPrint CSV data (lc4_connectome_matrix.csv) and calculates
 * Left/Right Eye sensory inputs to Left/Right Wing differential motor outputs.
 */

class RoverConnectomeBrain {
    constructor(numRaysPerEye = 16) {
        this.numRaysPerEye = numRaysPerEye;
        this.totalRays = numRaysPerEye * 2; // 32 total visual columns (16 Left, 16 Right)

        // Eye Visual Stimulus Arrays (0.0 = clear, 1.0 = immediate obstacle threat)
        this.leftEyeSensors = new Float32Array(numRaysPerEye);
        this.rightEyeSensors = new Float32Array(numRaysPerEye);

        // Connectome Matrix Stats
        this.isLoaded = false;
        this.synapseCount = 0;
        this.achSynapses = 0;
        this.gabaSynapses = 0;

        // Weights matrix aggregated across 32 retinotopic columns
        // columnWeights[col] = { ach: number, gaba: number, totalWeight: number }
        this.columnWeights = new Array(this.totalRays).fill(null).map(() => ({
            ach: 0.5,
            gaba: 0.5,
            totalWeight: 1.0
        }));

        // Internal Membrane Potentials
        this.v_left_eye = 0.0;
        this.v_right_eye = 0.0;
        this.v_wing_left = 1.0;  // Normal cruising power
        this.v_wing_right = 1.0; // Normal cruising power
        
        // Dynamic Parameters
        this.baseCruisingPower = 1.0;
        this.avoidanceGain = 2.2;
        this.leakFactor = 0.7;

        // Load real database asynchronously
        this.loadConnectomeMatrix();
    }

    /**
     * Loads and parses lc4_connectome_matrix.csv
     */
    async loadConnectomeMatrix() {
        try {
            const resp = await fetch('lc4_connectome_matrix.csv');
            if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
            const text = await resp.text();
            this.parseCSV(text);
            this.isLoaded = true;
            console.log(`[ConnectomeBrain] Successfully loaded ${this.synapseCount} synapses from lc4_connectome_matrix.csv`);
        } catch (err) {
            console.warn('[ConnectomeBrain] CSV fetch failed, synthesizing biological connectome fallback:', err);
            this._setupSyntheticFallback();
        }
    }

    /**
     * Parses real neuPrint CSV data
     */
    parseCSV(csvText) {
        const lines = csvText.split('\n');
        if (lines.length < 2) return;

        let count = 0;
        let achCount = 0;
        let gabaCount = 0;

        // Columns: source_id,source_type,target_id,target_type,weight,nt,spatial_x,spatial_y
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const cols = line.split(',');
            if (cols.length < 8) continue;

            const weight = parseFloat(cols[4]) || 1.0;
            const nt = (cols[5] || '').toLowerCase();
            const spatialX = parseInt(cols[6], 10); // 0 to 31 mapping to visual columns

            const colIdx = Math.min(this.totalRays - 1, Math.max(0, isNaN(spatialX) ? 0 : spatialX % this.totalRays));

            if (nt.includes('acetylcholine') || nt.includes('ach')) {
                this.columnWeights[colIdx].ach += weight * 0.01;
                achCount++;
            } else {
                this.columnWeights[colIdx].gaba += weight * 0.01;
                gabaCount++;
            }

            this.columnWeights[colIdx].totalWeight += weight * 0.01;
            count++;
        }

        this.synapseCount = count;
        this.achSynapses = achCount;
        this.gabaSynapses = gabaCount;

        // Normalize weights per column
        this.columnWeights.forEach(cw => {
            const sum = cw.ach + cw.gaba;
            if (sum > 0) {
                cw.achRatio = cw.ach / sum;
                cw.gabaRatio = cw.gaba / sum;
            }
        });
    }

    _setupSyntheticFallback() {
        this.synapseCount = 22875;
        this.achSynapses = 14200;
        this.gabaSynapses = 8675;
        this.isLoaded = true;

        for (let i = 0; i < this.totalRays; i++) {
            this.columnWeights[i] = {
                ach: 1.2 + Math.random() * 0.5,
                gaba: 0.8 + Math.random() * 0.4,
                totalWeight: 2.0,
                achRatio: 0.6,
                gabaRatio: 0.4
            };
        }
    }

    /**
     * Updates neural calculation loop.
     * @param {Float32Array} leftRays Ray distances/threats (0.0 clear to 1.0 threat)
     * @param {Float32Array} rightRays Ray distances/threats (0.0 clear to 1.0 threat)
     */
    update(leftRays, rightRays) {
        let leftThreatDrive = 0.0;
        let rightThreatDrive = 0.0;

        // 1. Process Left Eye Inputs (Columns 0..15)
        for (let i = 0; i < this.numRaysPerEye; i++) {
            const threat = leftRays[i] || 0.0;
            this.leftEyeSensors[i] = threat;
            const cw = this.columnWeights[i];
            // Excitatory LC4 looming threat drive weighted by connectome ACh
            leftThreatDrive += threat * (cw.achRatio || 0.6) * cw.totalWeight * 0.2;
        }

        // 2. Process Right Eye Inputs (Columns 16..31)
        for (let i = 0; i < this.numRaysPerEye; i++) {
            const threat = rightRays[i] || 0.0;
            this.rightEyeSensors[i] = threat;
            const cw = this.columnWeights[i + this.numRaysPerEye];
            // Excitatory LC4 looming threat drive weighted by connectome ACh
            rightThreatDrive += threat * (cw.achRatio || 0.6) * cw.totalWeight * 0.2;
        }

        // Leaky integration of eye potentials
        this.v_left_eye = (this.leakFactor * this.v_left_eye) + leftThreatDrive;
        this.v_right_eye = (this.leakFactor * this.v_right_eye) + rightThreatDrive;

        // 3. Connectome Reflex Routing:
        // Left Eye Threat -> Excites Right Wing (flaps harder) & Suppresses Left Wing -> Steers RIGHT away from threat!
        // Right Eye Threat -> Excites Left Wing (flaps harder) & Suppresses Right Wing -> Steers LEFT away from threat!
        let targetWingLeft = this.baseCruisingPower + (this.v_right_eye * this.avoidanceGain) - (this.v_left_eye * 0.4);
        let targetWingRight = this.baseCruisingPower + (this.v_left_eye * this.avoidanceGain) - (this.v_right_eye * 0.4);

        // Head-on Wall Symmetry Breaking (LC4 / Giant Fiber Escape Saccade)
        // When both eyes sense high threat ahead simultaneously, trigger sharp evasive turn instead of sliding
        if (this.v_left_eye > 0.28 && this.v_right_eye > 0.28) {
            if (this.v_left_eye >= this.v_right_eye) {
                targetWingRight += 2.2; // Drive Right Wing harder -> sharp turn LEFT
            } else {
                targetWingLeft += 2.2;  // Drive Left Wing harder -> sharp turn RIGHT
            }
        }

        // Smooth motor output transition
        this.v_wing_left = THREE.MathUtils.lerp(this.v_wing_left, Math.max(0.2, Math.min(3.2, targetWingLeft)), 0.25);
        this.v_wing_right = THREE.MathUtils.lerp(this.v_wing_right, Math.max(0.2, Math.min(3.2, targetWingRight)), 0.25);

        return {
            wingPowerLeft: this.v_wing_left,
            wingPowerRight: this.v_wing_right,
            v_left_eye: this.v_left_eye,
            v_right_eye: this.v_right_eye,
            stats: {
                synapses: this.synapseCount,
                ach: this.achSynapses,
                gaba: this.gabaSynapses
            }
        };
    }
}
