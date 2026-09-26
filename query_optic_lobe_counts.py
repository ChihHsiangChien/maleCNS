#!/usr/bin/env python3
"""
Optic Lobe & Output Neuron Population Counter (neuPrint Remote API)

Queries male-cns:v1.0 dataset for neuron counts corresponding to Stage 1-4
described in blog2.txt:
- Stage 1: Lamina (L1, L2, L3)
- Stage 2: Medulla (Mi1, Mi4, Mi9, Tm1, Tm2, Tm3, Tm4, Tm9)
- Stage 3: Lobula Motion (T4a-d, T5a-d)
- Stage 4: Connectome Outputs (LC4, LC11, HS, VS)
"""

import os
import requests
import pandas as pd

NEUPRINT_SERVER = "https://neuprint.janelia.org"
DATASET = "male-cns:v1.0"
API_TOKEN = os.getenv("NEUPRINT_APPLICATION_TOKEN", "")

STAGES_MAP = {
    "Stage 1: Lamina": ["L1", "L2", "L3", "L4", "L5"],
    "Stage 2: Medulla Delay Buffers": ["Mi1", "Mi4", "Mi9", "Tm1", "Tm2", "Tm3", "Tm4", "Tm9"],
    "Stage 3: Lobula Reichardt Motion": ["T4a", "T4b", "T4c", "T4d", "T5a", "T5b", "T5c", "T5d", "T4", "T5"],
    "Stage 4: Connectome Outputs": ["LC4", "LC11", "HSN", "HSE", "HSS", "VS1", "VS2", "VS3", "VS4", "VS5", "VS6"]
}

def query_exact_counts(token: str):
    url = f"{NEUPRINT_SERVER}/api/custom/custom"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    all_target_types = []
    for types_list in STAGES_MAP.values():
        all_target_types.extend(types_list)

    types_str = ", ".join([f"'{t}'" for t in set(all_target_types)])

    cypher = f"""
    MATCH (n:Neuron)
    WHERE n.type IN [{types_str}]
    RETURN n.type AS type, count(n) AS count
    ORDER BY count DESC
    """

    payload = {"cypher": cypher, "dataset": DATASET}
    resp = requests.post(url, headers=headers, json=payload, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return pd.DataFrame(data["data"], columns=data["columns"])


def query_prefix_counts(token: str):
    """Fallback query to catch subtypes using STARTS WITH (e.g. T4a_left, Mi1a)"""
    url = f"{NEUPRINT_SERVER}/api/custom/custom"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    cypher = """
    MATCH (n:Neuron)
    WHERE n.type STARTS WITH 'L1' OR n.type STARTS WITH 'L2' OR n.type STARTS WITH 'L3'
       OR n.type STARTS WITH 'Mi' OR n.type STARTS WITH 'Tm'
       OR n.type STARTS WITH 'T4' OR n.type STARTS WITH 'T5'
       OR n.type STARTS WITH 'LC' OR n.type STARTS WITH 'HS' OR n.type STARTS WITH 'VS'
    RETURN n.type AS type, count(n) AS count
    ORDER BY type ASC
    """

    payload = {"cypher": cypher, "dataset": DATASET}
    resp = requests.post(url, headers=headers, json=payload, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return pd.DataFrame(data["data"], columns=data["columns"])


def main():
    token = os.getenv("NEUPRINT_APPLICATION_TOKEN", "")
    if not token:
        print("[WARNING] NEUPRINT_APPLICATION_TOKEN is not set in this shell.")
        print("Please run: export NEUPRINT_APPLICATION_TOKEN='your_token'")
        return

    print("=" * 70)
    print(f" Querying neuprint.janelia.org ({DATASET}) for Optic Lobe Neuron Counts")
    print("=" * 70)

    try:
        df_exact = query_exact_counts(token)
        counts_dict = dict(zip(df_exact['type'], df_exact['count']))

        print("\n【Optic Lobe & Connectome Neuron Counts (male-cns:v1.0)】\n")
        
        for stage_name, types_list in STAGES_MAP.items():
            print(f"--- {stage_name} ---")
            total_stage_count = 0
            for t in types_list:
                c = counts_dict.get(t, 0)
                total_stage_count += c
                print(f"  • {t:<10}: {c:>5} neurons")
            print(f"  └─ Stage Total: {total_stage_count:>5} neurons\n")

    except Exception as e:
        print(f"[ERROR] Failed to query neuPrint: {e}")

if __name__ == "__main__":
    main()
