"""
Module 1: Automated Matrix Acquisition (neuPrint API)

Fetches synaptic connection weights, partner IDs, and neurotransmitter properties
for target neuron types (e.g., LC4) directly from the neuPrint server.
Persists retrieved data into lc4_connectome_matrix.csv.
Provides a bio-realistic synthetic matrix fallback when offline or when no API token is provided.
"""

import os
import json
import csv
import logging
import math
import random
import requests
import pandas as pd

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s - %(message)s")
logger = logging.getLogger("ConnectomeFetcher")


class ConnectomeFetcher:
    def __init__(
        self,
        server: str = "https://neuprint.janelia.org",
        dataset: str = "male-cns:v1.0",
        token: str = None,
        target_type: str = "LC4",
        min_weight: int = 5,
        grid_size: int = 32,
    ):
        self.server = server.rstrip('/')
        self.dataset = dataset
        self.token = token or os.getenv("NEUPRINT_APPLICATION_TOKEN", "")
        self.target_type = target_type
        self.min_weight = min_weight
        self.grid_size = grid_size

    def fetch_from_neuprint(self) -> pd.DataFrame:
        """
        Queries neuPrint HTTP Cypher API for connections to target neuron type.
        """
        if not self.token:
            logger.warning("No neuPrint API token provided. Falling back to synthetic matrix generation.")
            return self.generate_synthetic_matrix()

        url = f"{self.server}/api/custom/custom"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }
        
        # Cypher query targeting upstream partners of target_type
        cypher = f"""
        MATCH (u:Neuron)-[conn:ConnectsTo]->(v:Neuron)
        WHERE v.type = '{self.target_type}' AND conn.weight >= {self.min_weight}
        RETURN u.bodyId AS source_id,
               u.type AS source_type,
               v.bodyId AS target_id,
               v.type AS target_type,
               conn.weight AS weight,
               coalesce(u.predictedNt, u.statusLabel, 'ACh') AS nt
        ORDER BY conn.weight DESC
        """

        payload = {
            "cypher": cypher,
            "dataset": self.dataset
        }

        try:
            logger.info(f"Querying neuPrint server at {self.server} for dataset {self.dataset}...")
            response = requests.post(url, headers=headers, json=payload, timeout=15)
            response.raise_for_status()
            
            data = response.json()
            # neuPrint custom query response structure: {"columns": [...], "data": [...]}
            columns = data.get("columns", [])
            rows = data.get("data", [])
            
            if not rows:
                logger.warning(f"neuPrint query returned empty result for target_type='{self.target_type}'. Using synthetic matrix.")
                return self.generate_synthetic_matrix()
            
            df = pd.DataFrame(rows, columns=columns)
            logger.info(f"Successfully retrieved {len(df)} connections from neuPrint.")
            
            # Map source neurons to spatial visual grid coordinates (32x32)
            df = self._assign_retinotopic_coordinates(df)
            return df
            
        except Exception as e:
            logger.error(f"Failed to fetch data from neuPrint: {e}. Falling back to synthetic matrix.")
            return self.generate_synthetic_matrix()

    def _assign_retinotopic_coordinates(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Assigns retinotopic (spatial_x, spatial_y) coordinates to source neurons.
        """
        unique_sources = df['source_id'].unique()
        num_sources = len(unique_sources)
        
        # Map source IDs onto grid
        source_coords = {}
        for idx, s_id in enumerate(unique_sources):
            x = (idx % self.grid_size)
            y = (idx // self.grid_size) % self.grid_size
            source_coords[s_id] = (x, y)
            
        df['spatial_x'] = df['source_id'].map(lambda sid: source_coords[sid][0])
        df['spatial_y'] = df['source_id'].map(lambda sid: source_coords[sid][1])
        return df

    def generate_synthetic_matrix(self) -> pd.DataFrame:
        """
        Generates a bio-realistic synthetic connectome matrix for LC4 neurons.
        LC4 neurons exhibit a retinotopic receptive field with excitatory center (ACh)
        and inhibitory surround (GABA/Glu) to detect expanding motion (looming).
        """
        logger.info(f"Generating synthetic bio-inspired connectome matrix ({self.grid_size}x{self.grid_size} grid)...")
        
        records = []
        center_x, center_y = self.grid_size / 2.0, self.grid_size / 2.0
        max_dist = math.hypot(center_x, center_y)
        
        target_id = 999001
        
        for y in range(self.grid_size):
            for x in range(self.grid_size):
                source_id = 100000 + y * self.grid_size + x
                dist = math.hypot(x - center_x, y - center_y)
                
                # Center-surround receptive field mapping:
                # Center (dist <= 8): Excitatory (ACh) with high synaptic weight
                # Surround (8 < dist <= 14): Inhibitory (GABA) with moderate weight
                if dist <= 8.0:
                    source_type = "Tm_center"
                    nt = "ACh"  # Acetylcholine (Excitatory)
                    # Gaussian weight distribution in center
                    weight = int(15 * math.exp(-0.5 * (dist / 4.0) ** 2)) + random.randint(1, 4)
                elif dist <= 14.0:
                    source_type = "Tm_surround"
                    nt = "GABA"  # GABA (Inhibitory)
                    weight = int(10 * math.exp(-0.5 * ((dist - 10) / 3.0) ** 2)) + random.randint(1, 3)
                else:
                    # Distant periphery: Weak cholinergic/glutamatergic inputs
                    source_type = "Mi_peripheral"
                    nt = "GABA" if random.random() < 0.5 else "ACh"
                    weight = random.randint(0, 3)
                
                if weight >= self.min_weight:
                    records.append({
                        "source_id": source_id,
                        "source_type": source_type,
                        "target_id": target_id,
                        "target_type": self.target_type,
                        "weight": weight,
                        "nt": nt,
                        "spatial_x": x,
                        "spatial_y": y
                    })
                    
        df = pd.DataFrame(records)
        logger.info(f"Generated {len(df)} synthetic synaptic connections for {self.target_type}.")
        return df

    def generate_lc10_synthetic_matrix(self) -> pd.DataFrame:
        """
        Generates a synthetic connectome matrix for LC10/LC11 neurons (Small Target Motion Detector - STMD).
        LC10 neurons feature a sharp, highly localized cholinergic (ACh) excitatory receptive field
        to track small moving targets and drive positive steering attraction towards food sources.
        """
        logger.info(f"Generating synthetic LC10 STMD connectome matrix ({self.grid_size}x{self.grid_size} grid)...")
        records = []
        center_x, center_y = self.grid_size / 2.0, self.grid_size / 2.0
        target_id = 999010
        
        for y in range(self.grid_size):
            for x in range(self.grid_size):
                source_id = 200000 + y * self.grid_size + x
                dist = math.hypot(x - center_x, y - center_y)
                
                # LC10 STMD Receptive Field:
                # Highly focused excitatory center (ACh) for small targets
                if dist <= 5.0:
                    source_type = "Tm_STMD_center"
                    nt = "ACh"
                    weight = int(22 * math.exp(-0.5 * (dist / 2.5) ** 2)) + random.randint(2, 5)
                elif dist <= 10.0:
                    source_type = "Tm_STMD_flank"
                    nt = "GABA"
                    weight = int(6 * math.exp(-0.5 * ((dist - 7) / 2.0) ** 2)) + random.randint(1, 2)
                else:
                    source_type = "Mi_peripheral"
                    nt = "ACh"
                    weight = random.randint(0, 2)
                
                if weight >= self.min_weight:
                    records.append({
                        "source_id": source_id,
                        "source_type": source_type,
                        "target_id": target_id,
                        "target_type": "LC10",
                        "weight": weight,
                        "nt": nt,
                        "spatial_x": x,
                        "spatial_y": y
                    })
                    
        df = pd.DataFrame(records)
        logger.info(f"Generated {len(df)} synthetic LC10 STMD connections.")
        return df

    def save_matrix(self, df: pd.DataFrame, output_path: str = "lc4_connectome_matrix.csv") -> str:
        """
        Persists the connectome matrix to a CSV file.
        """
        df.to_csv(output_path, index=False)
        logger.info(f"Saved connectome matrix to {os.path.abspath(output_path)} (Rows: {len(df)})")
        return os.path.abspath(output_path)


if __name__ == "__main__":
    fetcher = ConnectomeFetcher()
    df_lc4 = fetcher.fetch_from_neuprint()
    fetcher.save_matrix(df_lc4, "lc4_connectome_matrix.csv")
    
    df_lc10 = fetcher.generate_lc10_synthetic_matrix()
    fetcher.save_matrix(df_lc10, "lc10_connectome_matrix.csv")

