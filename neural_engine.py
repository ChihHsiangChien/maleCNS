"""
Module 3: Multi-Channel Neural Matrix Calculation Engine

Processes visual motion vectors through the merged connectome matrix across 4 pathways:
1. LC4 (Looming Obstacle Avoidance)
2. LC11 (Small Target Tracking)
3. HS (Yaw Directional Motion)
4. VS (Pitch/Roll Directional Motion)

Applies neurotransmitter polarity multipliers (ACh: +1.0, GABA: -1.0),
aggregates cumulative membrane potential changes, and applies refractory period filters.
"""

import numpy as np
import pandas as pd
import logging

logger = logging.getLogger("NeuralEngine")


class NeuralMatrixEngine:
    CHANNELS = ["LC4", "LC11", "HS", "VS"]

    def __init__(
        self,
        connectome_df: pd.DataFrame,
        grid_size: int = 32,
        activation_threshold: float = 0.5,
        leak_factor: float = 0.7,
        max_firing_potential: float = 50.0,
    ):
        self.grid_size = grid_size
        self.activation_threshold = activation_threshold
        self.leak_factor = leak_factor
        self.max_firing_potential = max_firing_potential

        self.potentials = {ch: 0.0 for ch in self.CHANNELS}
        self.intensities = {ch: 0.0 for ch in self.CHANNELS}

        # Legacy compatibility properties
        self.membrane_potential = 0.0
        self.firing_intensity = 0.0

        self._build_multichannel_weight_matrices(connectome_df)

    def _build_multichannel_weight_matrices(self, df: pd.DataFrame):
        """Constructs separate effective weight matrices for LC4, LC11, HS, and VS."""
        NT_POLARITY_MAP = {
            "ach": 1.0, "acetylcholine": 1.0,
            "gaba": -1.0, "glu": -1.0, "glutamate": -1.0,
            "his": -1.0, "histamine": -1.0, "unknown": 1.0
        }

        self.channel_matrices = {}

        for ch in self.CHANNELS:
            w_mat = np.zeros((self.grid_size, self.grid_size), dtype=np.float32)
            p_mat = np.ones((self.grid_size, self.grid_size), dtype=np.float32)

            ch_df = df if 'pathway' not in df.columns else df[df['pathway'] == ch]
            if len(ch_df) == 0:
                ch_df = df  # Fallback to full df if pathway column is missing

            for _, row in ch_df.iterrows():
                x = int(row.get('spatial_x', 0)) % self.grid_size
                y = int(row.get('spatial_y', 0)) % self.grid_size
                weight = float(row.get('weight', 1.0))
                nt = str(row.get('nt', 'ACh')).strip().lower()
                polarity = NT_POLARITY_MAP.get(nt, 1.0)

                w_mat[y, x] += weight
                p_mat[y, x] = polarity

            num_conn = len(ch_df)
            scale_factor = 500.0 / float(num_conn) if num_conn > 500 else 1.0
            self.channel_matrices[ch] = (w_mat * p_mat) * scale_factor

        self.effective_matrix = self.channel_matrices["LC4"]
        logger.info(f"Built multi-channel neural weight matrices for {self.CHANNELS}.")

    def step(self, motion_input) -> dict:
        """Executes one timestep of neural matrix calculation across all 4 channels using directional heatmaps if provided."""
        if isinstance(motion_input, dict):
            heatmaps = motion_input
            motion_map_lc4 = heatmaps.get("motion_vector", np.zeros((self.grid_size, self.grid_size), dtype=np.float32))
            motion_map_lc11 = heatmaps.get("T4_all", motion_map_lc4)
            # HS Yaw: Right directional flow (T4a+T5a) vs Left (T4b+T5b)
            motion_map_hs = np.abs((heatmaps.get("T4a", 0) + heatmaps.get("T5a", 0)) - (heatmaps.get("T4b", 0) + heatmaps.get("T5b", 0)))
            # VS Pitch/Roll: Up directional flow (T4c+T5c) vs Down (T4d+T5d)
            motion_map_vs = np.abs((heatmaps.get("T4c", 0) + heatmaps.get("T5c", 0)) - (heatmaps.get("T4d", 0) + heatmaps.get("T5d", 0)))

            channel_motion_maps = {
                "LC4": motion_map_lc4,
                "LC11": motion_map_lc11,
                "HS": motion_map_hs,
                "VS": motion_map_vs
            }
        else:
            if motion_input.shape != (self.grid_size, self.grid_size):
                raise ValueError(f"Motion vector shape {motion_input.shape} does not match grid ({self.grid_size}, {self.grid_size})")
            channel_motion_maps = {ch: motion_input for ch in self.CHANNELS}

        CHANNEL_GAINS = {
            "LC4": 1.0,   # Wide field looming
            "LC11": 8.0,  # Small target motion detector (high synaptic gain for 1-3 ommatidia pixels)
            "HS": 3.0,    # Horizontal optical flow gain
            "VS": 3.0     # Vertical optical flow gain
        }

        channel_results = {}

        for ch in self.CHANNELS:
            eff_mat = self.channel_matrices[ch]
            m_vector = channel_motion_maps[ch]
            gain = CHANNEL_GAINS.get(ch, 1.0)
            raw_curr = float(np.sum(m_vector * eff_mat)) * gain

            net_drive = max(0.0, raw_curr - self.activation_threshold)
            self.potentials[ch] = (self.leak_factor * self.potentials[ch]) + net_drive

            # Biological Spike Action Potential Threshold (75% of max firing potential = 37.5 mV)
            is_firing = self.potentials[ch] >= self.max_firing_potential * 0.75
            if is_firing:
                self.potentials[ch] *= 0.25

            intensity = min(100.0, (self.potentials[ch] / self.max_firing_potential) * 100.0)
            self.intensities[ch] = intensity

            spatial_map = np.clip(m_vector * eff_mat * gain, 0.0, 1.0)
            channel_results[ch] = {
                "raw_current": raw_curr,
                "membrane_potential": self.potentials[ch],
                "firing_intensity": intensity,
                "is_firing": is_firing,
                "spatial_map": spatial_map
            }

        # Legacy backward compatibility mappings
        self.membrane_potential = self.potentials["LC4"]
        self.firing_intensity = self.intensities["LC4"]

        return {
            "raw_current": channel_results["LC4"]["raw_current"],
            "membrane_potential": self.potentials["LC4"],
            "firing_intensity": self.intensities["LC4"],
            "is_firing": channel_results["LC4"]["is_firing"],
            "channels": channel_results,
            "channel_motion_maps": channel_motion_maps
        }

    def reset(self):
        """Resets all membrane potentials."""
        self.potentials = {ch: 0.0 for ch in self.CHANNELS}
        self.intensities = {ch: 0.0 for ch in self.CHANNELS}
        self.membrane_potential = 0.0
        self.firing_intensity = 0.0


if __name__ == "__main__":
    dummy_df = pd.DataFrame([
        {"spatial_x": 10, "spatial_y": 10, "weight": 20, "nt": "ACh", "pathway": "LC4"},
        {"spatial_x": 5, "spatial_y": 5, "weight": 25, "nt": "ACh", "pathway": "LC11"},
    ])
    engine = NeuralMatrixEngine(dummy_df, grid_size=32)
    motion = np.zeros((32, 32), dtype=np.float32)
    motion[10, 10] = 0.8
    result = engine.step(motion)
    print("Multi-channel Neural Step Result:", result)
