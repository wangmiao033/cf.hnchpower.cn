from pathlib import Path


def test_production_uses_v16_contract_terms_entrypoint():
    root = Path(__file__).resolve().parents[1]
    config = (root / "vercel.json").read_text(encoding="utf-8")
    assert '"entrypoint": "v16_main:app"' in config
