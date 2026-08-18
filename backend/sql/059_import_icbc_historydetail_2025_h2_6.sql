-- Continue one-time ICBC 2025-H2 staging payload.

INSERT INTO tmp_icbc_historydetail_2025_h2
SELECT *
FROM jsonb_to_recordset($json$[{"d":"2025-07-30","dt":"2025-07-30 13:06:15","f":"贷","c":"西安游海网络科技有限公司","p":"","s":"2025.06月结算款","r":"2025.06月结算款","e":null,"i":"2696.70","b":"222443.52","k":"fd62083d99fcfb488aead682433d70b5525ff52d63e251a0c2d61bf9b922d8fb","n":223},{"d":"2025-07-29","dt":"2025-07-29 17:43:00","f":"贷","c":"广州网易计算机系统有限公司","p":"","s":"pay","r":"pay","e":null,"i":"340.10","b":"219746.82","k":"3b1810dc08e9b25966cd6c387a8b9c145786f0a7d44671f813790049d260a2b9","n":224},{"d":"2025-07-29","dt":"2025-07-29 12:59:00","f":"贷","c":"昆山爱趣网络科技有限公司","p":"","s":"信息服务费","r":"信息服务费","e":null,"i":"23897.72","b":"219406.72","k":"cbf7924436779d88bf82cb6c3f5e96f91fc5cbae88a3c83d3855a650b3351a2f","n":225},{"d":"2025-07-29","dt":"2025-07-29 11:58:35","f":"贷","c":"广州网易计算机系统有限公司","p":"","s":"pay","r":"pay","e":null,"i":"8.55","b":"195509.00","k":"0d6020732f4d499fda8cc5aa683e0783e1b8443f560e707a83a3d0431e411991","n":226},{"d":"2025-07-29","dt":"2025-07-29 11:58:30","f":"贷","c":"广州网易计算机系统有限公司","p":"","s":"pay","r":"pay","e":null,"i":"580.45","b":"195500.45","k":"51d8a8c0b7dd15659e8086edc6a54d15eac19fb494a3279d6e15c7377994d6f2","n":227},{"d":"2025-07-29","dt":"2025-07-29 11:44:22","f":"贷","c":"河南炽梦网络科技有限公司","p":"","s":"业务","r":"业务","e":null,"i":"1872.44","b":"194920.00","k":"6cfa2476c4f2e99ef91d62afc824c32e2a838c67429ef4916ec5d319f3decbe6","n":228},{"d":"2025-07-28","dt":"2025-07-28 21:51:39","f":"贷","c":"支付宝（中国）网络技术有限公司","p":"","s":"贷记","r":"上海奇晋熊动（折扣）4月和6月","e":null,"i":"9508.35","b":"193047.56","k":"19f152953a876a4ac60ca91dbf33cf04239e808b21a57de4a7f79476662bbac7","n":229},{"d":"2025-07-25","dt":"2025-07-25 18:38:58","f":"借","c":"广州住房公积金管理中心","p":"","s":"1201058957","r":"1201058957","e":"2400.00","i":null,"b":"183539.21","k":"40e980b018c5d4f6515b0618e137434e8729b241742b79c784b9178ef1c5c84a","n":230},{"d":"2025-07-25","dt":"2025-07-25 14:51:46","f":"借","c":"待报解预算收入-社保A户","p":"1社保67551928","s":"1社保67551928","r":"1社保67551928","e":"7233.40","i":null,"b":"185939.21","k":"fed987d095d75c918021055a2a7da4db2e2293e15e3d95375c8bae5380807c02","n":231},{"d":"2025-07-24","dt":"2025-07-24 19:26:05","f":"贷","c":"厦门游戏之家科技有限公司","p":"","s":"CWDG25074534","r":"CWDG25074534","e":null,"i":"26582.40","b":"193172.61","k":"0fb54d9cc131015b2302c41e9c3109d76c7dc58e088ea46d131df83951077963","n":232},{"d":"2025-07-24","dt":"2025-07-24 17:56:30","f":"贷","c":"广州南游网络科技有限公司","p":"","s":"202506月信息服务费","r":"202506月信息服务费","e":null,"i":"11267.41","b":"166590.21","k":"9f0848840a534cc53d1401a3e9b51975564c0d3f5ad7bc5b68b192f6d3271baa","n":233},{"d":"2025-07-24","dt":"2025-07-24 16:02:20","f":"贷","c":"厦门巴掌互动科技有限公司","p":"","s":"信息服务费","r":"信息服务费","e":null,"i":"1422.14","b":"155322.80","k":"e3a6ee2370dfed8835838742c0fb3e0cc8364fda096ac4b76b63c0320dfd1b64","n":234},{"d":"2025-07-23","dt":"2025-07-23 20:40:19","f":"贷","c":"长沙掌控智能科技有限公司","p":"","s":"信息服务费","r":"信息服务费","e":null,"i":"1553.81","b":"153900.66","k":"3eee3008d6e0d264de3cc9f151568dc07477b65fbe573ca583a9ca42bc012854","n":235},{"d":"2025-07-23","dt":"2025-07-23 18:08:57","f":"贷","c":"杭州速发网络科技有限公司","p":"25年6月回款","s":"25年6月回款","r":"","e":null,"i":"482.54","b":"152346.85","k":"1552f43dd182377b2ce6bfbc59eb6b557ac8cd6dd00ebebfce61646ddbccceb2","n":236},{"d":"2025-07-22","dt":"2025-07-22 15:29:32","f":"借","c":"对公工行证书收入","p":"","s":"","r":"","e":"100.00","i":null,"b":"151864.31","k":"9542baf43ef1616f324128c155dfd2554dee38f4bccaecfcbc516840d9f8badc","n":237},{"d":"2025-07-22","dt":"2025-07-22 11:48:10","f":"贷","c":"西安维真视界文化科技股份有限公司","p":"","s":"发行款","r":"发行款","e":null,"i":"180.22","b":"151964.31","k":"3fc05d50fe7b7f69542770bbca57d30d85e27e8f07262f43caf275ec90411e83","n":238},{"d":"2025-07-21","dt":"2025-07-21 14:42:20","f":"贷","c":"北京龙威互动科技有限公司","p":"","s":"FS202506230083","r":"FS202506230083","e":null,"i":"353.48","b":"151784.09","k":"320b3cff17ac351e85c1bfc81c9e11ff5c0c8297f6449f1cca2c799d934bc71a","n":239},{"d":"2025-07-18","dt":"2025-07-18 18:46:50","f":"贷","c":"湖南天宇互动网络科技有限公司","p":"分成款2025年6月","s":"分成款2025年6月","r":"","e":null,"i":"366.70","b":"151430.61","k":"0d74e4e7580de3c92cf036cf0a0c35758e64b5d5d3289a83c4861d1c06e8adc8","n":240},{"d":"2025-07-18","dt":"2025-07-18 16:17:00","f":"贷","c":"西安炳烈网络科技有限公司","p":"","s":"3011CP结算2024.12.20","r":"3011CP结算2024.12.2025.4","e":null,"i":"1558.99","b":"151063.91","k":"7c33e0bcaaf46a89d87a8af807112df39238872cf78d7f9b6fa40c6766f31441","n":241},{"d":"2025-07-18","dt":"2025-07-18 15:46:03","f":"贷","c":"广州闪趣网络科技有限公司","p":"结算款","s":"结算款","r":"","e":null,"i":"3579.27","b":"149504.92","k":"18ad5d7e309237b203799b94102f559f134599805b963b3444879db8797fbd6b","n":242},{"d":"2025-07-18","dt":"2025-07-18 12:28:50","f":"贷","c":"湖南芯动网络科技有限公司","p":"","s":"2025年6月分成款","r":"2025年6月分成款","e":null,"i":"148.43","b":"145925.65","k":"fd1acabddc40b2691915a13e0543beec34b171a9b890098819cd12771e03ef0d","n":243},{"d":"2025-07-18","dt":"2025-07-18 10:33:05","f":"贷","c":"北京神奇工场科技有限公司","p":"","s":"结算款结算款","r":"结算款结算款","e":null,"i":"3685.54","b":"145777.22","k":"967837d4f8a5160c4b752fb7f1d34c60e48e2ea8c33c961d0a7506de771ce9bc","n":244},{"d":"2025-07-16","dt":"2025-07-16 16:30:13","f":"贷","c":"广东天宸网络科技有限公司","p":"","s":"互联网分成款-游戏联","r":"互联网分成款-游戏联运-付广州熊动科技有限公司202506","e":null,"i":"16.15","b":"142091.68","k":"62f96d700a2ba79c6ab5a38333b940c9c606e9fa8868eeb13770becede26108e","n":245},{"d":"2025-07-16","dt":"2025-07-16 12:17:39","f":"借","c":"罗汉金","p":"工资","s":"工资","r":"","e":"5376.33","i":null,"b":"142075.53","k":"b74f0b3633a17a3ff0ffb75042b159511c105bc87692f3318a7384325223d583","n":246},{"d":"2025-07-16","dt":"2025-07-16 12:17:39","f":"借","c":"吴伟滨","p":"工资","s":"工资","r":"","e":"4330.28","i":null,"b":"147451.86","k":"da9b43ab499a02e85a2d27ccbc9649c8ee8650d039c97fde315d9e2a41e315b5","n":247},{"d":"2025-07-16","dt":"2025-07-16 12:17:25","f":"借","c":"龚辉","p":"工资","s":"工资","r":"","e":"6387.37","i":null,"b":"151782.14","k":"41a2705042977eb53b8a18df483123e92cd3c33f75dd16381e1610d2b8e127f3","n":248},{"d":"2025-07-16","dt":"2025-07-16 12:16:48","f":"借","c":"王淼","p":"工资","s":"工资","r":"","e":"12407.25","i":null,"b":"158169.51","k":"3523d336aea8ffe27b0b07f58d49358e3b463d05d015ac530e87b722f96e4758","n":249},{"d":"2025-07-16","dt":"2025-07-16 12:15:46","f":"借","c":"王淼","p":"报销","s":"报销","r":"","e":"280.50","i":null,"b":"170576.76","k":"8dcf5e1f65ed84585907897aabdeb3ad9bd9a7dc2d655deeda1e8a6866dafc86","n":250},{"d":"2025-07-15","dt":"2025-07-15 15:07:47","f":"借","c":"待报解预算收入-待清算财税库银中转户","p":"代理国库税收收缴","s":"代理国库税收收缴","r":"26953780","e":"865.94","i":null,"b":"170857.26","k":"3dc92308457c57df4e245b5bf3328cdf847d39528f86994d6a43bc89dbaa1778","n":251},{"d":"2025-07-15","dt":"2025-07-15 15:05:48","f":"贷","c":"南阳百分网络科技有限公司","p":"","s":"合作分成","r":"合作分成","e":null,"i":"272.79","b":"171723.20","k":"3fe6038ccb33f69bf59909f14f4e772f9de19798a91e2f0bfd69f6ff1278478a","n":252},{"d":"2025-07-15","dt":"2025-07-15 14:34:29","f":"借","c":"待报解预算收入-待清算财税库银中转户","p":"代理国库税收收缴","s":"代理国库税收收缴","r":"26798478","e":"1998.28","i":null,"b":"171450.41","k":"7a2efebe55c5a3202748198d9aa2346ae353b3ce81ba80475ddcc910088d11f3","n":253},{"d":"2025-07-15","dt":"2025-07-15 10:02:25","f":"贷","c":"广州爱九游信息技术有限公司","p":"","s":"结算款项支付","r":"结算款项支付","e":null,"i":"2770.20","b":"173448.69","k":"143d12dbb2d2fa6a731ccc39995fde653216d5f56e4d74d3d78aea56f03cc691","n":254},{"d":"2025-07-11","dt":"2025-07-11 15:51:07","f":"借","c":"海南冰游科技有限公司","p":"货款","s":"货款","r":"","e":"2233.50","i":null,"b":"170678.49","k":"e0bf175fc1865cdcf9fc2a4bb3f21fe3ac4f4e626f884fee2e39fcb963335104","n":255},{"d":"2025-07-11","dt":"2025-07-11 15:44:55","f":"借","c":"王淼","p":"报销","s":"报销","r":"","e":"742.80","i":null,"b":"172911.99","k":"c82ca9581b416c6ae07b6f80ed1351b851d87e93542b14e821c88c581f398e5b","n":256},{"d":"2025-07-10","dt":"2025-07-10 15:11:07","f":"贷","c":"上海趣朗网络科技有限公司","p":"","s":"信息服务费","r":"信息服务费","e":null,"i":"656.35","b":"173654.79","k":"1cbc91a25de203c39863232aeb9b1f5cdc33c0b3ec227e4aeb77b732c263dbc4","n":257},{"d":"2025-07-05","dt":"2025-07-05 17:24:29","f":"借","c":"杭州宠趣网络科技有限公司","p":"货款","s":"货款","r":"","e":"54.72","i":null,"b":"172998.44","k":"75987ec3a2ec3e076d07a7c3ff5354c393b2469bf4f2d97e1a91cfe88f259756","n":258},{"d":"2025-07-05","dt":"2025-07-05 17:22:46","f":"借","c":"北京漫腾网络科技有限公司","p":"货款","s":"货款","r":"","e":"360.51","i":null,"b":"173053.16","k":"cf1676b8a433ebfcab7fce3eeada453279a626d83bba05e72109462e924b2b1c","n":259},{"d":"2025-07-05","dt":"2025-07-05 06:04:53","f":"借","c":"中国电信股份有限公司广州分公司","p":"","s":"电信","r":"","e":"399.00","i":null,"b":"173413.67","k":"36bb852f1b71c055bee3444bba86b397c7f2b03d91dbbd79c0edbbf746e67db0","n":260},{"d":"2025-07-02","dt":"2025-07-02 10:41:05","f":"贷","c":"广州南游网络科技有限公司","p":"","s":"202505月信息服务费","r":"202505月信息服务费","e":null,"i":"11879.01","b":"173812.67","k":"728cafd38bd144168fa739958f4701a551e903e4219ebccf7d19ad6579d7ce84","n":261},{"d":"2025-07-01","dt":"2025-07-01 19:20:31","f":"贷","c":"武汉曦晨互娱网络科技有限公司","p":"信息服务费","s":"信息服务费","r":"","e":null,"i":"1580.68","b":"161933.66","k":"897da436fa2dae075b5bd97ccafa9faa816efca6057d646d1cf2c270396ae0ec","n":262},{"d":"2025-07-01","dt":"2025-07-01 16:03:20","f":"贷","c":"成都华联互娱科技有限公司","p":"","s":"信息服务费","r":"信息服务费","e":null,"i":"11822.42","b":"160352.98","k":"0909c6dcfbf9c6a21bd2236a6bc2197617c61d2fa9ca9c98872aad8f1396167c","n":263}]$json$::jsonb) AS x(
  d TEXT, dt TEXT, f TEXT, c TEXT, p TEXT, s TEXT, r TEXT,
  e NUMERIC(18,2), i NUMERIC(18,2), b NUMERIC(18,2), k TEXT, n INTEGER
);

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM tmp_icbc_historydetail_2025_h2) <> 261 THEN
    RAISE EXCEPTION 'ICBC 2025-H2 import payload row-count mismatch';
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
    '交易时间: ' || src.dt,
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
  'HISTORYDETAIL_2025-07_to_2025-12.csv',
  src.n,
  src.k,
  'icbc-historydetail-2025h2-c7f7cd76',
  NULL,
  NULL,
  NULL,
  NULL
