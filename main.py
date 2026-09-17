"""
Connectome-Driven Neural Simulation Spec: Acquisition to Visualization

CLI Entrypoint integrating Modules 1 to 4:
1. Module 1: Automated Top-Down Matrix Acquisition (neuPrint Cypher 3-4 layers reverse tracing & NetworkX Graph Merge)
2. Module 2: Visual Input & Preprocessing Pipeline (retinal downscaling & motion diff)
3. Module 3: Multi-Channel Neural Matrix Calculation Engine (LC4, LC11, HS, VS)
4. Module 4: Real-Time Visualization & Multi-Channel Telemetry (Terminal progress bar & OpenCV GUI)
"""

import os
import sys
import time
import argparse
import logging
import pandas as pd

from connectome_fetcher import ConnectomeFetcher
from visual_input import VisualInputPipeline
from neural_engine import NeuralMatrixEngine
from telemetry_visualizer import TelemetryVisualizer

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s - %(message)s")
logger = logging.getLogger("NeuralSimulation")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Top-Down Connectome-Driven Multi-Channel Neural Simulation (LC4, LC11, HS, VS)"
    )
    # Module 1 Args
    parser.add_argument("--server", type=str, default="https://neuprint.janelia.org", help="neuPrint server endpoint")
    parser.add_argument("--dataset", type=str, default="male-cns:v1.0", help="neuPrint target dataset")
    parser.add_argument("--token", type=str, default=os.getenv("NEUPRINT_APPLICATION_TOKEN", ""), help="neuPrint application API token")
    parser.add_argument("--target", type=str, default="MultiChannel", help="Target neuron system mode (LC4, LC11, HS, VS)")
    parser.add_argument("--synthetic", action="store_true", help="Force synthetic connectome matrix mode")
    parser.add_argument("--fetch", action="store_true", help="Force re-fetching from neuPrint API even if matrix CSV exists")
    parser.add_argument("--matrix-file", type=str, default="lc4_connectome_matrix.csv", help="Path to save/load CSV matrix")

    # Module 2 Args
    parser.add_argument("--source", type=str, default="synthetic", help="Visual source: '0' for webcam, path to video file, or 'synthetic'")
    parser.add_argument("--stimulus", type=str, default="auto", choices=["auto", "stmd_dot", "yaw_sweep", "pitch_sweep", "looming"], help="Standard benchmark stimulus mode for testing LC11, HS, VS, LC4")
    parser.add_argument("--grid-size", type=int, default=32, help="Retinal downscaling grid resolution (N x N)")
    parser.add_argument("--fps", type=int, default=30, help="Target framerate")

    # Module 3 Args
    parser.add_argument("--threshold", type=float, default=1.5, help="Activation noise threshold")
    parser.add_argument("--leak", type=float, default=0.7, help="Leaky temporal integration factor (0.0 to 1.0)")

    # Module 4 Args
    parser.add_argument("--no-gui", action="store_true", help="Disable OpenCV visual preview window")
    parser.add_argument("--max-frames", type=int, default=0, help="Stop after N frames (0 = run indefinitely until Ctrl+C)")

    return parser.parse_args()


def main():
    args = parse_args()

    print("\n=======================================================")
    print("  TOP-DOWN CONNECTOME NEURAL SIMULATION PIPELINE (4CH) ")
    print("=======================================================\n")

    # ----------------------------------------------------
    # Module 1: Automated Top-Down Connectome Acquisition
    # ----------------------------------------------------
    logger.info("=== MODULE 1: Top-Down Acquisition & NetworkX Merging ===")
    
    should_fetch = args.fetch or (args.token and not os.path.exists(args.matrix_file))
    
    if os.path.exists(args.matrix_file) and not should_fetch and not args.synthetic:
        logger.info(f"Found existing matrix file: {args.matrix_file}. Loading cached matrix...")
        connectome_df = pd.read_csv(args.matrix_file)
    else:
        fetcher = ConnectomeFetcher(
            server=args.server,
            dataset=args.dataset,
            token=args.token,
            grid_size=args.grid_size
        )
        if args.synthetic or not args.token:
            connectome_df = fetcher.generate_multichannel_synthetic_matrix()
        else:
            connectome_df = fetcher.fetch_top_down_multichannel_connectome()
        
        fetcher.save_matrix(connectome_df, output_path=args.matrix_file)

    logger.info(f"Loaded {len(connectome_df)} synaptic matrix records across LC4, LC11, HS, VS pathways.")

    # ----------------------------------------------------
    # Module 2: Visual Input & Preprocessing Pipeline
    # ----------------------------------------------------
    logger.info("=== MODULE 2: Visual Input & Preprocessing ===")
    visual_pipeline = VisualInputPipeline(
        source=args.source,
        grid_size=args.grid_size,
        target_fps=args.fps,
        stimulus_mode=args.stimulus
    )

    # ----------------------------------------------------
    # Module 3: Multi-Channel Neural Engine
    # ----------------------------------------------------
    logger.info("=== MODULE 3: Multi-Channel Neural Calculation Engine ===")
    neural_engine = NeuralMatrixEngine(
        connectome_df=connectome_df,
        grid_size=args.grid_size,
        activation_threshold=args.threshold,
        leak_factor=args.leak
    )

    # ----------------------------------------------------
    # Module 4: Real-Time Multi-Channel Visualization
    # ----------------------------------------------------
    logger.info("=== MODULE 4: Real-Time Visualization & Telemetry ===")
    visualizer = TelemetryVisualizer(
        grid_size=args.grid_size,
        target_neuron="MultiChannel (LC4/LC11/HS/VS)",
        enable_gui=not args.no_gui
    )

    logger.info("Starting simulation loop. Press Ctrl+C in terminal or 'q' in OpenCV window to quit.\n")
    frame_count = 0
    target_dt = 1.0 / args.fps if args.fps > 0 else 0.033

    try:
        while True:
            start_t = time.time()
            
            # Step 1: Read frame, split ON/OFF channels, compute delay buffers & Reichardt motion
            raw_frame, retinal_gray, motion_vector, heatmaps = visual_pipeline.read_frame()

            # Step 2: Compute multi-channel neural matrix drive using directional heatmaps
            neural_state = neural_engine.step(heatmaps)

            # Step 3: Render multi-channel telemetry & interactive OpenCV heatmap view
            visualizer.update_telemetry(raw_frame, retinal_gray, motion_vector, neural_state, heatmaps)

            frame_count += 1
            if args.max_frames > 0 and frame_count >= args.max_frames:
                logger.info(f"\nReached max frame limit ({args.max_frames}). Stopping simulation.")
                break

            # Frame rate throttle
            elapsed = time.time() - start_t
            if elapsed < target_dt:
                time.sleep(target_dt - elapsed)

    except KeyboardInterrupt:
        logger.info("\nSimulation interrupted by user.")
    finally:
        visual_pipeline.release()
        visualizer.close()
        print("\nSimulation shutdown complete.")


if __name__ == "__main__":
    main()
