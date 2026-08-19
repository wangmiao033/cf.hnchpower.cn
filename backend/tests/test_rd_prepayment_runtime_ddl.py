from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_rd_prepayment_request_module_is_ddl_free():
    source = (REPO_ROOT / "contract_terms" / "rd_prepayment.py").read_text(encoding="utf-8").upper()
    for token in ("CREATE TABLE", "ALTER TABLE", "CREATE INDEX"):
        assert token not in source


def test_rd_prepayment_deductions_schema_is_versioned_and_registered():
    migration = REPO_ROOT / "backend" / "sql" / "060_rd_prepayment_deductions.sql"
    assert migration.exists()
    migration_source = migration.read_text(encoding="utf-8")
    assert "cf_rd_prepayment_deductions" in migration_source

    registry_source = (REPO_ROOT / "backend" / "app" / "core" / "migrations.py").read_text(
        encoding="utf-8"
    )
    assert "range(1, 61)" in registry_source