FROM tmp_icbc_historydetail_2025_h2 AS src
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
    WHERE import_batch_id = 'icbc-historydetail-2025h2-c7f7cd76'
  )::INTEGER AS inserted
  FROM bank_transactions
  WHERE dedupe_key IN (SELECT k FROM tmp_icbc_historydetail_2025_h2)
),
source_totals AS (
  SELECT
    COALESCE(SUM(i), 0)::NUMERIC(18,2) AS income_total,
    COALESCE(SUM(e), 0)::NUMERIC(18,2) AS expense_total,
    MIN(d) AS date_from,
    MAX(d) AS date_to
  FROM tmp_icbc_historydetail_2025_h2
)
INSERT INTO bank_import_batches (
  id, source_bank, source_file_name, source_sheet_name, bank_account,
  total, inserted, duplicates, invalid, income_total, expense_total,
  date_from, date_to, duplicate_row_nos, invalid_row_nos, legacy_backfill
)
SELECT
  'icbc-historydetail-2025h2-c7f7cd76',
  'ICBC',
  'HISTORYDETAIL_2025-07_to_2025-12.csv',
  '[HISTORYDETAIL]',
  account_choice.bank_account,
  261,
  stats.inserted,
  261 - stats.inserted,
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
  FROM tmp_icbc_historydetail_2025_h2 AS src
  WHERE EXISTS (
    SELECT 1
    FROM bank_transactions AS existing
    WHERE existing.dedupe_key = src.k
  );
  IF present_count <> 261 THEN
    RAISE EXCEPTION 'ICBC 2025-H2 import integrity check failed: expected 261 rows, found %', present_count;
  END IF;
END $$;
