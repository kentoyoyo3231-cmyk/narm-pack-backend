// MQTT client — talks to the IoT broker (Adafruit IO by default; point
// MQTT_HOST/PORT at a self-hosted broker later without changing anything
// else). This is the ONLY place in the whole backend that holds the
// broker credentials — they live in .env, never in the frontend, unlike
// the original browser-only prototype.
//
// Feed/topic convention per machine (see architecture spec section 4):
//   <machine_id>-unlock     backend -> ESP32   payload: compartment number, e.g. "15"
//   <machine_id>-ack        ESP32 -> backend   payload: "<compartment_no>:ok" or ":fail"
//   <machine_id>-heartbeat  ESP32 -> backend   payload: anything, just presence matters
//
// Reconnect uses a fixed backoff (mirrors the lesson learned flashing the
// ESP32 firmware today: hammering the broker with instant reconnects turns
// a brief network blip into a full reconnect storm).

const mqtt = require('mqtt');
const EventEmitter = require('events');
const db = require('../db');

const AIO_USERNAME = process.env.AIO_USERNAME;
const AIO_KEY = process.env.AIO_KEY;
const MQTT_HOST = process.env.MQTT_HOST || 'io.adafruit.com';
const MQTT_PORT = Number(process.env.MQTT_PORT || 8883);

const ackEmitter = new EventEmitter();

let client = null;
let connected = false;

function feedTopic(machineId, suffix) {
  return `${AIO_USERNAME}/feeds/${machineId}-${suffix}`;
}

function connect() {
  if (!AIO_USERNAME || !AIO_KEY) {
    console.warn(
      '[mqtt] AIO_USERNAME / AIO_KEY not set in .env — hardware trigger is disabled until configured'
    );
    return;
  }

  client = mqtt.connect(`mqtts://${MQTT_HOST}:${MQTT_PORT}`, {
    username: AIO_USERNAME,
    password: AIO_KEY,
    reconnectPeriod: 5000, // don't hammer the broker on flaky connections
    connectTimeout: 15000,
  });

  client.on('connect', () => {
    connected = true;
    console.log('[mqtt] connected to broker');
    const machines = db.prepare('SELECT id FROM machines').all();
    for (const m of machines) {
      client.subscribe(feedTopic(m.id, 'ack'));
      client.subscribe(feedTopic(m.id, 'heartbeat'));
    }
  });

  client.on('reconnect', () => {
    connected = false;
    console.log('[mqtt] reconnecting...');
  });

  client.on('close', () => {
    connected = false;
  });

  client.on('error', (err) => {
    console.error('[mqtt] error:', err.message);
  });

  client.on('message', (topic, payload) => {
    const text = payload.toString();
    const machines = db.prepare('SELECT id FROM machines').all();
    for (const m of machines) {
      if (topic === feedTopic(m.id, 'ack')) {
        handleAck(m.id, text);
      } else if (topic === feedTopic(m.id, 'heartbeat')) {
        db.prepare("UPDATE machines SET last_heartbeat_at = datetime('now') WHERE id = ?").run(m.id);
      }
    }
  });
}

function handleAck(machineId, text) {
  // Expected payload format from the ESP32: "<compartment_no>:ok" / ":fail"
  // NOTE: today's firmware does not send this yet — it's a small addition
  // (publish to `<machine_id>-ack` after driving the relay) needed before
  // sendUnlockWithRetry() below can get real confirmations instead of
  // always falling through to the "unconfirmed" timeout path.
  const [compStr, result] = text.split(':');
  const compartmentNo = Number(compStr);
  const ok = result === 'ok';

  ackEmitter.emit('ack', { machineId, compartmentNo, ok });

  db.prepare(
    'INSERT INTO hardware_logs (machine_id, compartment_no, event, detail) VALUES (?, ?, ?, ?)'
  ).run(machineId, compartmentNo, ok ? 'ack_ok' : 'ack_fail', text);
}

function isConnected() {
  return connected;
}

function publishUnlock(machineId, compartmentNo) {
  if (!client || !connected) {
    throw new Error('MQTT broker not connected — cannot send unlock command right now');
  }
  client.publish(feedTopic(machineId, 'unlock'), String(compartmentNo));
  db.prepare(
    'INSERT INTO hardware_logs (machine_id, compartment_no, event, detail) VALUES (?, ?, ?, ?)'
  ).run(machineId, compartmentNo, 'unlock_sent', null);
}

// Sends the unlock command and waits up to `timeoutMs` for a matching ack,
// re-publishing up to `retries` times if none arrives. This is the retry
// behavior called out in architecture spec section 2 step 6 — a brief
// broker hiccup at the exact moment of payment should not silently strand
// a paying customer.
function sendUnlockWithRetry(machineId, compartmentNo, { timeoutMs = 8000, retries = 2 } = {}) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    let timer = null;

    const onAck = (evt) => {
      if (evt.machineId === machineId && evt.compartmentNo === compartmentNo) {
        clearTimeout(timer);
        ackEmitter.off('ack', onAck);
        resolve({ ok: evt.ok, unconfirmed: false, attempts: attempt });
      }
    };

    const tryOnce = () => {
      attempt += 1;

      try {
        publishUnlock(machineId, compartmentNo);
      } catch (err) {
        ackEmitter.off('ack', onAck);
        reject(err);
        return;
      }

      timer = setTimeout(() => {
        if (attempt <= retries) {
          console.warn(`[mqtt] no ack for ${machineId}#${compartmentNo}, retrying (${attempt}/${retries})`);
          tryOnce();
        } else {
          // No confirmed ack after all retries. The command was still sent
          // each time, so the lock MAY have opened — report "unconfirmed",
          // not "failed", so callers surface the right message to the
          // customer (see architecture spec section 2, step 6).
          ackEmitter.off('ack', onAck);
          resolve({ ok: false, unconfirmed: true, attempts: attempt });
        }
      }, timeoutMs);
    };

    ackEmitter.on('ack', onAck);
    tryOnce();
  });
}

module.exports = { connect, isConnected, publishUnlock, sendUnlockWithRetry, ackEmitter };
