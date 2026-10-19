"""Honor-specific official-source policy; calculations and other channels stay unchanged."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock, patch

import unittest
from functools import partial, update_wrapper
from fastapi import HTTPException

from app.api.bill_lifecycle import ApprovedPlatformVarianceRequest, confirm_approved_channel_platform_variance
from app.services.honor_official_statement import (
    POLICY_CODE, resolve_honor_policy, validate_official_line_confirmations,
    validate_contract_snapshot, official_amount_case_ids,
)
from app.services.channel_platform_variance_approval import assess_channel_platform_variance
from app.services.channel_settlement_engine import aggregate_validation, calculate_channel_line
from test_channel_platform_variance_approval import bill_and_lines

def cases(name, values):
    def decorate(function):
        function.test_cases = values
        return function
    return decorate


NOW = datetime(2026, 10, 19, 9, 0, tzinfo=timezone.utc)


def honor_fixture(september=False):
    bill, lines = bill_and_lines()
    bill.id = 'honor-bill'
    bill.partner_name = bill.channel_name = '荣耀'
    bill.statement_no = 'TEST-HONOR'
    bill.updated_at = NOW - timedelta(minutes=1)
    if september:
        for line, flow, platform in zip(lines, ['1494.35', '4331.05'], ['1494.46', '4328.09']):
            line.billing_flow = Decimal(flow)
            line.platform_settlement_amount = Decimal(platform)
            line.settlement_cycle = '2026-09'
            for key, value in calculate_channel_line(line, bill).items():
                setattr(line, key, value)
        total = aggregate_validation(lines, bill)
        for attr, key in [('system_settlement_amount', 'system_total'), ('platform_settlement_amount', 'platform_total'),
                          ('settlement_difference', 'difference_total'), ('settlement_amount', 'settlement_total'),
                          ('validation_status', 'validation_status')]:
            setattr(bill, attr, total[key])
    return bill, lines


def confirmations(lines):
    return [dict(line_id=l.id, game_name=l.game_name, settlement_cycle=l.settlement_cycle,
                 system_amount=float(l.system_settlement_amount), platform_amount=float(l.platform_settlement_amount)) for l in lines]


def snapshot_fixture(bill, lines):
    checked = [dict(line_id=l.id, game_name=l.game_name, settlement_cycle=l.settlement_cycle,
                    match=dict(contract_id='C', access_item_id='A' + l.id, confidence='high'),
                    checks=[dict(key='authorization', status='pass'), dict(key='share_rate', status='pass'),
                            dict(key='contract_standard_settlement', status='fail')],
                    contract_amount=dict(actual_amount=float(l.platform_settlement_amount),
                                         expected_amount=float(l.system_settlement_amount),
                                         supported=True, deterministic=True)) for l in lines]
    snap = dict(id='snapshot', bill_type='channel', bill_id=bill.id, event_type=POLICY_CODE,
                created_at=NOW, result_json=dict(lines=checked, bill_checks=[]))
    contracts = [dict(access_item_id='A' + l.id, contract_id='C', partner_id='HONOR-ID', counterparty='荣耀',
                      access_updated_at=NOW - timedelta(days=1), contract_updated_at=NOW - timedelta(days=1),
                      terms_updated_at=NOW - timedelta(days=1)) for l in lines]
    snap['result_json']['honor_source_revisions'] = {row['access_item_id']: deepcopy(row) for row in contracts}
    snap['result_json']['honor_binding_revisions'] = {}
    return snap, contracts


def assert_code(code, function, *args, **kwargs):
    with unittest.TestCase().assertRaises(HTTPException) as caught:
        function(*args, **kwargs)
    assert caught.exception.detail['error'] == code


def test_exact_unique_master_customer_required_and_id_returned():
    bill, _ = honor_fixture()
    db = Mock()
    db.execute.return_value.mappings.return_value.all.return_value = [dict(id='HONOR-ID', name='荣耀', category='渠道')]
    assert resolve_honor_policy(db, bill)['partner_id'] == 'HONOR-ID'
    for name in ['荣耀游戏', '深圳市荣耀软件技术有限公司', '小米', '']:
        bill.partner_name = name
        db.reset_mock()
        assert resolve_honor_policy(db, bill) is None
        db.execute.assert_not_called()
    bill.partner_name = '荣耀'
    bill.channel_name = '其他渠道'
    assert resolve_honor_policy(db, bill) is None


@cases('rows', [[], [dict(id='1', category='渠道'), dict(id='2', category='渠道')], [dict(id='1', category='研发商')]])
def test_missing_duplicate_or_wrong_category_fails_closed(rows):
    bill, _ = honor_fixture()
    db = Mock()
    db.execute.return_value.mappings.return_value.all.return_value = rows
    assert_code('honor_customer_ambiguous', resolve_honor_policy, db, bill)


def test_august_and_september_are_source_backed_not_false_pass():
    for september, expected in [(False, 4801.48), (True, 5822.55)]:
        bill, lines = honor_fixture(september)
        before = deepcopy([vars(bill), *[vars(l) for l in lines]])
        result = assess_channel_platform_variance(bill, lines, allow_documented_variance=True, official_statement=True)
        assert result['recorded_settlement_amount'] == expected
        assert result['review_kind'] == 'documented'
        assert bill.validation_status == 'fail'
        assert [vars(bill), *[vars(l) for l in lines]] == before
    assert result['absolute_line_difference_cents'] == 307
    assert result['signed_difference_cents'] == 285
    assert_code('platform_variance_offsetting', assess_channel_platform_variance, bill, lines, allow_documented_variance=True)


def test_complete_per_game_attestation_cannot_be_substituted_by_total():
    _, lines = honor_fixture(True)
    evidence = confirmations(lines)
    validate_official_line_confirmations(lines, evidence)
    assert_code('honor_lines_not_confirmed', validate_official_line_confirmations, lines, evidence[:1])
    evidence[0]['platform_amount'] += 1
    evidence[1]['platform_amount'] -= 1
    assert_code('honor_line_review_stale', validate_official_line_confirmations, lines, evidence)


def test_missing_official_amount_never_falls_back_to_formula():
    bill, lines = honor_fixture()
    lines[0].platform_settlement_amount = None
    assert_code('platform_variance_missing_platform', assess_channel_platform_variance, bill, lines,
                allow_documented_variance=True, official_statement=True)


def test_server_snapshot_complete_fresh_contract_evidence_is_required():
    bill, lines = honor_fixture(True)
    snap, contracts = snapshot_fixture(bill, lines)
    validate_contract_snapshot(snap, bill, lines, contracts, 'HONOR-ID', now=NOW)
    snap['created_at'] = NOW - timedelta(minutes=11)
    assert_code('honor_contract_snapshot_stale', validate_contract_snapshot, snap, bill, lines, contracts, 'HONOR-ID', now=NOW)


@cases('mutation', ['wrong_bill', 'wrong_type', 'wrong_event', 'bill_changed', 'missing_line', 'wrong_line',
                                     'wrong_amount', 'wrong_game', 'wrong_month', 'authorization', 'rate', 'identity',
                                     'unmatched', 'nondeterministic', 'wrong_customer', 'changed_contract', 'changed_terms'])
def test_snapshot_does_not_waive_non_amount_guards(mutation):
    bill, lines = honor_fixture()
    snap, contracts = snapshot_fixture(bill, lines)
    row = snap['result_json']['lines'][0]
    if mutation == 'wrong_bill': snap['bill_id'] = 'different'
    elif mutation == 'wrong_type': snap['bill_type'] = 'rd'
    elif mutation == 'wrong_event': snap['event_type'] = 'confirmed'
    elif mutation == 'bill_changed': bill.updated_at = NOW + timedelta(seconds=1)
    elif mutation == 'missing_line': snap['result_json']['lines'].pop()
    elif mutation == 'wrong_line': row['line_id'] = 'other'
    elif mutation == 'wrong_amount': row['contract_amount']['actual_amount'] += 1
    elif mutation == 'wrong_game': row['game_name'] = '其他游戏'
    elif mutation == 'wrong_month': row['settlement_cycle'] = '2025-08'
    elif mutation == 'authorization': row['checks'][0]['status'] = 'missing'
    elif mutation == 'rate': row['checks'][1]['status'] = 'fail'
    elif mutation == 'identity': row['match']['confidence'] = 'low'
    elif mutation == 'unmatched': row['match'] = {}
    elif mutation == 'nondeterministic': row['contract_amount']['deterministic'] = False
    elif mutation == 'wrong_customer': contracts[0]['partner_id'] = 'OTHER'
    elif mutation == 'changed_contract': contracts[0]['contract_updated_at'] = NOW + timedelta(seconds=1)
    elif mutation == 'changed_terms': contracts[0]['terms_updated_at'] = NOW + timedelta(seconds=1)
    with unittest.TestCase().assertRaises(HTTPException):
        validate_contract_snapshot(snap, bill, lines, contracts, 'HONOR-ID', now=NOW)


def test_active_workflows_and_rate_cases_are_not_overridden():
    _, lines = honor_fixture()
    case = dict(id='CASE', line_id='L1', game_name=lines[0].game_name, settlement_cycle=lines[0].settlement_cycle,
                status='pending', handling_type=None, source_snapshot_json=dict(checks=[dict(key='contract_standard_settlement', status='fail')]))
    assert official_amount_case_ids([case], lines) == ['CASE']
    for handling in ['edit_bill', 'adjustment', 'carry_forward']:
        case['handling_type'] = handling
        assert_code('honor_contract_workflow_open', official_amount_case_ids, [case], lines)
    case['handling_type'] = None
    case['source_snapshot_json']['checks'].append(dict(key='share_rate', status='fail'))
    assert_code('honor_contract_workflow_open', official_amount_case_ids, [case], lines)


def test_endpoint_rechecks_customer_and_requires_source_and_every_line():
    bill, lines = honor_fixture(True)
    review = assess_channel_platform_variance(bill, lines, allow_documented_variance=True, official_statement=True)
    args = dict(reason='已逐游戏核对荣耀官方结算单，保留公式差异', expected_system_amount=review['system_amount'],
                expected_platform_amount=review['platform_amount'], expected_settlement_amount=review['recorded_settlement_amount'],
                expected_signed_difference_cents=review['signed_difference_cents'], expected_line_ids=review['line_ids'],
                official_statement_policy=POLICY_CODE, expected_partner_id='HONOR-ID', official_statement_reason='逐游戏核对荣耀官方九月结算单',
                official_line_confirmations=confirmations(lines))
    def database():
        db = Mock()
        db.execute.return_value.scalar_one_or_none.return_value = bill
        db.execute.return_value.scalars.return_value.all.return_value = lines
        return db
    user = SimpleNamespace(role='admin', id='ADMIN', email='admin@example.test')
    with patch('app.api.bill_lifecycle.resolve_honor_policy', return_value={'code': POLICY_CODE, 'partner_id': 'HONOR-ID'}):
        db = database()
        assert_code('documented_platform_attestation_required', confirm_approved_channel_platform_variance,
                    bill.id, ApprovedPlatformVarianceRequest(**args), db=db, user=user)
        db.add.assert_not_called()
        assert_code('documented_platform_attachment_required', confirm_approved_channel_platform_variance,
                    bill.id, ApprovedPlatformVarianceRequest(**args, evidence_confirmed=True), db=database(), user=user)
        args['expected_partner_id'] = 'OTHER'
        assert_code('honor_policy_identity_mismatch', confirm_approved_channel_platform_variance,
                    bill.id, ApprovedPlatformVarianceRequest(**args), db=database(), user=user)


def test_removed_terms_or_binding_invalidates_snapshot():
    bill, lines = honor_fixture()
    snap, contracts = snapshot_fixture(bill, lines)
    contracts[0]['terms_updated_at'] = None
    assert_code('honor_contract_changed', validate_contract_snapshot, snap, bill, lines, contracts, 'HONOR-ID', now=NOW)
    snap, contracts = snapshot_fixture(bill, lines)
    snap['result_json']['honor_binding_revisions'] = {'L1': dict(access_item_id='AL1', updated_at=NOW)}
    assert_code('honor_contract_binding_changed', validate_contract_snapshot, snap, bill, lines, contracts, 'HONOR-ID', now=NOW, current_links={})


def test_successful_endpoint_audits_case_and_confirms_without_amount_mutation():
    bill, lines = honor_fixture(True)
    review = assess_channel_platform_variance(bill, lines, allow_documented_variance=True, official_statement=True)
    payload = ApprovedPlatformVarianceRequest(
        reason='管理员逐游戏核对荣耀官方结算单，金额差异保留备查',
        expected_system_amount=review['system_amount'], expected_platform_amount=review['platform_amount'],
        expected_settlement_amount=review['recorded_settlement_amount'], expected_signed_difference_cents=285,
        expected_line_ids=review['line_ids'], official_statement_policy=POLICY_CODE, expected_partner_id='HONOR-ID',
        official_statement_reason='逐游戏核对荣耀官方九月结算单', official_line_confirmations=confirmations(lines),
        evidence_confirmed=True, evidence_attachment_id='ATT', contract_snapshot_id='SNAP')
    db = Mock()
    db.info = {}
    db.execute.return_value.scalar_one_or_none.side_effect = [bill, SimpleNamespace(id='ATT', file_name='sep.pdf'), 'cf_contract_difference_cases']
    db.execute.return_value.scalars.return_value.all.return_value = lines
    db.execute.return_value.mappings.return_value.all.return_value = [dict(
        id='CASE', line_id='L1', game_name=lines[0].game_name, settlement_cycle=lines[0].settlement_cycle,
        status='pending', handling_type=None, source_snapshot_json=dict(checks=[dict(key='contract_standard_settlement', status='fail')]))]
    db.execute.return_value.rowcount = 1
    before = deepcopy([vars(bill), *[vars(l) for l in lines]])
    with patch('app.api.bill_lifecycle.resolve_honor_policy', return_value={'code': POLICY_CODE, 'partner_id': 'HONOR-ID'}), \
         patch('app.api.bill_lifecycle.load_and_validate_contract_snapshot', return_value={'id': 'SNAP'}) as snapshot_check, \
         patch('app.api.bill_lifecycle.transition_bill') as transition, \
         patch('app.api.bill_lifecycle._snapshot', return_value={'status': 'confirmed'}), \
         patch('app.api.bill_lifecycle.BillLifecycleRead.model_validate', side_effect=lambda result: result):
        actor = SimpleNamespace(role='admin', id='ADMIN', email='admin@example.test')
        result = confirm_approved_channel_platform_variance(bill.id, payload, db=db, user=actor)
        assert result['status'] == 'confirmed'
        snapshot_check.assert_called_once_with(db, 'SNAP', bill, lines, 'HONOR-ID')
        transition.assert_called_once_with(db, 'channel', bill, 'confirmed', payload.reason, actor)
    assert [vars(bill), *[vars(l) for l in lines]] == before
    log = db.add.call_args.args[0]
    assert log.action == 'honor_official_statement_confirm'
    assert log.metadata_json['accepted_contract_case_ids'] == ['CASE']
    assert log.metadata_json['evidence_attachment_id'] == 'ATT'
    assert log.metadata_json['official_line_confirmations'] == confirmations(lines)
    assert 'allow_lifecycle_transition' not in db.info
    sql = '\n'.join(str(call.args[0]) for call in db.execute.call_args_list)
    assert 'FOR UPDATE' in sql and 'cf_contract_difference_events' in sql


def test_concurrent_case_workflow_change_rolls_back_and_never_confirms():
    bill, lines = honor_fixture()
    review = assess_channel_platform_variance(bill, lines, allow_documented_variance=True, official_statement=True)
    payload = ApprovedPlatformVarianceRequest(
        reason='管理员逐游戏核对荣耀官方结算单，金额差异保留备查',
        expected_system_amount=review['system_amount'], expected_platform_amount=review['platform_amount'],
        expected_settlement_amount=review['recorded_settlement_amount'], expected_signed_difference_cents=-21,
        expected_line_ids=review['line_ids'], official_statement_policy=POLICY_CODE, expected_partner_id='HONOR-ID',
        official_statement_reason='逐游戏核对荣耀官方八月结算单', official_line_confirmations=confirmations(lines),
        evidence_confirmed=True, evidence_attachment_id='ATT', contract_snapshot_id='SNAP')
    db = Mock(); db.info = {}
    db.execute.return_value.scalar_one_or_none.side_effect = [bill, SimpleNamespace(id='ATT', file_name='aug.pdf'), 'cf_contract_difference_cases']
    db.execute.return_value.scalars.return_value.all.return_value = lines
    db.execute.return_value.mappings.return_value.all.return_value = [dict(
        id='CASE', game_name=lines[0].game_name, settlement_cycle=lines[0].settlement_cycle,
        status='pending', handling_type=None, source_snapshot_json=dict(checks=[dict(key='contract_standard_settlement', status='fail')]))]
    db.execute.return_value.rowcount = 0
    with patch('app.api.bill_lifecycle.resolve_honor_policy', return_value={'code': POLICY_CODE, 'partner_id': 'HONOR-ID'}), \
         patch('app.api.bill_lifecycle.load_and_validate_contract_snapshot', return_value={'id': 'SNAP'}), \
         patch('app.api.bill_lifecycle.transition_bill') as transition:
        assert_code('honor_contract_case_changed', confirm_approved_channel_platform_variance, bill.id, payload,
                    db=db, user=SimpleNamespace(role='admin', id='ADMIN', email='admin@example.test'))
        transition.assert_not_called()
    db.rollback.assert_called_once()
    db.add.assert_not_called()



def test_common_lifecycle_guard_never_confirms_missing_honor_official_input():
    from app.services.bill_lifecycle import _transition_guard
    bill, lines = honor_fixture()
    bill.line_items = lines
    user = SimpleNamespace(role='admin')
    with patch('app.services.bill_lifecycle._base_bill_is_complete', return_value=(True, None)), \
         patch('app.services.honor_official_statement.resolve_honor_policy', return_value={'partner_id': 'HONOR-ID'}):
        assert _transition_guard(Mock(), 'channel', bill, 'pending', 'confirmed', user) is None
        lines[0].platform_settlement_amount = Decimal('0.00')
        assert _transition_guard(Mock(), 'channel', bill, 'pending', 'confirmed', user) is None
        lines[0].platform_settlement_amount = None
        assert '不能用公式金额代替' in _transition_guard(Mock(), 'channel', bill, 'pending', 'confirmed', user)
    with patch('app.services.bill_lifecycle._base_bill_is_complete', return_value=(True, None)), \
         patch('app.services.honor_official_statement.resolve_honor_policy', return_value=None):
        assert _transition_guard(Mock(), 'channel', bill, 'pending', 'confirmed', user) is None

    with patch('app.services.bill_lifecycle._base_bill_is_complete', return_value=(True, None)), \
         patch('app.services.honor_official_statement.resolve_honor_policy', side_effect=HTTPException(status_code=409, detail={'message': '荣耀客户不唯一'})):
        assert _transition_guard(Mock(), 'channel', bill, 'pending', 'confirmed', user) == '荣耀客户不唯一'


def load_tests(loader, tests, pattern):
    suite = unittest.TestSuite()
    for name, function in list(globals().items()):
        if name.startswith('test_') and callable(function):
            values = getattr(function, 'test_cases', None)
            if values is None:
                suite.addTest(unittest.FunctionTestCase(function))
            else:
                for value in values:
                    suite.addTest(unittest.FunctionTestCase(update_wrapper(partial(function, value), function), description=f'{name}: {value}'))
    return suite
