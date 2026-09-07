const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const mqttService = require('../services/mqtt');
const { requireAdmin, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// POST /api/admin/login  { username, password }
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }

  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  const token = jwt.sign({ sub: user.id, username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: '12h',
  });
  res.json({ token, expiresIn: '12h' });
});

// Everything below this line requires a valid admin token.
router.use(requireAdmin);

// GET /api/admin/transactions?status=&machine_id=&limit=
router.get('/transactions', (req, res) => {
  const { status, machine_id, limit = 100 } = req.query;
  let query = 'SELECT * FROM transactions WHERE 1=1';
  const params = [];
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (machine_id) {
    query += ' AND machine_id = ?';
    params.push(machine_id);
  }
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Number(limit));
  res.json(db.prepare(query).all(...params));
});

// GET /api/admin/machines — online/offline derived from the heartbeat feed
router.get('/machines', (req, res) => {
  const HEARTBEAT_STALE_AFTER_SEC = 120;
  const rows = db.prepare('SELECT * FROM machines').all().map((m) => {
    let online = false;
    if (m.last_heartbeat_at) {
      const ageSec = (Date.now() - new Date(m.last_heartbeat_at + 'Z').getTime()) / 1000;
      online = ageSec < HEARTBEAT_STALE_AFTER_SEC;
    }
    return { ...m, online };
  });
  res.json(rows);
});

// GET /api/admin/compartments?machine_id=
router.get('/compartments', (req, res) => {
  const { machine_id } = req.query;
  const rows = machine_id
    ? db.prepare('SELECT * FROM compartments WHERE machine_id = ? ORDER BY compartment_no').all(machine_id)
    : db.prepare('SELECT * FROM compartments ORDER BY machine_id, compartment_no').all();
  res.json(rows);
});

// POST /api/admin/manual-open  { machine_id, compartment_no }
// Emergency override — e.g. customer paid but the hardware never
// confirmed, or a locker is jammed and needs a manual nudge.
router.post('/manual-open', (req, res) => {
  const { machine_id, compartment_no } = req.body || {};
  if (!machine_id || !compartment_no) {
    return res.status(400).json({ error: 'machine_id and compartment_no required' });
  }

  try {
    mqttService.publishUnlock(machine_id, compartment_no);
    db.prepare(
      `INSERT INTO hardware_logs (machine_id, compartment_no, event, detail)
       VALUES (?, ?, 'manual_override', ?)`
    ).run(machine_id, compartment_no, `by admin ${req.admin.username}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/admin/hardware-logs?machine_id=&limit=
router.get('/hardware-logs', (req, res) => {
  const { machine_id, limit = 200 } = req.query;
  const rows = machine_id
    ? db
        .prepare('SELECT * FROM hardware_logs WHERE machine_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(machine_id, Number(limit))
    : db.prepare('SELECT * FROM hardware_logs ORDER BY created_at DESC LIMIT ?').all(Number(limit));
  res.json(rows);
});

module.exports = router;
