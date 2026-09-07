require('dotenv').config();

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
