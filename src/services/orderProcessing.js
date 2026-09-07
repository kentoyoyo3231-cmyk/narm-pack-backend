// Shared "payment confirmed" logic used by both the real webhook route and
// the mock provider's simulate-pay route, so there is exactly one code path
// that ever triggers a hardware unlock after payment — no duplication to
// let drift out of sync.

const db = require('./../db');
const mqttService = require('./mqtt');

async function confirmPayment({ orderId, amount, paymentRef }) {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(orderId);
  if (!tx) {
    const err = new Error(`order ${orderId} not found`);
    err.code = 'NOT_FOUND';
    throw err;
  }

  // Idempotency: a webhook retry (real gateways resend on any hiccup) or a
  // duplicate call must never re-trigger payment/unlock processing.
  if (tx.status !== 'pending') {
    return { ...tx, note: 'already processed, no action taken (idempotent)' };
  }

  if (amount !== undefined && amount !== null && Number(amount) !== tx.amount) {
    db.prepare("UPDATE transactions SET status = 'failed' WHERE id = ?").run(orderId);
    const err = new Error(`amount mismatch: expected ${tx.amount}, got ${amount}`);
    err.code = 'AMOUNT_MISMATCH';
    throw err;
  }

  db.prepare(
    "UPDATE transactions SET status = 'paid', paid_at = datetime('now'), payment_ref = ? WHERE id = ?"
  ).run(paymentRef || tx.payment_ref, orderId);

  const compartment = db.prepare('SELECT * FROM compartments WHERE id = ?').get(tx.compartment_id);
  db.prepare("UPDATE compartments SET status = 'sold' WHERE id = ?").run(compartment.id);

  let unlockResult;
  try {
    unlockResult = await mqttService.sendUnlockWithRetry(tx.machine_id, compartment.compartment_no);
  } catch (err) {
    // Broker unreachable entirely. Customer WAS charged — never silently
    // drop this. Leave it flagged for admin follow-up instead.
    db.prepare("UPDATE transactions SET status = 'failed' WHERE id = ?").run(orderId);
    db.prepare(
      `INSERT INTO hardware_logs (machine_id, compartment_no, transaction_id, event, detail)
       VALUES (?, ?, ?, 'unlock_sent', ?)`
    ).run(tx.machine_id, compartment.compartment_no, orderId, `broker unreachable: ${err.message}`);
    return db.prepare('SELECT * FROM transactions WHERE id = ?').get(orderId);
  }

  if (unlockResult.ok) {
    db.prepare(
      "UPDATE transactions SET status = 'unlocked', unlocked_at = datetime('now') WHERE id = ?"
    ).run(orderId);
  } else if (unlockResult.unconfirmed) {
    // Command sent (possibly retried) but no ack in time. The lock may
    // have opened anyway — report "unconfirmed", not "failed" (see
    // architecture spec section 2 step 6). Needs today's firmware to be
    // extended with an ack publish before this ever resolves to ok=true.
    db.prepare("UPDATE transactions SET status = 'unlock_sent' WHERE id = ?").run(orderId);
  } else {
    // ESP32 explicitly ack'd failure (e.g. relay fault).
    db.prepare("UPDATE transactions SET status = 'failed' WHERE id = ?").run(orderId);
  }

  return { ...db.prepare('SELECT * FROM transactions WHERE id = ?').get(orderId), unlockResult };
}

module.exports = { confirmPayment };
