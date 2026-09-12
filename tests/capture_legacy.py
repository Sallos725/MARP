"""Capture the published v0.8.4 contract using temporary storage only."""
import json
import os
import tempfile
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'legacy-python'))

with tempfile.TemporaryDirectory(prefix="marp-contract-") as data:
    os.environ["CONFIG_PATH"] = f"{data}/config.json"
    os.environ["PRESET_PATH"] = f"{data}/presets.json"
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as client:
        fixtures = {path: client.get(path).json() for path in ["/health", "/config", "/status", "/prompts/defaults", "/presets", "/openapi.json"]}
        cfg = fixtures["/config"] | {f"{name}_enabled": False for name in ["worldbuilding", "plot", "character"]}
        assert client.put("/config", json=cfg).status_code == 200
        fixtures["/analyze-disabled"] = client.post("/analyze", json={"user_input": "계속"}).json()
    Path("tests/fixtures").mkdir(parents=True, exist_ok=True)
    Path("tests/fixtures/v0.8.4.json").write_text(json.dumps(fixtures, ensure_ascii=False, indent=2) + "\n")
