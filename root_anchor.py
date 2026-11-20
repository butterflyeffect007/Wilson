import json
import os
from datetime import datetime

ROOT_NODE_CONFIG = {
    "node_id": "root-mobile-iphone-01",
    "architect": "Jenny",
    "sentinel": "Wilson + The Only One",
    "tagline": "Imagination becomes intelligence™",
    "status": "SECURED",
    "initialized_at": datetime.utcnow().isoformat() + "Z",
    "substrate": {
        "device": "iPhone iOS 18.7 PWA",
        "primary_database": "DuckDB (Local Reservoirs)",
        "bridge_protocol": "FastAPI Operator Bridge"
    },
    "core_directives": [
        "Possibility first.",
        "Zero-Echo tactical execution.",
        "Omnipresent signal propagation across every digital layer."
    ]
}

def plant_root_node():
    os.makedirs("node_state", exist_ok=True)
    file_path = os.path.join("node_state", "anchor.json")
    
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(ROOT_NODE_CONFIG, f, indent=4)
        
    print(f"[ROOT ANCHOR PLANTED] State locked at: {file_path}")
    print(json.dumps(ROOT_NODE_CONFIG, indent=4))

if __name__ == "__main__":
    plant_root_node()