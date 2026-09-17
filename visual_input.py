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
        stimulus_mode: str = "auto",  # "auto", "stmd_dot", "yaw_sweep", "pitch_sweep", "looming"
    ):
        self.grid_size = grid_size
        self.target_fps = target_fps
        self.source = source
        self.stimulus_mode = stimulus_mode.lower()
        self.cap = None
        self.prev_gray = None
        self.frame_counter = 0

        self._init_source()

        self.delay_buffer_on = []
        self.delay_buffer_off = []
        self.max_delay_depth = 2

    def _init_source(self):
        """Initializes video capture device or synthetic frame generator."""
        if str(self.source).strip().lower() == "synthetic":
            logger.info(f"VisualInputPipeline initialized in SYNTHETIC motion mode (Stimulus: '{self.stimulus_mode}').")
            self.cap = None
        else:
            try:
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

    def _generate_synthetic_frame(self) -> np.ndarray:
        """
        Generates standard benchmark visual stimuli for each neuron pathway:
        - 'stmd_dot': Small 16x16 dot moving across center (Tests LC11 / STMD)
        - 'yaw_sweep': Vertical bar sweeping horizontally (Tests HS / Yaw)
        - 'pitch_sweep': Horizontal bar sweeping vertically (Tests VS / Pitch)
        - 'looming': Expanding circle (Tests LC4 / Looming)
        - 'auto': Rotates through all 4 benchmark stimuli sequentially
        """
        canvas = np.zeros((300, 300, 3), dtype=np.uint8)

        mode = self.stimulus_mode
        if mode == "auto":
            phase = (self.frame_counter // 50) % 4
            modes = ["looming", "stmd_dot", "yaw_sweep", "pitch_sweep"]
            mode = modes[phase]

        if mode == "stmd_dot":
            # Small Target Motion Stimulus (Specially triggers LC11 STMD without triggering surround inhibition)
            dot_x = int((self.frame_counter * 10) % 300)
            dot_y = 150
            cv2.circle(canvas, (dot_x, dot_y), 10, (255, 255, 255), -1)
            cv2.putText(canvas, "STMD Small Target (LC11)", (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)

        elif mode == "yaw_sweep":
            # Horizontal Sweeping Bar Stimulus (Specially triggers HS Yaw optical flow)
            bar_x = int((self.frame_counter * 12) % 300)
            cv2.rectangle(canvas, (bar_x, 0), (bar_x + 35, 300), (255, 255, 255), -1)
            cv2.putText(canvas, "Horizontal Yaw Sweep (HS)", (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 0), 1)

        elif mode == "pitch_sweep":
            # Vertical Sweeping Bar Stimulus (Specially triggers VS Pitch optical flow)
            bar_y = int((self.frame_counter * 12) % 300)
            cv2.rectangle(canvas, (0, bar_y), (300, bar_y + 35), (255, 255, 255), -1)
            cv2.putText(canvas, "Vertical Pitch Sweep (VS)", (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 165, 0), 1)

        else:  # looming
            # Expanding Looming Circle Stimulus (Specially triggers LC4 Looming / Avoidance)
            t = self.frame_counter * 0.12
            radius = int(15 + 100 * (0.5 + 0.5 * math.sin(t)))
            cv2.circle(canvas, (150, 150), radius, (255, 255, 255), -1)
            cv2.putText(canvas, "Looming Avoidance (LC4)", (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)

        return canvas

    def read_frame(self) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict]:
        """
        Reads next frame, processes through the 3-stage Optic Lobe model:
        1. Lamina: R1-R6 raw light -> L1 (ON edge) & L2/L3 (OFF edge) splitting
        2. Medulla: Temporal delay buffers (Mi1/Mi9 slow vs Tm3/Mi4 fast, Tm9/Tm4 slow vs Tm1/Tm2 fast)
        3. Lobula: T4a-d (ON motion) & T5a-d (OFF motion) 4-cardinal direction Reichardt correlators
        
        Returns:
            (raw_frame, downscaled_gray, motion_vector, heatmaps_dict)
        """
        self.frame_counter += 1

        if self.cap is not None and self.cap.isOpened():
            ret, raw_frame = self.cap.read()
            if not ret or raw_frame is None:
                self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                ret, raw_frame = self.cap.read()
                if not ret or raw_frame is None:
                    raw_frame = self._generate_synthetic_frame()
        else:
            raw_frame = self._generate_synthetic_frame()

        # --- Stage 1: Photoreceptors & Signal Splitting (Lamina) ---
        if len(raw_frame.shape) == 3:
            gray_full = cv2.cvtColor(raw_frame, cv2.COLOR_BGR2GRAY)
        else:
            gray_full = raw_frame

        gray_blurred = cv2.GaussianBlur(gray_full, (5, 5), 0)
        downscaled_gray = cv2.resize(gray_blurred, (self.grid_size, self.grid_size), interpolation=cv2.INTER_AREA)

        if self.prev_gray is None:
            self.prev_gray = downscaled_gray.copy()

        # Signed intensity difference (curr - prev)
        diff_signed = downscaled_gray.astype(np.float32) - self.prev_gray.astype(np.float32)
        self.prev_gray = downscaled_gray.copy()

        # L1 (ON channel: ΔI > 0) & L2/L3 (OFF channel: ΔI < 0)
        l1_on = np.maximum(0.0, diff_signed)
        l2_off = np.maximum(0.0, -diff_signed)

        # Noise thresholding (Keep small STMD target signals > 6.0)
        l1_on[l1_on < 6.0] = 0.0
        l2_off[l2_off < 6.0] = 0.0

        # Normalize to [0.0, 1.0]
        l1_on_norm = l1_on / 255.0
        l2_off_norm = l2_off / 255.0

        # --- Stage 2: Temporal Delay Buffers (Medulla) ---
        self.delay_buffer_on.append(l1_on_norm.copy())
        self.delay_buffer_off.append(l2_off_norm.copy())

        if len(self.delay_buffer_on) > self.max_delay_depth:
            self.delay_buffer_on.pop(0)
            self.delay_buffer_off.pop(0)

        mi1_slow = self.delay_buffer_on[0]       # Delayed ON signal (Mi1 / Mi9)
        tm3_fast = self.delay_buffer_on[-1]      # Instant ON signal (Tm3 / Mi4)
        tm9_slow = self.delay_buffer_off[0]      # Delayed OFF signal (Tm9 / Tm4)
        tm1_fast = self.delay_buffer_off[-1]     # Instant OFF signal (Tm1 / Tm2)

        # --- Stage 3: Directional Correlation (Lobula: Reichardt Correlator) ---
        # 4 Cardinal Directions: Right (a), Left (b), Up (c), Down (d)
        t4a = np.roll(mi1_slow, shift=(0, 1), axis=(0, 1)) * tm3_fast   # ON Right
        t4b = np.roll(mi1_slow, shift=(0, -1), axis=(0, 1)) * tm3_fast  # ON Left
        t4c = np.roll(mi1_slow, shift=(-1, 0), axis=(0, 1)) * tm3_fast  # ON Up
        t4d = np.roll(mi1_slow, shift=(1, 0), axis=(0, 1)) * tm3_fast   # ON Down

        t5a = np.roll(tm9_slow, shift=(0, 1), axis=(0, 1)) * tm1_fast   # OFF Right
        t5b = np.roll(tm9_slow, shift=(0, -1), axis=(0, 1)) * tm1_fast  # OFF Left
        t5c = np.roll(tm9_slow, shift=(-1, 0), axis=(0, 1)) * tm1_fast  # OFF Up
        t5d = np.roll(tm9_slow, shift=(1, 0), axis=(0, 1)) * tm1_fast   # OFF Down

        t4_all = t4a + t4b + t4c + t4d
        t5_all = t5a + t5b + t5c + t5d
        motion_vector = np.clip(t4_all + t5_all + (l1_on_norm + l2_off_norm) * 0.5, 0.0, 1.0)

        heatmaps = {
            "R1_R6": downscaled_gray,
            "L1_ON": l1_on_norm,
            "L2_OFF": l2_off_norm,
            "Mi1_slow": mi1_slow,
            "Tm3_fast": tm3_fast,
            "Tm9_slow": tm9_slow,
            "Tm1_fast": tm1_fast,
            "T4a": t4a, "T4b": t4b, "T4c": t4c, "T4d": t4d,
            "T5a": t5a, "T5b": t5b, "T5c": t5c, "T5d": t5d,
            "T4_all": t4_all,
            "T5_all": t5_all,
            "motion_vector": motion_vector
        }

        return raw_frame, downscaled_gray, motion_vector, heatmaps

    def release(self):
        """Releases capture resources."""
        if self.cap is not None:
            self.cap.release()
            logger.info("Video capture released.")


if __name__ == "__main__":
    pipeline = VisualInputPipeline(source="synthetic", grid_size=32)
    for i in range(10):
        raw, ret_gray, motion, heatmaps = pipeline.read_frame()
        print(f"Frame {i}: Retinal Gray Mean={ret_gray.mean():.2f}, L1 ON Mean={heatmaps['L1_ON'].mean():.4f}, T4 All Mean={heatmaps['T4_all'].mean():.4f}")
    pipeline.release()
