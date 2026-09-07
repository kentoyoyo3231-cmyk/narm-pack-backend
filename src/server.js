require('dotenv').config();

const fs = require('fs');
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

// Serve the customer-facing web app (index.html) as a real, permanent public
// page — same Railway URL that already hosts the API now also hosts the site
// itself. We don't know for certain what the deploy's working directory
// layout looks like, so try a short list of plausible locations for
// index.html instead of hardcoding one path that might be wrong on this
// host. If none of them exist, respond with a diagnostic (checked paths +
// what's actually in the repo root) instead of a bare 404, so this is
// debuggable from the browser/logs without needing shell access to the
// container.
const INDEX_HTML_CANDIDATES = [
  path.join(__dirname, '..', 'index.html'), // <repo root>/index.html
  path.join(__dirname, 'index.html'), // <repo root>/src/index.html
  path.join(process.cwd(), 'index.html'), // wherever the process actually started from
];

app.get('/', (req, res) => {
  const found = INDEX_HTML_CANDIDATES.find((p) => fs.existsSync(p));
  if (found) {
    res.sendFile(found);
    return;
  }
  let rootListing = [];
  try {
    rootListing = fs.readdirSync(path.join(__dirname, '..'));
  } catch (e) {
    rootListing = [`(could not read dir: ${e.message})`];
  }
  res.status(500).json({
    error: 'index.html not found on server — this is a deploy/path issue, not a code bug',
    checked: INDEX_HTML_CANDIDATES,
    __dirname,
    cwd: process.cwd(),
    repoRootContents: rootListing,
  });
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
