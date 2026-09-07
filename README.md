# Narm Pack Backend

Backend server for the Narm Pack vending machine: takes orders from the customer web app, talks to a payment gateway, and — once payment is confirmed — publishes the unlock command to the ESP32 over MQTT. This is the piece that was missing from the earlier prototype (which had the browser talk to Adafruit IO directly, with the API key sitting in `localStorage` — fine for a bench test, not safe once real money is involved).

See `production-architecture-spec.md` (in the Vending project) for the full system design this implements.

## What's here vs. what's still needed

Built and working (against the mock payment provider):
- Order creation, QR payload generation (mock)
- Webhook handling with signature verification + idempotency
- MQTT publish to Adafruit IO (or any MQTT broker) with retry-with-backoff if no ack arrives
- SQLite database (machines, compartments, transactions, hardware_logs, admin_users)
- Admin login (JWT) + transaction history + manual override + machine online status

Still needed before this runs for real:
- A real Beam merchant account + filling in `src/services/payment/beamProvider.js` against their actual API docs
- Adding an **ack publish** to the ESP32 firmware (`<machine_id>-ack` feed with payload like `"15:ok"`) — today's firmware drives the relay but doesn't report back, so `sendUnlockWithRetry()` will currently always time out to "unconfirmed" rather than get a real `ok: true`. Small firmware addition, happy to do it next.
- Adding a **heartbeat publish** to the firmware (`<machine_id>-heartbeat`) so `/api/admin/machines` can show real online/offline status
- Deploying somewhere with a public HTTPS URL (a VPS, Railway, Render, etc.) so Beam's webhook can actually reach `/api/payment-webhook`

## A note on this environment

This backend was written and syntax-checked (`node --check` on every file) in a sandbox that has **no access to the npm registry** (network policy blocks it), so `npm install` could not be run or tested live here. The code has been reviewed carefully by hand, but you should still run through the smoke test below yourself the first time, on a machine with normal internet access, before trusting it.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:
- Leave `PAYMENT_PROVIDER=mock` for now (no real payment account needed)
- Fill in `AIO_USERNAME` / `AIO_KEY` from io.adafruit.com → key icon ("My Key") — same values you'd put in the ESP32 firmware
- Change `ADMIN_JWT_SECRET` and `SEED_ADMIN_PASSWORD` to something real, not the placeholders

```bash
npm start
```

On first run this creates `data/narmpack.db`, seeds one machine (`machine-01`) with 30 compartments, and seeds one admin user from `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`.

## Smoke test (mock payment, full flow)

```bash
# 1. Create an order for compartment #1 (compartment ids start at 1)
curl -s -X POST localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{"compartment_id": 1}' | tee /tmp/order.json

ORDER_ID=$(node -e "console.log(require('/tmp/order.json').orderId)")

# 2. Check status — should be "pending"
curl -s localhost:3000/api/orders/$ORDER_ID

# 3. Simulate the customer paying (this hits the REAL /api/payment-webhook
#    route internally with a signed payload — same code path real Beam
#    traffic will use)
curl -s -X POST localhost:3000/api/orders/$ORDER_ID/simulate-pay

# 4. Check status again — "unlocked" if AIO_KEY is valid and the ESP32 is
#    online and responds; "unlock_sent" if no ack came back in time
curl -s localhost:3000/api/orders/$ORDER_ID
```

## Admin API

```bash
# Login
curl -s -X POST localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<your SEED_ADMIN_PASSWORD>"}' | tee /tmp/login.json

TOKEN=$(node -e "console.log(require('/tmp/login.json').token)")

# Transaction history
curl -s localhost:3000/api/admin/transactions -H "Authorization: Bearer $TOKEN"

# Machine online/offline status
curl -s localhost:3000/api/admin/machines -H "Authorization: Bearer $TOKEN"

# Manual override — force-open a compartment
curl -s -X POST localhost:3000/api/admin/manual-open \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"machine_id": "machine-01", "compartment_no": 5}'
```

## Switching to real Beam later

1. Get real Beam merchant credentials, check their current API docs (endpoint paths/field names in `beamProvider.js` are placeholders and need correcting for real)
2. Implement `createPayment` and `verifyWebhook` in `src/services/payment/beamProvider.js` — keep the same return shapes as `mockProvider.js`, nothing else in the app needs to change
3. Set `PAYMENT_PROVIDER=beam` and `BEAM_SECRET_KEY` in `.env`
4. Point Beam's webhook URL at `https://<your-domain>/api/payment-webhook`

## Deployment notes

- Needs a public HTTPS URL for the webhook (Beam can't reach `localhost`) — a small VPS (DigitalOcean/Vultr/AWS Lightsail) or a PaaS like Railway/Render both work fine for this scale
- SQLite is fine up to a handful of machines; if you outgrow it later, swap `better-sqlite3` for `pg` (Postgres) — the query style used throughout (`db.prepare(...).run/get/all`) is intentionally simple to make that swap mechanical
- Put this behind HTTPS (Caddy or nginx + certbot is the usual quick path, or the PaaS provides it automatically)
