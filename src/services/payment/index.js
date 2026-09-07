// Picks the active payment provider based on PAYMENT_PROVIDER in .env.
// Defaults to "mock" so the app runs out of the box with no external
// account needed. Set PAYMENT_PROVIDER=beam once beamProvider.js is
// filled in and you have real Beam credentials.

const providerName = (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();

const provider = providerName === 'beam' ? require('./beamProvider') : require('./mockProvider');

if (providerName !== 'mock' && providerName !== 'beam') {
  console.warn(`[payment] Unknown PAYMENT_PROVIDER "${providerName}", falling back to mock`);
}

module.exports = provider;
