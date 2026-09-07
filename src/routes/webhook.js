const express = require('express');
const payment = require('../services/payment');
const { confirmPayment } = require('../services/orderProcessing');

const router = express.Router();

// POST /api/payment-webhook — called by the real payment provider (Beam)
// when a payment succeeds. This is the ONLY route allowed to trust an
// unauthenticated inbound request, and only after signature verification.
router.post('/', async (req, res) => {
  const verification = payment.verifyWebhook(req);

  if (!verification.valid) {
    console.warn('[webhook] rejected:', verification.reason);
    return res.status(400).json({ error: verification.reason || 'invalid webhook' });
  }

  if (!verification.paid) {
    // Provider told us about a non-success event (cancelled/expired/etc) —
    // acknowledge so it stops retrying, but don't unlock anything.
    return res.status(200).json({ received: true, paid: false });
  }

  try {
    const result = await confirmPayment({
      orderId: verification.orderId,
      amount: verification.amount,
      paymentRef: verification.paymentRef,
    });
    res.status(200).json({ received: true, ...result });
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      // 200 so the provider doesn't retry forever for an order id that
      // will never exist on our side.
      console.warn('[webhook] unknown order:', verification.orderId);
      return res.status(200).json({ received: true, error: 'unknown order' });
    }
    console.error('[webhook] processing failed:', err.message);
    res.status(500).json({ error: 'internal error processing webhook' });
  }
});

module.exports = router;
