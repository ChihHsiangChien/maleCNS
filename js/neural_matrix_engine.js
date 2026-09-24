/**
 * Module 3 Port: Multi-Channel Drosophila Connectome Neural Matrix Calculation Engine (HTML5/JS)
 *
 * Processes visual motion vectors through real neuPrint connectome matrices across 4 pathways:
 * 1. LC4 (Looming Obstacle Avoidance)
 * 2. LC11 (Small Target Motion Detector - STMD)
 * 3. HS (Yaw Directional Motion)
 * 4. VS (Pitch/Roll Directional Motion)
 *
 * Applies neurotransmitter polarity multipliers (ACh: +1.0, GABA: -1.0, Glu/His: -1.0),
 * aggregates cumulative membrane potentials (mV), leaky integration, and refractory action potential spikes (⚡ FIRE!).
 */

class MultiChannelNeuralEngine {
    static CHANNELS = ["LC4", "LC11", "HS", "VS"];

    constructor(gridSize = 32, activationThreshold = 0.5, leakFactor = 0.7, maxFiringPotential = 50.0) {
        this.gridSize = gridSize;
        this.numPixels = gridSize * gridSize;
        this.activationThreshold = activationThreshold;
        this.leakFactor = leakFactor;
        this.maxFiringPotential = maxFiringPotential;

        this.potentials = { LC4: 0.0, LC11: 0.0, HS: 0.0, VS: 0.0 };
        this.intensities = { LC4: 0.0, LC11: 0.0, HS: 0.0, VS: 0.0 };

        this.channelMatrices = {};
        this.isLoaded = false;
        this.synapseStats = { total: 0, ach: 0, gaba: 0 };

        this.channelGains = {
            "LC4": 1.0,   // Wide field looming avoidance gain
            "LC11": 8.0,  // Small target motion detector (high synaptic gain for 1-3 ommatidia pixels)
            "HS": 3.0,    // Horizontal optical flow gain
            "VS": 3.0     // Vertical optical flow gain
        };

        this.loadConnectomeData();
    }

    /**
     * Loads and parses lc4_connectome_matrix.csv and generates effective weight matrices.
     */
    async loadConnectomeData() {
        try {
            const response = await fetch('lc4_connectome_matrix.csv');
            if (response.ok) {
                const csvText = await response.text();
                this._parseAndBuildMatrices(csvText);
            } else {
                this._buildSyntheticBioMatrix();
            }
        } catch (err) {
            console.warn('[NeuralMatrixEngine] CSV fetch failed, synthesizing biological connectome matrices:', err);
            this._buildSyntheticBioMatrix();
        }
        this.isLoaded = true;
    }

    _parseAndBuildMatrices(csvText) {
        const lines = csvText.split('\n');
        if (lines.length < 2) {
            this._buildSyntheticBioMatrix();
            return;
        }

        const NT_POLARITY_MAP = {
            "ach": 1.0, "acetylcholine": 1.0,
            "gaba": -1.0, "glu": -1.0, "glutamate": -1.0,
            "his": -1.0, "histamine": -1.0
        };

        // Initialize weight and polarity arrays for each channel
        const wMats = {};
        const pMats = {};
        const counts = {};

        MultiChannelNeuralEngine.CHANNELS.forEach(ch => {
            wMats[ch] = new Float32Array(this.numPixels);
            pMats[ch] = new Float32Array(this.numPixels).fill(1.0);
            counts[ch] = 0;
        });

        let totalSyn = 0, achSyn = 0, gabaSyn = 0;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const cols = line.split(',');
            if (cols.length < 8) continue;

            const targetType = cols[3] || '';
            const weight = parseFloat(cols[4]) || 1.0;
            const nt = (cols[5] || 'ach').toLowerCase();
            const spatialX = Math.min(this.gridSize - 1, Math.max(0, parseInt(cols[6], 10) || 0));
            const spatialY = Math.min(this.gridSize - 1, Math.max(0, parseInt(cols[7], 10) || 0));
            const idx = spatialY * this.gridSize + spatialX;

            const polarity = NT_POLARITY_MAP[nt] !== undefined ? NT_POLARITY_MAP[nt] : 1.0;

            if (polarity > 0) achSyn++; else gabaSyn++;
            totalSyn++;

            // Route to channel based on pathway/target type
            let assignedChannel = "LC4";
            if (targetType.includes("LC11") || targetType.includes("STMD")) assignedChannel = "LC11";
            else if (targetType.includes("HS")) assignedChannel = "HS";
            else if (targetType.includes("VS")) assignedChannel = "VS";

            wMats[assignedChannel][idx] += weight;
            pMats[assignedChannel][idx] = polarity;
            counts[assignedChannel]++;
        }

        this.synapseStats = { total: totalSyn, ach: achSyn, gaba: gabaSyn };

        MultiChannelNeuralEngine.CHANNELS.forEach(ch => {
            const numConn = counts[ch];
            const scaleFactor = numConn > 500 ? (500.0 / numConn) : 1.0;
            const effMat = new Float32Array(this.numPixels);
            for (let k = 0; k < this.numPixels; k++) {
                effMat[k] = wMats[ch][k] * pMats[ch][k] * scaleFactor;
            }
            this.channelMatrices[ch] = effMat;
        });

