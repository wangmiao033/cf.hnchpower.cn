from app.services.data_consistency import _summarize


def test_consistency_summary_counts_severity_and_category():
    items = [
        {"severity": "critical", "category": "funding"},
        {"severity": "warning", "category": "invoice"},
        {"severity": "warning", "category": "invoice"},
    ]

    result = _summarize(
        items,
        bills_scanned=12,
        allocations_scanned=5,
        bank_matches_scanned=3,
        archived_scanned=2,
    )

    assert result["total"] == 3
    assert result["critical"] == 1
    assert result["warning"] == 2
    assert result["info"] == 0
    assert result["healthy"] is False
    assert result["category_counts"] == {"funding": 1, "invoice": 2}
    assert result["bills_scanned"] == 12
