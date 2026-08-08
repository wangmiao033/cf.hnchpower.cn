-- Backfill channel bill header totals from authoritative multi-game line items.
--
-- Historical rows created while the channel ledger was moving from flat
-- records to channel_record_line_items can have valid line items but stale
-- zero values on channel_records. Those header fields are consumed by bank
-- auto-reconciliation, monthly business dashboards and other rollups, so keep
-- them aligned with the detail rows.

WITH line_rollup AS (
  SELECT
    channel_record_id,
    ROUND(SUM(COALESCE(billing_flow, 0) * COALESCE(discount_factor, 1)), 2) AS billing_flow,
    SUM(COALESCE(voucher_cost, 0)) AS voucher_cost,
    SUM(COALESCE(no_worry_cost, 0)) AS no_worry_cost,
    SUM(COALESCE(refund_cost, 0)) AS refund_cost,
    SUM(COALESCE(test_cost, 0)) AS test_cost,
    SUM(COALESCE(welfare_cost, 0)) AS welfare_cost,
    SUM(COALESCE(billing_amount, 0)) AS billing_amount,
    SUM(COALESCE(share_amount, 0)) AS share_amount,
    SUM(COALESCE(gateway_cost, 0)) AS gateway_cost,
    SUM(COALESCE(settlement_amount, 0)) AS settlement_amount,
    (ARRAY_AGG(COALESCE(tax_rate, 0) ORDER BY sort_order))[1] AS tax_rate,
    (ARRAY_AGG(COALESCE(share_rate, 0) ORDER BY sort_order))[1] AS share_rate,
    STRING_AGG(NULLIF(BTRIM(game_name), ''), '、' ORDER BY sort_order)
      FILTER (WHERE NULLIF(BTRIM(game_name), '') IS NOT NULL) AS game_name
  FROM channel_record_line_items
  GROUP BY channel_record_id
)
UPDATE channel_records AS record
SET
  billing_flow = rollup.billing_flow,
  voucher_cost = rollup.voucher_cost,
  no_worry_cost = rollup.no_worry_cost,
  refund_cost = rollup.refund_cost,
  test_cost = rollup.test_cost,
  welfare_cost = rollup.welfare_cost,
  billing_amount = rollup.billing_amount,
  share_amount = rollup.share_amount,
  gateway_cost = rollup.gateway_cost,
  settlement_amount = rollup.settlement_amount,
  tax_rate = rollup.tax_rate,
  share_rate = rollup.share_rate,
  game_name = NULLIF(LEFT(COALESCE(rollup.game_name, ''), 2000), ''),
  receipt_status = CASE
    WHEN COALESCE(record.received_amount, 0) + 0.000000001 >= rollup.settlement_amount THEN 'paid'
    WHEN COALESCE(record.received_amount, 0) <= 0 THEN 'unpaid'
    ELSE 'partial'
  END,
  updated_at = NOW()
FROM line_rollup AS rollup
WHERE record.id = rollup.channel_record_id;
