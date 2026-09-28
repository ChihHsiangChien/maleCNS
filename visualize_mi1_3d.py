#!/usr/bin/env python3
"""
Python Interactive 3D Spatial Visualizer for Mi1 Neurons
Provides 360-degree rotation, mouse wheel zoom, pan, and interactive browser 3D view.
"""

import os
import sys
import webbrowser
import pandas as pd
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D

CSV_PATH = "/home/pancala/Documents/maleCNS/mi1_spatial_3d.csv"
HTML_PATH = "/home/pancala/Documents/maleCNS/mi1_3d_visualizer.html"

def main():
    if not os.path.exists(CSV_PATH):
        print(f"[INFO] CSV file not found at {CSV_PATH}. Generating Mi1 3D dataset...")
        import generate_mi1_data
        df = generate_mi1_data.fetch_real_mi1_3d()
        generate_mi1_data.save_matrix(df, CSV_PATH)
    else:
        df = pd.read_csv(CSV_PATH)

    print(f"[INFO] Loaded {len(df)} Mi1 neuron 3D spatial coordinates.")
    print(f"[INFO] Opening 3D Web Visualizer: file://{HTML_PATH}")

    # Launch browser HTML interactive visualizer
    if os.path.exists(HTML_PATH):
        webbrowser.open(f"file://{HTML_PATH}")

    # Also render Matplotlib 3D Interactive Plot
    fig = plt.figure(figsize=(12, 8), facecolor='#030712')
    ax = fig.add_subplot(111, projection='3d', facecolor='#020617')

    left_df = df[df['side'] == 'Left']
    right_df = df[df['side'] == 'Right']

    # Scatter plot Left Eye (Cyan) and Right Eye (Yellow)
    ax.scatter(left_df['x'], left_df['y'], left_df['z'], c='#38bdf8', label='Left Optic Lobe (Mi1_L)', s=15, alpha=0.8)
    ax.scatter(right_df['x'], right_df['y'], right_df['z'], c='#eab308', label='Right Optic Lobe (Mi1_R)', s=15, alpha=0.8)

    ax.set_title('Drosophila Optic Lobe Mi1 Neurons 3D Spatial Topology', color='#38bdf8', fontsize=14, fontweight='bold', pad=20)
    ax.set_xlabel('X Spatial (nm)', color='#94a3b8', labelpad=10)
    ax.set_ylabel('Y Spatial (nm)', color='#94a3b8', labelpad=10)
    ax.set_zlabel('Z Depth (nm)', color='#94a3b8', labelpad=10)

    ax.tick_params(colors='#64748b')
    ax.w_xaxis.pane.fill = False
    ax.w_yaxis.pane.fill = False
    ax.w_zaxis.pane.fill = False

    ax.legend(facecolor='#0f172a', edgecolor='#38bdf8', labelcolor='#e2e8f0', loc='upper right')

    print("[INFO] Showing Matplotlib 3D Window (Drag left-mouse to rotate 360°, scroll to zoom). Close window to finish.")
    plt.tight_layout()
    plt.show()

if __name__ == "__main__":
    main()
