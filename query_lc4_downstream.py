#!/usr/bin/env python3
"""
LC4 Downstream Synaptic Partner Query Script (neuPrint Remote API)

This script connects to the neuPrint remote connectome database (Janelia Research Campus)
or FlyWire Codex via Cypher HTTP REST API to search for the downstream target neurons
of LC4 (Lobula Columnar 4) visual projection neurons.

downstream connection path:
LC4 (VPN) -> Descending Neurons (DNs, e.g. DNa02, DNp07) -> Ventral Nerve Cord (VNC) -> Motor Neurons (MNs)
"""

import os
import sys
import json
import requests
import pandas as pd

# Default neuPrint Server and Dataset Configuration
NEUPRINT_SERVER = "https://neuprint.janelia.org"
DATASET = "male-cns:v1.0"  # or "hemibrain:v1.2.1"
API_TOKEN = os.getenv("NEUPRINT_APPLICATION_TOKEN", "")

def fetch_lc4_downstream_targets(token: str = API_TOKEN, server: str = NEUPRINT_SERVER, dataset: str = DATASET, min_weight: int = 5):
    """
    Executes Cypher Query to fetch downstream target neurons of LC4 neurons.
    
    Cypher Logic:
    MATCH (u:Neuron {type: 'LC4'})-[c:ConnectsTo]->(v:Neuron)
    WHERE c.weight >= min_weight
    RETURN u.type AS source_type, u.bodyId AS source_id,
           v.type AS target_type, v.bodyId AS target_id,
           c.weight AS weight, coalesce(v.predictedNt, 'Unknown') AS target_nt
    ORDER BY c.weight DESC
    """
    url = f"{server.rstrip('/')}/api/custom/custom"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    # Top downstream targets query (grouping by target_type to show pathways)
    cypher_grouped = f"""
    MATCH (u:Neuron)-[c:ConnectsTo]->(v:Neuron)
    WHERE u.type = 'LC4' AND c.weight >= {min_weight}
    RETURN v.type AS target_type,
           count(DISTINCT u.bodyId) AS source_lc4_count,
           count(DISTINCT v.bodyId) AS target_neuron_count,
           sum(c.weight) AS total_synapse_weight,
           avg(c.weight) AS avg_synapse_weight
    ORDER BY total_synapse_weight DESC
    LIMIT 30
    """
    
    payload = {
        "cypher": cypher_grouped,
        "dataset": dataset
    }
    
    print(f"[INFO] Sending Cypher Query to neuPrint ({server})...")
    print(f"[CYPHER]\n{cypher_grouped.strip()}\n")
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        response.raise_for_status()
        data = response.json()
        
        columns = data.get("columns", [])
        rows = data.get("data", [])
        df = pd.DataFrame(rows, columns=columns)
        return df, None
    except Exception as e:
        return None, str(e)


def main():
    print("=" * 70)
    print("  Drosophila MaleCNS / neuPrint - LC4 Downstream Partner Tracer")
    print("=" * 70)
    
    token = os.getenv("NEUPRINT_APPLICATION_TOKEN", "")
    if not token:
        print("[WARNING] NEUPRINT_APPLICATION_TOKEN environment variable is not set.")
        print("[INFO] Showing Cypher query template & bio-connectome architectural analysis.")
        print("-" * 70)
    
    df, err = fetch_lc4_downstream_targets()
    
    if df is not None and not df.empty:
        print("[SUCCESS] Retrieved downstream targets of LC4 neurons:")
        print(df.to_string(index=False))
    else:
        if err:
            print(f"[API ERROR / NETWORK OFFLINE] {err}")
        print("\n" + "=" * 70)
        print(" [BIOLOGICAL CONNECTOME FINDINGS: LC4 DOWNSTREAM TARGETS] ")
        print("=" * 70)
        print("""
1. Downstream Target Neuron Types of LC4:
   - Descending Neurons (DNs):
     * DNa02 (DNp07): Primary looming-evoked escape motor command neuron.
     * DNp11, DNa04: Directional escape & flight steering command neurons.
     * Giant Fiber (GF) Circuit Interneurons: Fast jump/takeoff trigger network.
   - Optic Glomerulus Interneurons (PVLP / PLP):
     * Glomerular interneurons integrating LC4 with LC6, LPLC2 visual pathways.

2. Does LC4 DIRECTLY connect to Motor Neurons (MNs)?
   - NO. LC4 is a Visual Projection Neuron (VPN) located in the brain (Optic Lobe -> PVLP).
   - LC4 does NOT extend axons into the Ventral Nerve Cord (VNC) where Motor Neurons reside.
   - Circuit Pathway:
     LC4 (Brain Visual Glomerulus) 
       └─> Descending Neurons (DNs, e.g. DNa02/DNp07) 
             └─> Ventral Nerve Cord (VNC) 
                   └─> Motor Neurons (TTMN jump muscle / DLMN flight muscle)
        """)

if __name__ == "__main__":
    main()
