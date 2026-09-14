"""
Automated Test Suite for Connectome-Driven Neural Simulation
Tests Modules 1 through 4 end-to-end.
"""

import os
import unittest
import numpy as np
import pandas as pd

from connectome_fetcher import ConnectomeFetcher
from visual_input import VisualInputPipeline
from neural_engine import NeuralMatrixEngine
from telemetry_visualizer import TelemetryVisualizer


class TestNeuralSimulation(unittest.TestCase):
    def setUp(self):
        self.test_csv = "test_lc4_matrix.csv"

    def tearDown(self):
        if os.path.exists(self.test_csv):
            os.remove(self.test_csv)

    def test_module1_connectome_fetcher(self):
        """Tests Module 1 matrix acquisition and CSV generation."""
        fetcher = ConnectomeFetcher(grid_size=32, target_type="LC4")
        df = fetcher.generate_synthetic_matrix()
        
        self.assertIsInstance(df, pd.DataFrame)
        self.assertGreater(len(df), 0)
        
        required_cols = {"source_id", "source_type", "target_id", "target_type", "weight", "nt", "spatial_x", "spatial_y"}
        self.assertTrue(required_cols.issubset(set(df.columns)))
        
        # Test CSV export
        saved_path = fetcher.save_matrix(df, output_path=self.test_csv)
        self.assertTrue(os.path.exists(saved_path))
        
        df_loaded = pd.read_csv(saved_path)
        self.assertEqual(len(df_loaded), len(df))

    def test_module2_visual_input(self):
        """Tests Module 2 frame acquisition, retinal downscaling, and motion extraction."""
        pipeline = VisualInputPipeline(source="synthetic", grid_size=32)
        
        raw_frame, ret_gray, motion = pipeline.read_frame()
        self.assertIsNotNone(raw_frame)
        self.assertEqual(ret_gray.shape, (32, 32))
        self.assertEqual(motion.shape, (32, 32))
        self.assertEqual(ret_gray.dtype, np.uint8)
        self.assertEqual(motion.dtype, np.float32)
        
        # Second frame should calculate motion diff
        raw_frame2, ret_gray2, motion2 = pipeline.read_frame()
        self.assertTrue(np.all(motion2 >= 0.0) and np.all(motion2 <= 1.0))
        
        pipeline.release()

    def test_module3_neural_engine(self):
        """Tests Module 3 polarity mapping, matrix multiplication, and thresholding."""
        mock_df = pd.DataFrame([
            {"spatial_x": 10, "spatial_y": 10, "weight": 10, "nt": "ACh"},   # Excitatory
            {"spatial_x": 20, "spatial_y": 20, "weight": 10, "nt": "GABA"}   # Inhibitory
        ])
        
        engine = NeuralMatrixEngine(mock_df, grid_size=32, activation_threshold=0.5, leak_factor=0.5)
        
        # Verify effective weight matrix values
        self.assertEqual(engine.effective_matrix[10, 10], 10.0)   # ACh = +1.0 * 10
        self.assertEqual(engine.effective_matrix[20, 20], -10.0)  # GABA = -1.0 * 10
        
        # Motion at excitatory pixel
        motion_exc = np.zeros((32, 32), dtype=np.float32)
        motion_exc[10, 10] = 1.0
        
        res1 = engine.step(motion_exc)
        self.assertGreater(res1["raw_current"], 0.0)
        self.assertGreater(res1["membrane_potential"], 0.0)

        # Engine reset
        engine.reset()
        self.assertEqual(engine.membrane_potential, 0.0)
        
        # Motion at inhibitory pixel
        motion_inh = np.zeros((32, 32), dtype=np.float32)
        motion_inh[20, 20] = 1.0
        
        res2 = engine.step(motion_inh)
        self.assertLess(res2["raw_current"], 0.0)
        self.assertEqual(res2["membrane_potential"], 0.0)  # Thresholded to 0

    def test_module4_telemetry(self):
        """Tests Module 4 telemetry initialization and update without GUI."""
        viz = TelemetryVisualizer(grid_size=32, target_neuron="LC4", enable_gui=False)
        
        ret_gray = np.zeros((32, 32), dtype=np.uint8)
        motion = np.zeros((32, 32), dtype=np.float32)
        state = {"membrane_potential": 12.5, "firing_intensity": 25.0, "raw_current": 10.0, "is_firing": True}
        
        # Should execute without errors
        viz.update_telemetry(None, ret_gray, motion, state)
        viz.close()


if __name__ == "__main__":
    unittest.main()
