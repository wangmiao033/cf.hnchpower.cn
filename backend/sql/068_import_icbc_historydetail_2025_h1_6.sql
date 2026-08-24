-- Final staging payload and one-time ICBC 2025-H1 import.

INSERT INTO tmp_icbc_historydetail_2025_h1
SELECT *
FROM jsonb_to_recordset($json$[{"d":"2025-01-23","f":"贷","c":"厦门维虎网络科技有限公司","p":"","s":"渠道款","r":"渠道款","e":null,"i":"1172.55","b":"182549.24","k":"c469275588fa4dc3814a498f0297619ac3f0171ebd6c44480e2cabaea040c504","n":252},{"d":"2025-01-22","f":"借","c":"待报解预算收入-社保A户","p":"1社保64756043","s":"1社保64756043","r":"1社保64756043","e":"9029.75","i":null,"b":"181376.69","k":"412b1bf7937c2c889a5b4caa36498438dd087699380e937ceee668d23bdca474","n":253},{"d":"2025-01-22","f":"贷","c":"支付宝（中国）网络技术有限公司","p":"","s":"早游戏熊动12月","r":"早游戏熊动12月","e":null,"i":"5440.07","b":"190406.44","k":"120ed8d70ee37af0463931487ebac4f5caad844c1a8fb2fbbc2cf620be3af48a","n":254},{"d":"2025-01-22","f":"贷","c":"武汉游趣互娱信息技术有限公司","p":"","s":"信息服务费２０２４０","r":"信息服务费２０２４０４－２０２４１１网银发起，有误即退。","e":null,"i":"606.94","b":"184966.37","k":"a14e1f405706c58511a6b36b488d80d2bb41388525e5cef84c80e6d1a9e40333","n":255},{"d":"2025-01-21","f":"借","c":"易玩（上海）网络科技有限公司","p":"推广费","s":"推广费","r":"","e":"10000.00","i":null,"b":"184359.43","k":"8a55d48f1a1cf4abbbd66cf50a5a5dba2b596fcf1c0f03f4ab8640908c764059","n":256},{"d":"2025-01-21","f":"贷","c":"厦门三七三三网络科技有限公司","p":"","s":"信息服务费","r":"信息服务费","e":null,"i":"4564.11","b":"194359.43","k":"8f5172e47da30ff330f1a62a538ee9c398b52b869eb414e36e1ee28ffb12aa31","n":257},{"d":"2025-01-21","f":"贷","c":"广州玺越网络科技有限公司","p":"","s":"结算款","r":"结算款","e":null,"i":"305.13","b":"189795.32","k":"edfc43e484f22295af334d991d3a36b00760ae05ce215fd06667054f89b60baf","n":258},{"d":"2025-01-18","f":"贷","c":"昆山爱趣网络科技有限公司","p":"","s":"信息服务费12月","r":"信息服务费12月","e":null,"i":"6001.57","b":"189490.19","k":"d5f3278a19abe210f5b8318f994fc9bbeac1c5d92474592932b9b09507e43909","n":259},{"d":"2025-01-17","f":"借","c":"","p":"","s":"工资","r":"","e":"33322.29","i":null,"b":"183488.62","k":"f9b2cdc1ca1c4220815996aca8cb1d5e6ab4a528a7f3d20c46ed6aa2fcf98d09","n":260},{"d":"2025-01-17","f":"贷","c":"广州闪趣网络科技有限公司","p":"结算款","s":"结算款","r":"","e":null,"i":"7024.36","b":"216810.91","k":"93ff8763b42e46ab2f3b09cf94d4a305d3354d8ab37f60bdeb189aef8bd3a4ed","n":261},{"d":"2025-01-16","f":"贷","c":"湖南芯动网络科技有限公司","p":"","s":"2024年12月分成款","r":"2024年12月分成款","e":null,"i":"2071.19","b":"209786.55","k":"f343ab172e8c27f9ee17bc5cdbbfea1151ee19d9059c2c58b9a94ce99ea9180f","n":262},{"d":"2025-01-15","f":"贷","c":"武汉曦晨互娱网络科技有限公司","p":"信息服务费","s":"信息服务费","r":"","e":null,"i":"4826.12","b":"207715.36","k":"ec4f65ab721dc6522db493d70448b08fbc44e7c952315a5bc47ac46da6705720","n":263},{"d":"2025-01-15","f":"贷","c":"广东天宸网络科技有限公司","p":"","s":"互联网分成款-游戏联","r":"互联网分成款-游戏联运-付广州熊动科技有限公司202412","e":null,"i":"341.57","b":"202889.24","k":"9d53be8907663a51ca4ab56a6c3b073e6b5b488e3a612d9a7c0fe95d98e831e6","n":264},{"d":"2025-01-15","f":"借","c":"待报解预算收入-待清算财税库银中转户","p":"代理国库税收收缴","s":"代理国库税收收缴","r":"30236203","e":"876.37","i":null,"b":"202547.67","k":"eb7f4dfe9c9759450ef71105e8abdf03b0810ca6eb37d90a629b8f27f35f08e4","n":265},{"d":"2025-01-15","f":"贷","c":"南阳百分网络科技有限公司","p":"","s":"合作分成","r":"合作分成","e":null,"i":"186.70","b":"203424.04","k":"83d11edcaa132720ed97a01f86bd2f717305dd59e90bc6d388e9d463d36a7a44","n":266},{"d":"2025-01-15","f":"借","c":"待报解预算收入-待清算财税库银中转户","p":"代理国库税收收缴","s":"代理国库税收收缴","r":"29840919","e":"2279.52","i":null,"b":"203237.34","k":"ef582a895abfaa5987e677a23d481516ad9aed5a1f3c7fb29fd60ff1327ffd68","n":267},{"d":"2025-01-13","f":"贷","c":"抖音支付科技有限公司","p":"","s":"贷记","r":"火山引擎企业实名收款认证","e":null,"i":"0.17","b":"205516.86","k":"9ee547dd5af4709ef1ae986994b26d5008ba7b7c31816dd31fadf8c25e21a141","n":268},{"d":"2025-01-10","f":"贷","c":"湖南天宇互动网络科技有限公司","p":"分成款2024年12月","s":"分成款2024年12月","r":"","e":null,"i":"2363.87","b":"205516.69","k":"26244819837ac7b64e0298a1936f98a96e005dafa77f683dc508d1e6f7b1aa8c","n":269},{"d":"2025-01-10","f":"贷","c":"华为软件技术有限公司","p":"","s":"贷记","r":"华为软件技术有限公司410054374","e":null,"i":"4.31","b":"203152.82","k":"acb8c38352c3f54c1706ba22d5aa3d66649a5322a3a37bb173b3a20e38bc4864","n":270},{"d":"2025-01-10","f":"贷","c":"广东安久科技有限公司","p":"","s":"202411信息服务费","r":"202411信息服务费","e":null,"i":"7787.45","b":"203148.51","k":"d76d780efe670387e27f18a34e7c526378ffb29bf059f4415667fd967afc8dfa","n":271},{"d":"2025-01-09","f":"借","c":"成都华联互娱科技有限公司","p":"广告费","s":"广告费","r":"","e":"20000.00","i":null,"b":"195361.06","k":"3ba3e67f02acce1816c03e19c5bb616485108897f6f9b35c7f3f3a42a0d74552","n":272},{"d":"2025-01-09","f":"贷","c":"昆山爱趣网络科技有限公司","p":"","s":"信息服务费 11月","r":"信息服务费 11月","e":null,"i":"24929.16","b":"215361.06","k":"ea7eb4eff8fbea89d0ac881d69fdd99d047eccb2fed4da892ac5c0f6462175b8","n":273},{"d":"2025-01-09","f":"贷","c":"平台交易资金待清算专户（荣耀云业务）","p":"","s":"深圳荣耀软件技术有限","r":"深圳荣耀软件技术有限公司","e":null,"i":"4431.56","b":"190431.90","k":"51ab6ef865b7837c4392b3ad8554f71e3774c85f00262675637f7a57b4e901c6","n":274},{"d":"2025-01-09","f":"贷","c":"上海电银信息技术有限公司备付金","p":"","s":"贷记","r":"872581473920007-0109/0.00","e":null,"i":"68.15","b":"186000.34","k":"df98811bb519f0fa53ee8d502e6662df251d23e0a40a649c9e20d33934fb25d9","n":275},{"d":"2025-01-08","f":"贷","c":"成都华联互娱科技有限公司","p":"","s":"信息服务费","r":"信息服务费","e":null,"i":"28329.05","b":"185932.19","k":"3401ce9d5c30e44f960a5cec311262070b4c0d6b677323c9cefa69ee743ceb3a","n":276},{"d":"2025-01-08","f":"贷","c":"上海趣朗网络科技有限公司","p":"","s":"信息服务费","r":"信息服务费","e":null,"i":"1082.07","b":"157603.14","k":"7ce936fcf707a066479fc253d9ab97e89934791fbb13c2613213e766f9d95891","n":277},{"d":"2025-01-08","f":"贷","c":"广州爱九游信息技术有限公司","p":"","s":"P1057364161","r":"P1057364161","e":null,"i":"391.27","b":"156521.07","k":"3c08930b58a4c921c802f21a9b31125e1e865069f37993f52ab5072297a0c66f","n":278},{"d":"2025-01-03","f":"贷","c":"西安炳烈网络科技有限公司","p":"","s":"3011CP结算2024.8-11","r":"3011CP结算2024.8-11","e":null,"i":"218.17","b":"156129.80","k":"2b33ab9859947ca702b8cfd7599b0fe1c8f8f153610fb4383889b80acaec9c39","n":279},{"d":"2025-01-03","f":"贷","c":"陕西翱游网络科技有限公司","p":"","s":"发行款","r":"发行款","e":null,"i":"151.18","b":"155911.63","k":"be67901de9782062a497dd50004a80b163f0455066c4d5045f75642059c8a2cb","n":280},{"d":"2025-01-02","f":"借","c":"中国电信股份有限公司广州分公司","p":"","s":"电信","r":"","e":"399.00","i":null,"b":"155760.45","k":"f04a542877472f32c2cd4e0d9d78390bf5c17e486743a8eda9969ff8b5049a77","n":281}]$json$) AS x(
  d TEXT, f TEXT, c TEXT, p TEXT, s TEXT, r TEXT,
  e NUMERIC(18,2), i NUMERIC(18,2), b NUMERIC(18,2), k TEXT, n INTEGER
);

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM tmp_icbc_historydetail_2025_h1) <> 280 THEN
    RAISE EXCEPTION 'ICBC 2025-H1 import payload row-count mismatch';
  END IF;
