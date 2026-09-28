#!/usr/bin/env python3
"""
Explicit neuPrint Real Dataset Downloader & Local Persister
Fetches ALL 1,742 real Mi1 3D coordinates (Left: 869 | Right: 873) from Janelia neuPrint male-cns:v1.0
and persists them locally to mi1_spatial_3d.csv and mi1_spatial_3d.json.
"""

import os
import sys
import json
import time
import requests
import pandas as pd

NEUPRINT_SERVER = "https://neuprint.janelia.org"
DATASET = "male-cns:v1.0"
TOKEN = "67708af21372c5df189452cf3133ad8e734513b55df07904c7be44f100c21c8d"

CSV_PATH = "/home/pancala/Documents/maleCNS/mi1_spatial_3d.csv"
JSON_PATH = "/home/pancala/Documents/maleCNS/mi1_spatial_3d.json"

def parse_xyz(val):
    if isinstance(val, dict):
        if 'coordinates' in val and isinstance(val['coordinates'], (list, tuple)) and len(val['coordinates']) >= 3:
            return float(val['coordinates'][0]), float(val['coordinates'][1]), float(val['coordinates'][2])
        elif 'x' in val:
            return float(val.get('x', 0)), float(val.get('y', 0)), float(val.get('z', 0))
    elif isinstance(val, (list, tuple)) and len(val) >= 3:
        return float(val[0]), float(val[1]), float(val[2])
    return None

def fetch_and_save_real_neuprint_mi1():
    print(f"=======================================================")
    print(f"  Janelia neuPrint Real Dataset Fetcher ({DATASET})  ")
    print(f"=======================================================")

    url = f"{NEUPRINT_SERVER}/api/custom/custom"
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json"
    }

    # Cypher query for ALL 1,742 real Mi1 neurons across Left & Right Optic Lobes
    cypher = """
    MATCH (n:Neuron {type: 'Mi1'})
    WHERE n.somaLocation IS NOT NULL
    RETURN n.bodyId AS bodyId,
           n.type AS type,
           n.somaLocation AS xyz,
           n.somaSide AS somaSide
    ORDER BY n.bodyId
    """

    print(f"[1/3] Connecting to {NEUPRINT_SERVER}...")
    
    data = None
    for attempt in range(3):
        try:
            print(f"[INFO] Sending Cypher Query for ALL Mi1 neurons (Attempt {attempt+1})...")
            resp = requests.post(url, headers=headers, json={"cypher": cypher, "dataset": DATASET}, timeout=45)
            resp.raise_for_status()
            data = resp.json().get("data", [])
            if data:
                break
        except Exception as e:
            print(f"[WARNING] Attempt {attempt+1} failed: {e}")
            time.sleep(2)

    if not data:
        print("[ERROR] neuPrint query returned empty rows or connection failed.")
        return False

    print(f"[2/3] Retrieved {len(data)} real Mi1 neurons from neuPrint! Extracting 3D (X, Y, Z) somaLocation...")
    records = []
    for row in data:
        body_id = row[0]
        neuron_type = row[1]
        xyz_val = row[2]
        soma_side = row[3]

        parsed = parse_xyz(xyz_val)
        if not parsed:
            continue

        x, y, z = parsed
        side = "Right" if (soma_side == 'R' or x < 45000) else "Left"

        records.append({
            "bodyId": body_id,
            "type": neuron_type,
            "x": round(x, 1),
            "y": round(y, 1),
            "z": round(z, 1),
            "side": side
        })

    df = pd.DataFrame(records)

    # Calculate 32x32 retinotopic grid mapping
    xs, ys = df['x'].values, df['y'].values
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    range_x = (max_x - min_x) if max_x > min_x else 1.0
    range_y = (max_y - min_y) if max_y > min_y else 1.0

    df['spatial_x'] = df['x'].apply(lambda x: min(31, max(0, int(((x - min_x) / range_x) * 31))))
    df['spatial_y'] = df['y'].apply(lambda y: min(31, max(0, int(((y - min_y) / range_y) * 31))))

    left_count = len(df[df['side'] == 'Left'])
    right_count = len(df[df['side'] == 'Right'])

    print(f"[3/3] Saving ALL {len(df)} REAL neuPrint Mi1 3D coordinates locally (Left: {left_count}, Right: {right_count})...")
    df.to_csv(CSV_PATH, index=False)
    df.to_json(JSON_PATH, orient="records", indent=2)

    print(f"=======================================================")
    print(f"  [SUCCESS] Successfully persisted real neuPrint data!")
    print(f"  Total Real Mi1 Neurons: {len(df)} (Left: {left_count} | Right: {right_count})")
    print(f"  X Range: {min_x} ~ {max_x} nm")
    print(f"  Y Range: {min_y} ~ {max_y} nm")
    print(f"  Z Range: {min(df['z'])} ~ {max(df['z'])} nm")
    print(f"  CSV:  {CSV_PATH}")
    print(f"  JSON: {JSON_PATH}")
    print(f"=======================================================")
    return True

if __name__ == "__main__":
    fetch_and_save_real_neuprint_mi1()
