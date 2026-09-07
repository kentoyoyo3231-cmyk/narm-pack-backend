const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'narmpack.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

function seedIfEmpty() {
  const machineCount = db.prepare('SELECT COUNT(*) AS n FROM machines').get().n;

  if (machineCount === 0) {
    const machineId = process.env.DEFAULT_MACHINE_ID || 'machine-01';
    db.prepare(
      'INSERT INTO machines (id, name, location) VALUES (?, ?, ?)'
    ).run(machineId, 'Narm Pack #1', 'ตำแหน่งทดสอบ');

    const insertCompartment = db.prepare(
      'INSERT INTO compartments (machine_id, compartment_no, product_name, price, status) VALUES (?, ?, ?, ?, ?)'
    );
    const insertMany = db.transaction((count) => {
      for (let i = 1; i <= count; i++) {
        insertCompartment.run(machineId, i, `น้ำดื่ม 600ml (ช่อง ${i})`, 1500, 'available'); // 15.00 THB in satang
      }
    });
    insertMany(30);
    console.log(`[seed] created machine "${machineId}" with 30 compartments`);
  }

  const adminCount = db.prepare('SELECT COUNT(*) AS n FROM admin_users').get().n;
  if (adminCount === 0) {
    const username = process.env.SEED_ADMIN_USERNAME || 'admin';
    const password = process.env.SEED_ADMIN_PASSWORD || 'changeme123';
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(
      'INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, ?)'
    ).run(username, hash, 'admin');
    console.log(
      `[seed] created admin user "${username}" — CHANGE THIS PASSWORD before deploying for real (set SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD in .env before first run)`
    );
  }
}

seedIfEmpty();

module.exports = db;
