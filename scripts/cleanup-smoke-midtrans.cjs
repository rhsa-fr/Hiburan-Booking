/**
 * Removes only the NON-LEDGER artifacts of the Midtrans smoke test.
 *
 * Ledger rows (journal_entries/journal_lines), bookings, payments and refunds
 * are deliberately retained: the ledger is append-only and those rows are the
 * audit trail. Run with `--apply` to execute; default is a dry-run.
 */
const fs = require('fs');
const { Client } = require('pg');

function readEnv(path) {
  if (!fs.existsSync(path)) return {};
  const out = {};
  for (const raw of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    out[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .replace(/^'(.*)'$/, '$1');
  }
  return out;
}

const APPLY = process.argv.includes('--apply');
const EMAIL = process.env.SMOKE_EMAIL || 'smoke.midtrans@tarlink.id';

(async () => {
  const env = readEnv('D:\\Project\\Tarlink\\.env');
  const dbUrl = process.env.DATABASE_URL || env.DATABASE_URL;
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  await client.query('BEGIN');

  try {
    const userResult = await client.query('select id from users where lower(email)=lower($1)', [
      EMAIL
    ]);
    const user = userResult.rows[0];
    if (!user) throw new Error(`user not found: ${EMAIL}`);

    const bookingResult = await client.query(
      'select id, code from bookings where customer_id=$1 order by created_at',
      [user.id]
    );
    const bookingIds = bookingResult.rows.map((row) => row.id);

    const paymentResult = await client.query(
      'select id, provider_ref, status from payments where booking_id = any($1::uuid[])',
      [bookingIds]
    );
    const paymentIds = paymentResult.rows.map((row) => row.id);
    const providerRefs = paymentResult.rows
      .map((row) => row.provider_ref)
      .filter((value) => Boolean(value));

    const refundResult = await client.query(
      'select id, payment_id, status, amount_idr from refunds where payment_id = any($1::uuid[])',
      [paymentIds]
    );
    const journalResult = await client.query(
      'select count(*)::int as n from journal_entries where booking_id = any($1::uuid[])',
      [bookingIds]
    );

    console.log(
      JSON.stringify(
        {
          email: EMAIL,
          bookings: bookingResult.rows,
          payments: paymentResult.rows,
          refunds: refundResult.rows,
          journal_entries: journalResult.rows[0].n,
          mode: APPLY ? 'apply' : 'dry-run'
        },
        null,
        2
      )
    );

    if (!APPLY) {
      console.log('DRY-RUN: nothing deleted. Re-run with --apply.');
      await client.query('ROLLBACK');
      await client.end();
      return;
    }

    const outbox = await client.query(
      "delete from outbox_messages where aggregate_type='booking' and aggregate_id = any($1::uuid[])",
      [bookingIds]
    );
    const webhooks = providerRefs.length
      ? await client.query(
          `delete from webhook_events
            where provider='midtrans'
              and (payload->>'order_id' = any($1::text[])
                   or payload->'data'->>'provider_ref' = any($1::text[]))`,
          [providerRefs]
        )
      : { rowCount: 0 };
    const idempotency = await client.query('delete from idempotency_keys where actor_id=$1', [
      user.id
    ]);
    const attempts = await client.query('delete from login_attempts where lower(email)=lower($1)', [
      EMAIL
    ]);

    await client.query('COMMIT');

    console.log(
      JSON.stringify(
        {
          deleted: {
            outbox_messages: outbox.rowCount,
            webhook_events: webhooks.rowCount,
            idempotency_keys: idempotency.rowCount,
            login_attempts: attempts.rowCount
          },
          retained: {
            bookings: bookingIds.length,
            payments: paymentIds.length,
            refunds: refundResult.rows.length,
            journal_entries: journalResult.rows[0].n,
            reason: 'append-only ledger / financial audit trail'
          }
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
