// STUB — fill this in once you have a real Beam merchant account and have
// read Beam's current API docs (endpoint paths/field names below are
// placeholders and WILL need correcting against the real docs).
//
// The exported function names/shapes match mockProvider.js on purpose:
// once this file is complete, switching PAYMENT_PROVIDER=beam in .env is
// the only change needed — routes/orders.js and routes/webhook.js do not
// need to be touched.

const BEAM_SECRET_KEY = process.env.BEAM_SECRET_KEY;
const BEAM_API_BASE = process.env.BEAM_API_BASE || 'https://api.beamcheckout.com'; // TODO: verify against real docs

async function createPayment({ orderId, amount }) {
  if (!BEAM_SECRET_KEY) {
    throw new Error('BEAM_SECRET_KEY is not set — cannot create a real Beam payment yet');
  }

  // TODO: replace with Beam's real "create payment / create PromptPay QR" call.
  // Sketch of what this probably looks like — verify field names for real:
  //
  // const res = await fetch(`${BEAM_API_BASE}/v1/payments`, {
  //   method: 'POST',
  //   headers: {
  //     Authorization: `Bearer ${BEAM_SECRET_KEY}`,
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({ referenceId: orderId, amount, currency: 'THB' }),
  // });
  // if (!res.ok) throw new Error(`Beam createPayment failed: ${res.status}`);
  // const data = await res.json();
  // return { paymentRef: data.id, qrPayload: data.qrCode, raw: data };

  throw new Error('beamProvider.createPayment is a stub — implement against the real Beam API docs first');
}

function verifyWebhook(req) {
  // TODO: replace with Beam's real webhook signature verification.
  // Check their docs for the header name and signing algorithm — do not
  // ship this to production without real signature verification, or
  // anyone who finds your webhook URL can fake a "payment succeeded" call
  // and unlock a compartment for free.
  //
  // Expected return shape (must match mockProvider.verifyWebhook):
  // { valid: boolean, reason?: string, orderId, amount, paymentRef, paid: boolean }

  throw new Error('beamProvider.verifyWebhook is a stub — implement against the real Beam API docs first');
}

module.exports = { name: 'beam', createPayment, verifyWebhook };
