"""
Module 4: Multi-Channel Real-Time Visualization & Telemetry

Renders real-time terminal telemetry using character density mapping (█)
and displays a multi-panel OpenCV visual debug preview window showing retinal input,
motion heatmap, and multi-channel membrane potential metrics (LC4, LC11, HS, VS).
"""

import sys
import time
import collections
import cv2
import numpy as np
from rich.console import Console

console = Console()


class TelemetryVisualizer:
    CHANNELS = ["LC4", "LC11", "HS", "VS"]

    def __init__(
        self,
        grid_size: int = 32,
        target_neuron: str = "MultiChannel",
        enable_gui: bool = True,
        bar_length: int = 20,
    ):
        self.grid_size = grid_size
        self.target_neuron = target_neuron
        self.enable_gui = enable_gui
        self.bar_length = bar_length

        self.active_heatmap_mode = "6"  # Default: T4_all
        self.heatmap_labels = {
            "1": "R1-R6 Raw Luminance",
            "2": "L1 ON Edge (Brightening)",
            "3": "L2 OFF Edge (Darkening)",
            "4": "Mi1 Slow Delay Buffer",
            "5": "Tm3 Fast Instant Frame",
            "6": "T4 ON Reichardt Motion",
            "7": "T5 OFF Reichardt Motion",
            "8": "LC4 Obstacle Retinotopic Heatmap",
            "9": "LC11 SmallTarget Retinotopic Heatmap",
            "0": "HS Yaw Motion Retinotopic Heatmap",
            "a": "VS Pitch Motion Retinotopic Heatmap",
            "g": "8-Dir Reichardt Overview Grid"
        }

        self.history_len = 100
        self.histories = {ch: collections.deque(maxlen=self.history_len) for ch in self.CHANNELS}
        self.last_time = time.time()
        self.fps = 0.0

    def update_telemetry(
        self,
        raw_frame: np.ndarray,
        retinal_gray: np.ndarray,
        motion_vector: np.ndarray,
        neural_state: dict,
        heatmaps: dict = None,
    ):
        """Updates terminal telemetry and OpenCV GUI preview window for multi-channel state."""
        now = time.time()
        dt = now - self.last_time
        self.last_time = now
        if dt > 0:
            self.fps = 0.9 * self.fps + 0.1 * (1.0 / dt)

        channels = neural_state.get("channels", {})
        if not channels:
            channels = {
                "LC4": neural_state,
                "LC11": {"membrane_potential": 0.0, "firing_intensity": 0.0, "is_firing": False},
                "HS": {"membrane_potential": 0.0, "firing_intensity": 0.0, "is_firing": False},
                "VS": {"membrane_potential": 0.0, "firing_intensity": 0.0, "is_firing": False}
            }

        for ch in self.CHANNELS:
            v_net = channels.get(ch, {}).get("membrane_potential", 0.0)
            self.histories[ch].append(v_net)

        self._render_terminal(channels)

        if self.enable_gui:
            self._render_gui(raw_frame, retinal_gray, motion_vector, channels, heatmaps)

    def _render_terminal(self, channels: dict):
        """Renders multi-channel text progress bar in terminal."""
        if hasattr(sys.stdout, "reconfigure"):
            try:
                sys.stdout.reconfigure(encoding="utf-8")
            except Exception:
                pass

        parts = [f"\rFPS: {self.fps:4.1f}"]
        for ch in self.CHANNELS:
            ch_data = channels.get(ch, {})
            intensity = ch_data.get("firing_intensity", 0.0)
            v_net = ch_data.get("membrane_potential", 0.0)
            is_firing = ch_data.get("is_firing", False)

            filled = max(0, min(self.bar_length, int(round(self.bar_length * (intensity / 100.0)))))
            bar = "█" * filled + "░" * (self.bar_length - filled)
            status = "⚡" if is_firing else " "
            parts.append(f"[{ch}] {v_net:4.1f}mV [{bar}] {status}")

        text_output = " | ".join(parts)
        try:
            sys.stdout.write(text_output)
            sys.stdout.flush()
        except UnicodeEncodeError:
            safe_output = f"\rFPS: {self.fps:4.1f} | LC4: {channels.get('LC4', {}).get('membrane_potential', 0.0):.1f}mV | LC11: {channels.get('LC11', {}).get('membrane_potential', 0.0):.1f}mV"
            sys.stdout.write(safe_output)
            sys.stdout.flush()

    def _render_gui(
        self,
        raw_frame: np.ndarray,
        retinal_gray: np.ndarray,
        motion_vector: np.ndarray,
        channels: dict,
        heatmaps: dict = None,
    ):
        """Builds composite 3-panel OpenCV window with 4-channel oscilloscope and heatmap switcher."""
        panel_size = 280

        # Panel 1: Upscaled Retinal View
        retinal_bgr = cv2.cvtColor(retinal_gray, cv2.COLOR_GRAY2BGR)
        retinal_scaled = cv2.resize(retinal_bgr, (panel_size, panel_size), interpolation=cv2.INTER_NEAREST)
        step = panel_size // self.grid_size
        if step > 1:
            for x in range(0, panel_size, step):
                cv2.line(retinal_scaled, (x, 0), (x, panel_size), (40, 40, 40), 1)
            for y in range(0, panel_size, step):
                cv2.line(retinal_scaled, (0, y), (panel_size, y), (40, 40, 40), 1)
        cv2.putText(retinal_scaled, "1. Retinal Grid (32x32)", (10, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)

        # Panel 2: Selectable Heatmap
        if self.active_heatmap_mode == "g" and heatmaps:
            # 8-Directional Grid View (T4a-d top row, T5a-d bottom row)
            heatmap_scaled = np.zeros((panel_size, panel_size, 3), dtype=np.uint8)
            dirs = [("T4a", "T4 R"), ("T4b", "T4 L"), ("T4c", "T4 U"), ("T4d", "T4 D"),
                    ("T5a", "T5 R"), ("T5b", "T5 L"), ("T5c", "T5 U"), ("T5d", "T5 D")]
            sub_w = panel_size // 4
            sub_h = panel_size // 2

            for i, (key, label) in enumerate(dirs):
                r = i // 4
                c = i % 4
                arr = heatmaps.get(key, np.zeros((self.grid_size, self.grid_size), dtype=np.float32))
                u8 = (np.clip(arr * 4.0, 0, 1) * 255).astype(np.uint8)
                cm = cv2.applyColorMap(u8, cv2.COLORMAP_JET)
                sub_scaled = cv2.resize(cm, (sub_w, sub_h), interpolation=cv2.INTER_NEAREST)
                cv2.putText(sub_scaled, label, (2, 12), cv2.FONT_HERSHEY_SIMPLEX, 0.3, (255, 255, 255), 1)
                heatmap_scaled[r*sub_h:(r+1)*sub_h, c*sub_w:(c+1)*sub_w] = sub_scaled
        else:
            # Single Heatmap Mode
            target_map = motion_vector
            if self.active_heatmap_mode in ["8", "9", "0", "a"]:
                ch_key_map = {"8": "LC4", "9": "LC11", "0": "HS", "a": "VS"}
                ch_name = ch_key_map[self.active_heatmap_mode]
                ch_data = channels.get(ch_name, {})
                target_map = ch_data.get("spatial_map", np.zeros((self.grid_size, self.grid_size), dtype=np.float32))
            elif heatmaps:
                mode_key_map = {
                    "1": "R1_R6", "2": "L1_ON", "3": "L2_OFF",
                    "4": "Mi1_slow", "5": "Tm3_fast", "6": "T4_all", "7": "T5_all"
                }
                map_key = mode_key_map.get(self.active_heatmap_mode, "motion_vector")
                target_map = heatmaps.get(map_key, motion_vector)

            motion_uint8 = (np.clip(target_map, 0, 1) * 255).astype(np.uint8)
            heatmap = cv2.applyColorMap(motion_uint8, cv2.COLORMAP_JET)
            heatmap_scaled = cv2.resize(heatmap, (panel_size, panel_size), interpolation=cv2.INTER_NEAREST)

        label_str = self.heatmap_labels.get(self.active_heatmap_mode, "Motion Heatmap")
        cv2.putText(heatmap_scaled, f"2. [{self.active_heatmap_mode}] {label_str}", (10, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)
        cv2.putText(heatmap_scaled, "Keys 1-9,0,a,g to switch heatmaps", (10, panel_size - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (200, 200, 200), 1)

        # Panel 3: Multi-Channel Oscilloscope
        dash = np.zeros((panel_size, panel_size, 3), dtype=np.uint8)
        colors = {
            "LC4": (0, 255, 255),   # Yellow: Obstacle
            "LC11": (255, 0, 255),  # Magenta: Small target
            "HS": (0, 255, 0),     # Green: Yaw
            "VS": (255, 165, 0)    # Orange: Pitch/Roll
        }

        # Draw waveform per channel
        for ch in self.CHANNELS:
            hist = self.histories[ch]
            if len(hist) > 1:
                pts = []
                for idx, val in enumerate(hist):
                    x_pos = int((idx / self.history_len) * panel_size)
                    y_pos = int(panel_size - 30 - (val / 50.0) * (panel_size - 100))
                    y_pos = max(10, min(panel_size - 10, y_pos))
                    pts.append((x_pos, y_pos))
                for i in range(len(pts) - 1):
                    cv2.line(dash, pts[i], pts[i + 1], colors[ch], 1)

        # Overlay text stats for all 4 channels
        y_offset = 25
        cv2.putText(dash, "3. Multi-Channel Output Telemetry", (10, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
        for ch in self.CHANNELS:
            ch_data = channels.get(ch, {})
            v_net = ch_data.get("membrane_potential", 0.0)
            firing = ch_data.get("is_firing", False)
            status_str = "FIRE!" if firing else "REST"
            c = (0, 0, 255) if firing else colors[ch]
            cv2.putText(dash, f"{ch:4s}: {v_net:5.1f} mV [{status_str}]", (10, y_offset + 25), cv2.FONT_HERSHEY_SIMPLEX, 0.45, c, 1)
            y_offset += 20

        combined = np.hstack((retinal_scaled, heatmap_scaled, dash))
        cv2.imshow("Biological Neural Simulation - Top-Down Multi-Channel", combined)
        
        raw_key = cv2.waitKey(1) & 0xFF
        if raw_key != 255:
            key_char = chr(raw_key).lower()
            if key_char in self.heatmap_labels:
                self.active_heatmap_mode = key_char

    def close(self):
        """Closes visual preview windows."""
        if self.enable_gui:
            cv2.destroyAllWindows()
        print("\n[Telemetry] Telemetry session closed.")


if __name__ == "__main__":
    viz = TelemetryVisualizer(enable_gui=False)
    for i in range(10):
        dummy_state = {
            "channels": {
                "LC4": {"membrane_potential": i * 3.0, "firing_intensity": i * 6.0, "is_firing": i > 7},
                "LC11": {"membrane_potential": i * 1.5, "firing_intensity": i * 3.0, "is_firing": False},
                "HS": {"membrane_potential": i * 2.0, "firing_intensity": i * 4.0, "is_firing": False},
                "VS": {"membrane_potential": i * 2.5, "firing_intensity": i * 5.0, "is_firing": i > 8},
            }
        }
        viz.update_telemetry(None, np.zeros((32, 32), dtype=np.uint8), np.zeros((32, 32), dtype=np.float32), dummy_state)
        time.sleep(0.05)
    viz.close()