END $$;

WITH account_choice AS (
  SELECT COALESCE(
    (
      SELECT bank_account
      FROM bank_transactions
      WHERE type = 'statement_import'
        AND UPPER(COALESCE(source_bank, '')) = 'ICBC'
        AND NULLIF(TRIM(bank_account), '') IS NOT NULL
      GROUP BY bank_account
      ORDER BY COUNT(*) DESC, MAX(created_at) DESC
      LIMIT 1
    ),
    '3602841509200157769'
  ) AS bank_account
)
INSERT INTO bank_transactions (
  id, type, trade_date, bank_account,
  payer_name, payer_account, payer_bank_name,
  payee_name, payee_account, payee_bank_name,
  amount, income_amount, expense_amount, balance, currency,
  transaction_no, instruction_no, summary, purpose, remark, status, raw_text,
  attachment_url, source_bank, source_file_name, source_row_no, dedupe_key,
  import_batch_id, reconciliation_id, reconciliation_type, reconciliation_no, linked_amount
)
SELECT
  'icbc-' || src.k,
  'statement_import',
  src.d,
  account_choice.bank_account,
  CASE WHEN src.f = '贷' THEN NULLIF(src.c, '') ELSE NULL END,
  NULL,
  NULL,
  CASE WHEN src.f = '借' THEN NULLIF(src.c, '') ELSE NULL END,
  NULL,
  NULL,
  COALESCE(src.i, src.e),
  src.i,
  src.e,
  src.b,
  'CNY',
  NULL,
  NULL,
  NULLIF(src.s, ''),
  NULLIF(src.p, ''),
  NULLIF(src.r, ''),
  NULL,
  CONCAT_WS(E'\n',
    '交易日期: ' || src.d,
    '借贷标志: ' || src.f,
    CASE WHEN src.c <> '' THEN '对方单位: ' || src.c END,
    CASE WHEN src.p <> '' THEN '用途: ' || src.p END,
    CASE WHEN src.s <> '' THEN '摘要: ' || src.s END,
    CASE WHEN src.r <> '' THEN '附言: ' || src.r END,
    CASE WHEN src.e IS NOT NULL THEN '转出金额: ' || src.e::TEXT END,
    CASE WHEN src.i IS NOT NULL THEN '转入金额: ' || src.i::TEXT END,
    CASE WHEN src.b IS NOT NULL THEN '余额: ' || src.b::TEXT END
  ),
  NULL,
  'ICBC',
  'HISTORYDETAIL_2025-01_to_2025-06.xlsx',
  src.n,
  src.k,
  'icbc-historydetail-2025h1-97ae186d',
  NULL,
  NULL,
  NULL,
  NULL