        console.log(`[NeuralMatrixEngine] Loaded ${totalSyn} synapses from lc4_connectome_matrix.csv.`);
    }

    _buildSyntheticBioMatrix() {
        let totalSyn = 0, achSyn = 0, gabaSyn = 0;

        MultiChannelNeuralEngine.CHANNELS.forEach(ch => {
            const effMat = new Float32Array(this.numPixels);
            for (let y = 0; y < this.gridSize; y++) {
                for (let x = 0; x < this.gridSize; x++) {
                    const idx = y * this.gridSize + x;
                    const r = Math.random();
                    const pol = r < 0.65 ? 1.0 : -1.0;
                    if (pol > 0) achSyn++; else gabaSyn++;
                    totalSyn++;

                    // Center-weighted retinotopic layout
                    const distFromCenter = Math.sqrt((x - 16) ** 2 + (y - 16) ** 2);
                    const w = Math.max(0.1, (20 - distFromCenter) * 0.15) * (0.8 + Math.random() * 0.4);
                    effMat[idx] = w * pol;
                }
            }
            this.channelMatrices[ch] = effMat;
        });

        this.synapseStats = { total: totalSyn, ach: achSyn, gaba: gabaSyn };
        this.isLoaded = true;
    }

    /**
     * Executes one timestep of neural matrix calculation across LC4, LC11, HS, VS.
     * @param {Object} motionInput Output from OpticLobePipeline
     */
    step(motionInput) {
        const heatmaps = motionInput.heatmaps || {};
        const motionMapLC4 = motionInput.motionVector || new Float32Array(this.numPixels);
        const motionMapLC11 = heatmaps.T4_all || motionMapLC4;

        // HS Yaw: Right directional flow (T4a+T5a) vs Left (T4b+T5b)
        const motionMapHS = new Float32Array(this.numPixels);
        const t4a = heatmaps.T4a || new Float32Array(this.numPixels);
        const t5a = heatmaps.T5a || new Float32Array(this.numPixels);
        const t4b = heatmaps.T4b || new Float32Array(this.numPixels);
        const t5b = heatmaps.T5b || new Float32Array(this.numPixels);
        for (let i = 0; i < this.numPixels; i++) {
            motionMapHS[i] = Math.abs((t4a[i] + t5a[i]) - (t4b[i] + t5b[i]));
        }

        // VS Pitch/Roll: Up directional flow (T4c+T5c) vs Down (T4d+T5d)
        const motionMapVS = new Float32Array(this.numPixels);
        const t4c = heatmaps.T4c || new Float32Array(this.numPixels);
        const t5c = heatmaps.T5c || new Float32Array(this.numPixels);
        const t4d = heatmaps.T4d || new Float32Array(this.numPixels);
        const t5d = heatmaps.T5d || new Float32Array(this.numPixels);
        for (let i = 0; i < this.numPixels; i++) {
            motionMapVS[i] = Math.abs((t4c[i] + t5c[i]) - (t4d[i] + t5d[i]));
        }

        const channelMotionMaps = {
            "LC4": motionMapLC4,
            "LC11": motionMapLC11,
            "HS": motionMapHS,
            "VS": motionMapVS
        };

        const channelResults = {};

        MultiChannelNeuralEngine.CHANNELS.forEach(ch => {
            const effMat = this.channelMatrices[ch] || new Float32Array(this.numPixels);
            const mVector = channelMotionMaps[ch];
            const gain = this.channelGains[ch] || 1.0;

            let rawCurr = 0.0;
            for (let i = 0; i < this.numPixels; i++) {
                rawCurr += mVector[i] * effMat[i];
            }
            rawCurr *= gain;

            const netDrive = Math.max(0.0, rawCurr - this.activationThreshold);
            this.potentials[ch] = (this.leakFactor * this.potentials[ch]) + netDrive;

            // Biological Spike Action Potential Threshold (75% of max firing potential = 37.5 mV)
            const isFiring = this.potentials[ch] >= (this.maxFiringPotential * 0.75);
            if (isFiring) {
                // Refractory decay after action potential spike
                this.potentials[ch] *= 0.25;
            }

            const intensity = Math.min(100.0, (this.potentials[ch] / this.maxFiringPotential) * 100.0);
            this.intensities[ch] = intensity;

            const spatialMap = new Float32Array(this.numPixels);
            for (let i = 0; i < this.numPixels; i++) {
                spatialMap[i] = Math.min(1.0, Math.max(0.0, mVector[i] * effMat[i] * gain));
            }

            channelResults[ch] = {
                rawCurrent: rawCurr,
                membranePotential: this.potentials[ch],
                firingIntensity: intensity,
                isFiring: isFiring,
                spatialMap: spatialMap
            };
        });

        return {
            rawCurrent: channelResults["LC4"].rawCurrent,
            membranePotential: this.potentials["LC4"].membranePotential,
            firingIntensity: this.intensities["LC4"],
            isFiring: channelResults["LC4"].isFiring,
            channels: channelResults,
            channelMotionMaps: channelMotionMaps
        };
    }

    reset() {
        MultiChannelNeuralEngine.CHANNELS.forEach(ch => {
            this.potentials[ch] = 0.0;
            this.intensities[ch] = 0.0;
        });
    }
}
