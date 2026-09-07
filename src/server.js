require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const mqttService = require('./services/mqtt');
const ordersRouter = require('./routes/orders');
const webhookRouter = require('./routes/webhook');
const adminRouter = require('./routes/admin');
const compartmentsRouter = require('./routes/compartments');

const app = express();
app.use(cors());
app.use(express.json());

// Serve the customer-facing web app (index.html, sitting at the repo root
// next to package.json) as a real, permanent public page — same Railway URL
// that already hosts the API now also hosts the site itself, so there's no
// separate hosting service/account to manage and no risk of a temporary
// drag-and-drop link expiring.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ ok: true, mqttConnected: mqttService.isConnected() });
});

app.use('/api/orders', ordersRouter);
app.use('/api/payment-webhook', webhookRouter);
app.use('/api/admin', adminRouter);
app.use('/api/compartments', compartmentsRouter);

app.use((err, req, res, next) => {
  console.error('[server] unhandled error:', err);
  res.status(500).json({ error: 'internal server error' });
});

const PORT = process.env.PORT || 3000;

mqttService.connect();

app.listen(PORT, () => {
  console.log(`[server] Narm Pack backend listening on port ${PORT}`);
  console.log(`[server] payment provider: ${require('./services/payment').name}`);
});
