import json
from pathlib import Path


def test_production_uses_current_contract_terms_matcher():
    root = Path(__file__).resolve().parents[2]
    config = json.loads((root / "vercel.json").read_text(encoding="utf-8"))
    service = config["services"]["contract_terms"]
    assert service["root"] == "contract_terms/"
    assert service["entrypoint"] == "v21_main:app"
