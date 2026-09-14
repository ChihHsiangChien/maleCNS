"""
Module 3: Neural Matrix Calculation Engine

Processes visual motion vectors through the connectome matrix,
applies neurotransmitter polarity multipliers (ACh: +1.0, GABA: -1.0),
aggregates cumulative membrane potential changes, and applies an activation threshold filter.
"""

import numpy as np
import pandas as pd
import logging

logger = logging.getLogger("NeuralEngine")


class NeuralMatrixEngine:
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
        
        self.membrane_potential = 0.0
        self.firing_intensity = 0.0
        
        self._build_weight_and_polarity_matrices(connectome_df)

    def _build_weight_and_polarity_matrices(self, df: pd.DataFrame):
        """
        Constructs dense (grid_size, grid_size) weight and polarity maps from connectome dataframe.
        """
        self.weight_matrix = np.zeros((self.grid_size, self.grid_size), dtype=np.float32)
        self.polarity_matrix = np.ones((self.grid_size, self.grid_size), dtype=np.float32)
        
        # Neurotransmitter Polarity Mapping
        # Acetylcholine (ACh): +1.0 (Excitatory)
        # GABA / Glutamate: -1.0 (Inhibitory)
        NT_POLARITY_MAP = {
            "ach": 1.0,
            "acetylcholine": 1.0,
            "gaba": -1.0,
            "glu": -1.0,
            "glutamate": -1.0,
            "his": -1.0,
            "histamine": -1.0,
            "unknown": 1.0
        }

        for _, row in df.iterrows():
            x = int(row.get('spatial_x', 0)) % self.grid_size
            y = int(row.get('spatial_y', 0)) % self.grid_size
            weight = float(row.get('weight', 1.0))
            nt = str(row.get('nt', 'ACh')).strip().lower()
            
            polarity = NT_POLARITY_MAP.get(nt, 1.0)
            
            self.weight_matrix[y, x] += weight
            self.polarity_matrix[y, x] = polarity

        # Scale normalization: Normalizes large real connectomes (> 500 connections) so total current remains stable
        num_connections = len(df)
        if num_connections > 500:
            scale_factor = 500.0 / float(num_connections)
        else:
            scale_factor = 1.0
        
        self.effective_matrix = (self.weight_matrix * self.polarity_matrix) * scale_factor
        logger.info(
            f"Built neural weight matrix (Raw sum: {self.weight_matrix.sum():.1f}, "
            f"Normalized scale: {scale_factor:.4f}, "
            f"Pos/Neg ratio: {(self.polarity_matrix > 0).sum()}/{(self.polarity_matrix < 0).sum()})"
        )

    def step(self, motion_vector: np.ndarray) -> dict:
        """
        Executes one timestep of neural matrix calculation with biological refractory period reset.
        """
        if motion_vector.shape != (self.grid_size, self.grid_size):
            raise ValueError(
                f"Motion vector shape {motion_vector.shape} does not match engine grid ({self.grid_size}, {self.grid_size})"
            )

        # 1. Synaptic Current Calculation: Dot product of motion vector & normalized weights
        raw_current = float(np.sum(motion_vector * self.effective_matrix))

        # 2. Leaky Temporal Integration & Threshold Filter
        net_drive = raw_current - self.activation_threshold
        if net_drive < 0:
            net_drive = 0.0
            
        self.membrane_potential = (self.leak_factor * self.membrane_potential) + net_drive

        # 3. Refractory Period Reset & Spike Adaptation (不應期與動作電位重置)
        # When neuron fires an action potential (> 80% intensity), hyperpolarize / reset membrane potential
        is_firing = self.membrane_potential >= self.max_firing_potential * 0.4
        
        if is_firing:
            # Post-spike refractory drainage (K+ potassium channel repolarization)
            self.membrane_potential *= 0.35

        # 4. Firing Intensity Normalization (0% - 100%)
        self.firing_intensity = min(100.0, (self.membrane_potential / self.max_firing_potential) * 100.0)

        return {
            "raw_current": raw_current,
            "membrane_potential": self.membrane_potential,
            "firing_intensity": self.firing_intensity,
            "is_firing": is_firing
        }

    def reset(self):
        """Resets membrane potential state."""
        self.membrane_potential = 0.0
        self.firing_intensity = 0.0


if __name__ == "__main__":
    # Test stub
    dummy_df = pd.DataFrame([
        {"spatial_x": 10, "spatial_y": 10, "weight": 20, "nt": "ACh"},
        {"spatial_x": 15, "spatial_y": 15, "weight": 10, "nt": "GABA"}
    ])
    engine = NeuralMatrixEngine(dummy_df, grid_size=32)
    motion = np.zeros((32, 32), dtype=np.float32)
    motion[10, 10] = 0.8  # Motion at cholinergic center
    result = engine.step(motion)
    print("Test Neural Step Result:", result)
