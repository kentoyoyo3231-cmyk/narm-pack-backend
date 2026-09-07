// Mock payment provider — stands in for Beam (or any PromptPay gateway)
// during development. No real money moves. The rest of the app (routes,
// MQTT trigger, DB updates) works exactly the same as it will with a real
// provider — only this file changes when you switch to Beam.

const crypto = require('crypto');

const MOCK_SECRET = process.env.MOCK_PAYMENT_SECRET || 'mock-secret-change-me';

async function createPayment({ orderId, amount }) {
  const paymentRef = `mock_${orderId}`;
  return {
    paymentRef,
    qrPayload: `MOCK-PROMPTPAY|${orderId}|${amount}`,
    raw: { note: 'mock provider - not a real QR, for dev/demo only' },
  };
}

// Builds the exact { body, signature } a real webhook call would send, so
// the "simulate pay" test route can POST it to our own webhook endpoint —
// exercising the identical validation/idempotency path production traffic
// will hit.
function buildSimulatedWebhookPayload({ orderId, amount, paymentRef }) {
  const body = { orderId, amount, status: 'SUCCESS', paymentRef };
  const signature = crypto
    .createHmac('sha256', MOCK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return { body, signature };
}

// Verifies an inbound webhook call. Mock scheme: header `x-mock-signature`
// = HMAC-SHA256(JSON body, MOCK_PAYMENT_SECRET). Real gateways each have
// their own header name + algorithm — check Beam's docs when swapping in
// beamProvider.js, but keep this same return shape.
function verifyWebhook(req) {
  const signature = req.headers['x-mock-signature'];
  if (!signature) return { valid: false, reason: 'missing signature header' };

  const expected = crypto
    .createHmac('sha256', MOCK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (signature !== expected) return { valid: false, reason: 'signature mismatch' };

  const { orderId, amount, status, paymentRef } = req.body || {};
  if (!orderId || !status) return { valid: false, reason: 'missing fields in webhook body' };

  return {
    valid: true,
    orderId,
    amount,
    paymentRef,
    paid: status === 'SUCCESS',
  };
}

module.exports = { name: 'mock', createPayment, verifyWebhook, buildSimulatedWebhookPayload };
