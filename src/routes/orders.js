const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const payment = require('../services/payment');

const router = express.Router();

// POST /api/orders  { compartment_id }
// Called when a customer picks a compartment on the frontend.
router.post('/', async (req, res) => {
  const { compartment_id } = req.body || {};
  if (!compartment_id) return res.status(400).json({ error: 'compartment_id is required' });

  const compartment = db.prepare('SELECT * FROM compartments WHERE id = ?').get(compartment_id);
  if (!compartment) return res.status(404).json({ error: 'compartment not found' });
  if (compartment.status !== 'available') {
    return res.status(409).json({ error: 'compartment not available' });
  }

  const orderId = uuidv4();

  try {
    const paymentResult = await payment.createPayment({ orderId, amount: compartment.price });

    db.prepare(
      `INSERT INTO transactions (id, compartment_id, machine_id, amount, status, payment_ref)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    ).run(orderId, compartment.id, compartment.machine_id, compartment.price, paymentResult.paymentRef);

    res.json({
      orderId,
      amount: compartment.price,
      qrPayload: paymentResult.qrPayload,
      provider: payment.name,
    });
  } catch (err) {
    console.error('[orders] create payment failed:', err.message);
    res.status(502).json({ error: 'failed to create payment', detail: err.message });
  }
});

// GET /api/orders/:id — frontend polls this while the customer is paying /
// while we're waiting for the hardware unlock to confirm.
router.get('/:id', (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'order not found' });
  res.json(tx);
});

// POST /api/orders/:id/simulate-pay — DEV/DEMO ONLY. Only works while
// PAYMENT_PROVIDER=mock. Stands in for "customer scanned the QR and paid in
// their bank app": it builds a signed payload and POSTs it to our own real
// /api/payment-webhook endpoint (a real loopback HTTP call, not a direct
// function call) — so testing this exercises the EXACT same signature
// verification + idempotency + unlock path that real Beam traffic will hit
// in production, not a shortcut around it.
router.post('/:id/simulate-pay', async (req, res) => {
  if (payment.name !== 'mock') {
    return res.status(403).json({ error: 'simulate-pay only works with PAYMENT_PROVIDER=mock' });
  }

  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'order not found' });

  try {
    const { body, signature } = payment.buildSimulatedWebhookPayload({
      orderId: tx.id,
      amount: tx.amount,
      paymentRef: tx.payment_ref,
    });

    const port = process.env.PORT || 3000;
    const webhookRes = await fetch(`http://127.0.0.1:${port}/api/payment-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mock-signature': signature },
      body: JSON.stringify(body),
    });
    const result = await webhookRes.json();
    res.status(webhookRes.status).json(result);
  } catch (err) {
    console.error('[orders] simulate-pay failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
