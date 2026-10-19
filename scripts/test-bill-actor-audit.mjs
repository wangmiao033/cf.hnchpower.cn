// Local-only PostgreSQL/WASM integration test. Never uses DATABASE_URL.
// PGLITE_MODULE=/path/to/pglite/dist/index.js node scripts/test-bill-actor-audit.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite')
const db = new PGlite() // isolated in-memory database
const sql = async name => readFile(new URL(`../backend/sql/${name}`, import.meta.url), 'utf8')
try {
  await db.exec(`
    CREATE TABLE channel_records(id text primary key, statement_no text, status text, settlement_amount numeric, received_amount numeric, receipt_status text);
    CREATE TABLE reconciliation_records(LIKE channel_records INCLUDING ALL);
    CREATE TABLE channel_record_line_items(id text primary key, channel_record_id text, game_name text, amount numeric);
    CREATE TABLE reconciliation_line_items(id text primary key, reconciliation_id text, game_name text, amount numeric);
    CREATE TABLE channel_receipts(id text, channel_record_id text);
    CREATE TABLE bank_transactions(id text, reconciliation_id text, reconciliation_type text, reconciliation_no text);
    CREATE TABLE bank_payment_records(id text, reconciliation_id text);
    CREATE TABLE bill_invoice_allocations(id text, bill_type text, bill_id text);
  `)
  await db.exec(await sql('025_create_operation_logs.sql'))
  await db.exec("INSERT INTO channel_records VALUES ('old','OLD','confirmed',123.45,0,'unpaid')")
  const oldBill = (await db.query("SELECT * FROM channel_records WHERE id='old'")).rows
  const oldLogs = (await db.query("SELECT * FROM operation_logs ORDER BY id")).rows
  await db.exec(await sql('075_bill_actor_audit.sql'))
  assert.deepEqual((await db.query("SELECT * FROM channel_records WHERE id='old'")).rows, oldBill)
  assert.deepEqual((await db.query("SELECT * FROM operation_logs ORDER BY id")).rows, oldLogs)
  await db.exec(`BEGIN;
    SELECT set_config('app.current_user_id','entry-id',true), set_config('app.current_user_email','entry@example.com',true);
    INSERT INTO channel_records VALUES ('new','NEW','pending',100,0,'unpaid');
    INSERT INTO channel_record_line_items VALUES ('line','new','demo',100);
    COMMIT;`)
  await db.exec(`BEGIN;
    SELECT set_config('app.current_user_id','verify-id',true), set_config('app.current_user_email','verify@example.com',true), set_config('app.operation_reason','source checked',true);
    UPDATE channel_records SET status='confirmed' WHERE id='new';
    COMMIT;`)
  const confirmed = (await db.query("SELECT * FROM operation_logs WHERE entity_id='new' AND action='status_change'")).rows[0]
  assert.equal(confirmed.actor_user_id, 'verify-id')
  assert.equal(confirmed.metadata.reason, 'source checked')
  assert.deepEqual(confirmed.changes.status, {before:'pending', after:'confirmed'})
  const creation = (await db.query("SELECT * FROM operation_logs WHERE entity_id='new' AND action='create'")).rows[0]
  assert.equal(creation.actor_user_id, 'entry-id')
  assert.equal(creation.changes.record.after.settlement_amount, 100)
  await db.exec(`BEGIN;
    SELECT set_config('app.current_user_id','edit-id',true), set_config('app.operation_reason','line correction',true);
    UPDATE channel_record_line_items SET amount=101 WHERE id='line';
    COMMIT;`)
  const line = (await db.query("SELECT * FROM operation_logs WHERE entity_id='new' AND action='line_update'")).rows[0]
  assert.equal(line.actor_user_id, 'edit-id')
  assert.equal(line.changes.line.before.amount, 100)
  assert.equal(line.changes.line.after.amount, 101)
  assert.equal(line.metadata.reason, 'line correction')
  // The same underlying connection is reused without inheriting an actor/reason.
  await db.exec("INSERT INTO reconciliation_records VALUES ('anonymous','ANON','pending',0,0,'unpaid')")
  const anonymous = (await db.query("SELECT * FROM operation_logs WHERE entity_id='anonymous'")).rows[0]
  assert.equal(anonymous.actor_user_id, null)
  assert.equal(anonymous.metadata.reason, null)
  await db.exec(`BEGIN; SELECT set_config('app.current_user_id','rolled-back',true); INSERT INTO reconciliation_records VALUES ('rollback','RB','pending',0,0,'unpaid'); ROLLBACK;`)
  assert.equal((await db.query("SELECT * FROM operation_logs WHERE entity_id='rollback'")).rows.length, 0)
  // Old deployed lifecycle can enrich only a new row's reason in its own transaction.
  await db.exec(`INSERT INTO reconciliation_records VALUES ('rolling','ROLL','pending',0,0,'unpaid');
    BEGIN; UPDATE reconciliation_records SET status='confirmed' WHERE id='rolling';
    UPDATE operation_logs SET summary='待核对 → 已核对', metadata=metadata || '{"reason":"old runtime enrichment","from_status":"pending","to_status":"confirmed"}'::jsonb WHERE entity_id='rolling' AND action='status_change'; COMMIT;`)
  await db.exec(`BEGIN; UPDATE reconciliation_records SET status='pending' WHERE id='rolling'; SAVEPOINT evidence;`)
  await assert.rejects(db.exec("UPDATE operation_logs SET metadata=metadata || '{\"table\":\"forged\"}'::jsonb WHERE entity_id='rolling' AND action='status_change' AND xmin::text=(txid_current() % 4294967296)::text"), /append-only/)
  await db.exec('ROLLBACK TO SAVEPOINT evidence; ROLLBACK;')
  await assert.rejects(db.exec("UPDATE operation_logs SET metadata='{}'::jsonb WHERE entity_id='rolling'"), /append-only/)
  await assert.rejects(db.exec("UPDATE operation_logs SET actor_user_id='forged'"), /append-only/)
  await assert.rejects(db.exec("DELETE FROM operation_logs"), /append-only/)
  assert.deepEqual((await db.query("SELECT * FROM channel_records WHERE id='old'")).rows, oldBill)
  console.log('PASS: unchanged legacy bill/logs; entry/verification/edit separation; line before/after + reason; transaction isolation/rollback; immutable history.')
} finally { await db.close() }
