from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import unittest
from fastapi import HTTPException
from honor_official_snapshot import attach_honor_source_revisions

NOW = datetime(2026, 10, 19, 9, 0, tzinfo=timezone.utc)


def test_source_snapshot_records_terms_presence_and_link_revision():
    conn = Mock()
    conn.execute.return_value.fetchall.side_effect = [
        [dict(access_item_id='A', contract_updated_at=NOW, access_updated_at=NOW)],
        [dict(access_item_id='A', updated_at=NOW)],
        [dict(line_id='L', access_item_id='A', updated_at=NOW)],
    ]
    result = dict(generated_at=NOW.isoformat(), lines=[dict(match={'access_item_id': 'A'})])
    updated = attach_honor_source_revisions(conn, 'B', result)
    assert updated['honor_source_revisions']['A']['terms_updated_at'] == NOW
    assert updated['honor_binding_revisions']['L']['access_item_id'] == 'A'
    assert 'honor_source_revisions' not in result
    assert all('FOR SHARE' in call.args[0] for call in conn.execute.call_args_list)


def test_source_changed_during_calculation_is_not_recorded_as_old_evidence():
    conn = Mock()
    conn.execute.return_value.fetchall.side_effect = [
        [dict(access_item_id='A', contract_updated_at=NOW + timedelta(seconds=1), access_updated_at=NOW)], [],
    ]
    with unittest.TestCase().assertRaises(HTTPException):
        attach_honor_source_revisions(conn, 'B', dict(generated_at=NOW.isoformat(), lines=[dict(match={'access_item_id': 'A'})]))


def test_only_honor_official_event_normalizes_snapshot_line_authority():
    from pathlib import Path
    source = (Path(__file__).resolve().parents[1] / 'v3_main.py').read_text()
    start = source.index('if (event_type == "honor_official_statement_v1"')
    block = source[start:source.index('safe_result = jsonable_encoder(result)', start)]
    assert 'bill_type == "channel"' in block
    assert '.get("partner_name") == "荣耀"' in block
    assert 'apply_channel_line_fee_authority(conn, bill_type, bill_id, result)' in block
    assert 'attach_honor_source_revisions(conn, bill_id, result)' in block


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(unittest.FunctionTestCase(function) for name, function in list(globals().items())
                              if name.startswith('test_') and callable(function))
