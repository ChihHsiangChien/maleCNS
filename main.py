"""
Connectome-Driven Neural Simulation Spec: Acquisition to Visualization

CLI Entrypoint integrating Modules 1 to 4:
1. Module 1: Automated Matrix Acquisition (neuPrint API / synthetic fallback)
2. Module 2: Visual Input & Preprocessing Pipeline (retinal downscaling & motion diff)
3. Module 3: Neural Matrix Calculation Engine (polarity mapping, matrix dot product, thresholding)
4. Module 4: Real-Time Visualization & Telemetry (terminal character progress bar & OpenCV GUI)
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
        description="Connectome-Driven Neural Simulation (neuPrint -> Visual Input -> Matrix Engine -> Telemetry)"
    )
    # Module 1 Args
    parser.add_argument("--server", type=str, default="https://neuprint.janelia.org", help="neuPrint server endpoint")
    parser.add_argument("--dataset", type=str, default="male-cns:v1.0", help="neuPrint target dataset")
    parser.add_argument("--token", type=str, default=os.getenv("NEUPRINT_APPLICATION_TOKEN", ""), help="neuPrint application API token")
    parser.add_argument("--target", type=str, default="LC4", help="Target neuron type to simulate")
    parser.add_argument("--synthetic", action="store_true", help="Force synthetic connectome matrix mode")
    parser.add_argument("--fetch", action="store_true", help="Force re-fetching from neuPrint API even if matrix CSV exists")
    parser.add_argument("--matrix-file", type=str, default="lc4_connectome_matrix.csv", help="Path to save/load CSV matrix")

    # Module 2 Args
    parser.add_argument("--source", type=str, default="synthetic", help="Visual source: '0' for webcam, path to video file, or 'synthetic'")
    parser.add_argument("--grid-size", type=int, default=32, help="Retinal downscaling grid resolution (N x N)")
    parser.add_argument("--fps", type=int, default=30, help="Target framerate")

    # Module 3 Args
    parser.add_argument("--threshold", type=float, default=0.5, help="Activation noise threshold")
    parser.add_argument("--leak", type=float, default=0.7, help="Leaky temporal integration factor (0.0 to 1.0)")

    # Module 4 Args
    parser.add_argument("--no-gui", action="store_true", help="Disable OpenCV visual preview window")
    parser.add_argument("--max-frames", type=int, default=0, help="Stop after N frames (0 = run indefinitely until Ctrl+C)")

    return parser.parse_args()


def main():
    args = parse_args()

    print("\n=======================================================")
    print("      CONNECTOME-DRIVEN NEURAL SIMULATION PIPELINE      ")
    print("=======================================================\n")

    # ----------------------------------------------------
    # Module 1: Connectome Matrix Acquisition
    # ----------------------------------------------------
    logger.info("=== MODULE 1: Automated Matrix Acquisition ===")
    
    # Check if local cached matrix exists, and fetch is not explicitly forced
    should_fetch = args.fetch or (args.token and not os.path.exists(args.matrix_file))
    
    if os.path.exists(args.matrix_file) and not should_fetch and not args.synthetic:
        logger.info(f"Found existing matrix file: {args.matrix_file}. Loading cached matrix...")
        connectome_df = pd.read_csv(args.matrix_file)
    else:
        fetcher = ConnectomeFetcher(
            server=args.server,
            dataset=args.dataset,
            token=args.token,
            target_type=args.target,
            grid_size=args.grid_size
        )
        if args.synthetic:
            connectome_df = fetcher.generate_synthetic_matrix()
        else:
            connectome_df = fetcher.fetch_from_neuprint()
        
        fetcher.save_matrix(connectome_df, output_path=args.matrix_file)

    logger.info(f"Loaded {len(connectome_df)} synaptic matrix records.")

    # ----------------------------------------------------
    # Module 2: Visual Input & Preprocessing Pipeline
    # ----------------------------------------------------
    logger.info("=== MODULE 2: Visual Input & Preprocessing ===")
    visual_pipeline = VisualInputPipeline(
        source=args.source,
        grid_size=args.grid_size,
        target_fps=args.fps
    )

    # ----------------------------------------------------
    # Module 3: Neural Matrix Calculation Engine
    # ----------------------------------------------------
    logger.info("=== MODULE 3: Neural Matrix Calculation Engine ===")
    neural_engine = NeuralMatrixEngine(
        connectome_df=connectome_df,
        grid_size=args.grid_size,
        activation_threshold=args.threshold,
        leak_factor=args.leak
    )

    # ----------------------------------------------------
    # Module 4: Real-Time Visualization & Telemetry
    # ----------------------------------------------------
    logger.info("=== MODULE 4: Real-Time Visualization & Telemetry ===")
    visualizer = TelemetryVisualizer(
        grid_size=args.grid_size,
        target_neuron=args.target,
        enable_gui=not args.no_gui
    )

    logger.info("Starting simulation loop. Press Ctrl+C in terminal or 'q' in OpenCV window to quit.\n")
    frame_count = 0
    target_dt = 1.0 / args.fps if args.fps > 0 else 0.033

    try:
        while True:
            start_t = time.time()
            
            # Step 1: Read frame & downscale & compute motion vector
            raw_frame, retinal_gray, motion_vector = visual_pipeline.read_frame()

            # Step 2: Compute neural response matrix update
            neural_state = neural_engine.step(motion_vector)

            # Step 3: Render telemetry & debug preview
            visualizer.update_telemetry(raw_frame, retinal_gray, motion_vector, neural_state)

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
