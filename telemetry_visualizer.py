"""
Module 4: Real-Time Visualization & Telemetry

Renders real-time terminal telemetry using character density mapping (█)
and displays a multi-panel OpenCV visual debug preview window showing retinal input,
motion heatmap, and live membrane potential metrics.
"""

import sys
import time
import collections
import cv2
import numpy as np
from rich.console import Console
from rich.panel import Panel
from rich.layout import Layout
from rich.text import Text

console = Console()


class TelemetryVisualizer:
    def __init__(
        self,
        grid_size: int = 32,
        target_neuron: str = "LC4",
        enable_gui: bool = True,
        bar_length: int = 30,
    ):
        self.grid_size = grid_size
        self.target_neuron = target_neuron
        self.enable_gui = enable_gui
        self.bar_length = bar_length
        
        self.history_len = 100
        self.potential_history = collections.deque(maxlen=self.history_len)
        self.intensity_history = collections.deque(maxlen=self.history_len)
        
        self.last_time = time.time()
        self.fps = 0.0

    def update_telemetry(
        self,
        raw_frame: np.ndarray,
        retinal_gray: np.ndarray,
        motion_vector: np.ndarray,
        neural_state: dict,
    ):
        """
        Updates terminal telemetry and OpenCV GUI preview window.
        """
        # Calculate FPS
        now = time.time()
        dt = now - self.last_time
        self.last_time = now
        if dt > 0:
            self.fps = 0.9 * self.fps + 0.1 * (1.0 / dt)

        v_net = neural_state.get("membrane_potential", 0.0)
        intensity = neural_state.get("firing_intensity", 0.0)
        raw_curr = neural_state.get("raw_current", 0.0)
        is_firing = neural_state.get("is_firing", False)

        self.potential_history.append(v_net)
        self.intensity_history.append(intensity)

        # 1. Render Terminal Telemetry
        self._render_terminal(v_net, intensity, raw_curr, is_firing)

        # 2. Render GUI Debug Window (if enabled)
        if self.enable_gui:
            self._render_gui(raw_frame, retinal_gray, motion_vector, v_net, intensity, is_firing)

    def _render_terminal(
        self, v_net: float, intensity: float, raw_curr: float, is_firing: bool
    ):
        """Renders text-based progress bar and status in terminal using █ density mapping."""
        # Ensure stdout handles UTF-8 on Windows
        if hasattr(sys.stdout, "reconfigure"):
            try:
                sys.stdout.reconfigure(encoding="utf-8")
            except Exception:
                pass

        filled_len = int(round(self.bar_length * (intensity / 100.0)))
        filled_len = max(0, min(self.bar_length, filled_len))
        
        bar_char = "█"
        bar_str = bar_char * filled_len + "░" * (self.bar_length - filled_len)
        
        fire_status = "⚡ FIRING!" if is_firing else "  QUIESCENT"

        text_output = (
            f"\r[{self.target_neuron}] FPS: {self.fps:4.1f} | "
            f"V_net: {v_net:6.2f} mV | "
            f"Fire Intensity: [{bar_str}] {intensity:5.1f}% | "
            f"{fire_status}"
        )
        try:
            sys.stdout.write(text_output)
            sys.stdout.flush()
        except UnicodeEncodeError:
            safe_bar = "#" * filled_len + "-" * (self.bar_length - filled_len)
            safe_status = "[FIRING!]" if is_firing else "[QUIESCENT]"
            safe_output = (
                f"\r[{self.target_neuron}] FPS: {self.fps:4.1f} | "
                f"V_net: {v_net:6.2f} mV | "
                f"Fire Intensity: [{safe_bar}] {intensity:5.1f}% | "
                f"{safe_status}"
            )
            sys.stdout.write(safe_output)
            sys.stdout.flush()

    def _render_gui(
        self,
        raw_frame: np.ndarray,
        retinal_gray: np.ndarray,
        motion_vector: np.ndarray,
        v_net: float,
        intensity: float,
        is_firing: bool,
    ):
        """Builds a composite 3-panel OpenCV window."""
        panel_size = 256
        
        # Panel 1: Upscaled Retinal View with Ommatidia Grid
        retinal_bgr = cv2.cvtColor(retinal_gray, cv2.COLOR_GRAY2BGR)
        retinal_scaled = cv2.resize(retinal_bgr, (panel_size, panel_size), interpolation=cv2.INTER_NEAREST)
        
        # Overlay ommatidia grid lines
        step = panel_size // self.grid_size
        if step > 1:
            for x in range(0, panel_size, step):
                cv2.line(retinal_scaled, (x, 0), (x, panel_size), (40, 40, 40), 1)
            for y in range(0, panel_size, step):
                cv2.line(retinal_scaled, (0, y), (panel_size, y), (40, 40, 40), 1)
                
        cv2.putText(retinal_scaled, "1. Retinal Grid (32x32)", (10, 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)

        # Panel 2: Motion Heatmap (COLORMAP_JET)
        motion_uint8 = (np.clip(motion_vector, 0, 1) * 255).astype(np.uint8)
        heatmap = cv2.applyColorMap(motion_uint8, cv2.COLORMAP_JET)
        heatmap_scaled = cv2.resize(heatmap, (panel_size, panel_size), interpolation=cv2.INTER_NEAREST)
        cv2.putText(heatmap_scaled, "2. Motion Heatmap", (10, 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

        # Panel 3: Neural Response Oscilloscope / Telemetry Dashboard
        dash = np.zeros((panel_size, panel_size, 3), dtype=np.uint8)
        
        # Draw waveform of potential history
        if len(self.potential_history) > 1:
            pts = []
            max_v = max(50.0, max(self.potential_history))
            for idx, val in enumerate(self.potential_history):
                x_pos = int((idx / self.history_len) * panel_size)
                y_pos = int(panel_size - 40 - (val / max_v) * (panel_size - 80))
                y_pos = max(10, min(panel_size - 10, y_pos))
                pts.append((x_pos, y_pos))
                
            for i in range(len(pts) - 1):
                cv2.line(dash, pts[i], pts[i + 1], (0, 255, 0), 2)

        # Overlay text stats
        color = (0, 0, 255) if is_firing else (0, 255, 255)
        cv2.putText(dash, f"Target: {self.target_neuron}", (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
        cv2.putText(dash, f"V_net: {v_net:.2f} mV", (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
        cv2.putText(dash, f"Intensity: {intensity:.1f}%", (10, 75), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
        
        if is_firing:
            cv2.putText(dash, "STATUS: ACTION POTENTIAL!", (10, 110), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)
        else:
            cv2.putText(dash, "STATUS: RESTING", (10, 110), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

        # Combine into multi-panel view side by side
        combined = np.hstack((retinal_scaled, heatmap_scaled, dash))
        
        cv2.imshow("Biological Neural Simulation - Connectome Telemetry", combined)
        cv2.waitKey(1)

    def close(self):
        """Closes visual preview windows."""
        if self.enable_gui:
            cv2.destroyAllWindows()
        print("\n[Telemetry] Telemetry session closed.")


if __name__ == "__main__":
    viz = TelemetryVisualizer(enable_gui=False)
    for i in range(20):
        dummy_state = {"membrane_potential": i * 2.5, "firing_intensity": min(100.0, i * 5.0), "is_firing": i > 12}
        viz.update_telemetry(None, np.zeros((32, 32), dtype=np.uint8), np.zeros((32, 32), dtype=np.float32), dummy_state)
        time.sleep(0.05)
    viz.close()
