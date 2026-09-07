const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/compartments?machine_id=  — PUBLIC, read-only.
router.get('/', (req, res) => {
  const { machine_id } = req.query;
  const rows = machine_id
    ? db.prepare('SELECT * FROM compartments WHERE machine_id = ? ORDER BY compartment_no').all(machine_id)
    : db.prepare('SELECT * FROM compartments ORDER BY machine_id, compartment_no').all();
  res.json(rows);
});

module.exports = router;
