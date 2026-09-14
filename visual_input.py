"""
Module 2: Visual Input & Preprocessing Pipeline

Captures real-time visual feed (webcam, video file, or synthetic stimulus),
downscales to a low-resolution retinal matrix (e.g. 32x32 ommatidia),
and extracts absolute frame-to-frame motion vectors.
"""

import time
import math
import cv2
import numpy as np
import logging

logger = logging.getLogger("VisualInputPipeline")


class VisualInputPipeline:
    def __init__(
        self,
        source: str = "0",  # "0" for webcam, path for file, "synthetic" for simulated stimulus
        grid_size: int = 32,
        target_fps: int = 30,
    ):
        self.grid_size = grid_size
        self.target_fps = target_fps
        self.source = source
        self.cap = None
        self.prev_gray = None
        self.frame_counter = 0

        self._init_source()

    def _init_source(self):
        """Initializes video capture device or synthetic frame generator."""
        if str(self.source).strip().lower() == "synthetic":
            logger.info("VisualInputPipeline initialized in SYNTHETIC motion mode.")
            self.cap = None
        else:
            try:
                # If numeric string, convert to int (webcam index)
                src_val = int(self.source) if str(self.source).isdigit() else self.source
                self.cap = cv2.VideoCapture(src_val)
                if not self.cap.isOpened():
                    logger.warning(f"Could not open video source '{self.source}'. Switching to SYNTHETIC mode.")
                    self.cap = None
                else:
                    logger.info(f"VisualInputPipeline initialized with video source: '{self.source}'")
            except Exception as e:
                logger.warning(f"Error initializing camera '{self.source}': {e}. Switching to SYNTHETIC mode.")
                self.cap = None

    def read_frame(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Reads next frame, downscales to grid_size x grid_size, and computes motion.
        
        Returns:
            (raw_frame, downscaled_gray, motion_vector)
            - raw_frame: BGR image (original size)
            - downscaled_gray: (grid_size, grid_size) uint8 grayscale retinal frame
            - motion_vector: (grid_size, grid_size) float32 normalized motion intensity [0.0, 1.0]
        """
        self.frame_counter += 1
        
        if self.cap is not None and self.cap.isOpened():
            ret, raw_frame = self.cap.read()
            if not ret or raw_frame is None:
                # Restart video loop or generate fallback
                self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                ret, raw_frame = self.cap.read()
                if not ret or raw_frame is None:
                    raw_frame = self._generate_synthetic_frame()
        else:
            raw_frame = self._generate_synthetic_frame()

        # 1. Grayscale Conversion
        if len(raw_frame.shape) == 3:
            gray_full = cv2.cvtColor(raw_frame, cv2.COLOR_BGR2GRAY)
        else:
            gray_full = raw_frame

        # 2. Retinal Downscaling to (grid_size x grid_size)
        downscaled_gray = cv2.resize(
            gray_full, (self.grid_size, self.grid_size), interpolation=cv2.INTER_AREA
        )

        # 3. Motion Extraction: Absolute Frame Difference |curr - prev|
        if self.prev_gray is None:
            self.prev_gray = downscaled_gray.copy()

        diff = cv2.absdiff(downscaled_gray, self.prev_gray)
        self.prev_gray = downscaled_gray.copy()

        # Normalize motion vector to [0.0, 1.0]
        motion_vector = diff.astype(np.float32) / 255.0

        return raw_frame, downscaled_gray, motion_vector

    def _generate_synthetic_frame(self) -> np.ndarray:
        """
        Generates dynamic synthetic visual stimuli (e.g. an expanding looming circle
        or moving bar) to simulate visual motion without requiring a physical webcam.
        """
        canvas = np.zeros((300, 300, 3), dtype=np.uint8)
        t = self.frame_counter * 0.1
        
        # Looming stimulus: circle expanding and contracting at center
        radius = int(20 + 80 * (0.5 + 0.5 * math.sin(t)))
        center = (150, 150)
        cv2.circle(canvas, center, radius, (255, 255, 255), -1)
        
        # Moving sweeping bar across frame
        bar_x = int((self.frame_counter * 5) % 300)
        cv2.rectangle(canvas, (bar_x, 0), (bar_x + 15, 300), (200, 200, 200), -1)

        return canvas

    def release(self):
        """Releases capture resources."""
        if self.cap is not None:
            self.cap.release()
            logger.info("Video capture released.")


if __name__ == "__main__":
    pipeline = VisualInputPipeline(source="synthetic", grid_size=32)
    for i in range(10):
        raw, ret_gray, motion = pipeline.read_frame()
        print(f"Frame {i}: Retinal Gray Mean={ret_gray.mean():.2f}, Motion Mean={motion.mean():.4f}")
    pipeline.release()