FROM tmp_icbc_historydetail_2025_h1 AS src
CROSS JOIN account_choice
ON CONFLICT DO NOTHING;

WITH account_choice AS (
  SELECT COALESCE(
    (
      SELECT bank_account
      FROM bank_transactions
      WHERE type = 'statement_import'
        AND UPPER(COALESCE(source_bank, '')) = 'ICBC'
        AND NULLIF(TRIM(bank_account), '') IS NOT NULL
      GROUP BY bank_account
      ORDER BY COUNT(*) DESC, MAX(created_at) DESC
      LIMIT 1
    ),
    '3602841509200157769'
  ) AS bank_account
),
stats AS (
  SELECT COUNT(*) FILTER (
    WHERE import_batch_id = 'icbc-historydetail-2025h1-97ae186d'
  )::INTEGER AS inserted
  FROM bank_transactions
  WHERE dedupe_key IN (SELECT k FROM tmp_icbc_historydetail_2025_h1)
),
source_totals AS (
  SELECT
    COALESCE(SUM(i), 0)::NUMERIC(18,2) AS income_total,
    COALESCE(SUM(e), 0)::NUMERIC(18,2) AS expense_total,
    MIN(d) AS date_from,
    MAX(d) AS date_to
  FROM tmp_icbc_historydetail_2025_h1
)
INSERT INTO bank_import_batches (
  id, source_bank, source_file_name, source_sheet_name, bank_account,
  total, inserted, duplicates, invalid, income_total, expense_total,
  date_from, date_to, duplicate_row_nos, invalid_row_nos, legacy_backfill
)
SELECT
  'icbc-historydetail-2025h1-97ae186d',
  'ICBC',
  'HISTORYDETAIL_2025-01_to_2025-06.xlsx',
  'Sheet0',
  account_choice.bank_account,
  280,
  stats.inserted,
  280 - stats.inserted,
  0,
  source_totals.income_total,
  source_totals.expense_total,
  source_totals.date_from,
  source_totals.date_to,
  '[]'::jsonb,
  '[]'::jsonb,
  FALSE
FROM account_choice, stats, source_totals
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  present_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO present_count
  FROM tmp_icbc_historydetail_2025_h1 AS src
  WHERE EXISTS (
    SELECT 1
    FROM bank_transactions AS existing
    WHERE existing.dedupe_key = src.k
  );
  IF present_count <> 280 THEN
    RAISE EXCEPTION USING MESSAGE = 'ICBC 2025-H1 import integrity check failed: expected 280 rows, found ' || present_count::TEXT;
  END IF;
END $$;
