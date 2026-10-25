import express from 'express';
import cors from 'cors';
import { ValidationError } from './engine/index.js';
import { HttpError } from './http.js';
import { createAuth, createStationContext } from './middleware.js';
import { createFlutterwave } from './flutterwave.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes } from './routes/billing.js';
import { organisationRoutes } from './routes/organisations.js';
import { stationRoutes } from './routes/station.js';
import { platformRoutes } from './routes/platform.js';

/**
 * @param store        a store (store/memory.js or store/prisma.js)
 * @param jwtSecret    long random string
 * @param flutterwave  a client from createFlutterwave() (tests pass a fake one)
 * @param webhookHash  the "secret hash" you set in the Flutterwave dashboard for webhooks
 * @param webUrl       where the web app lives (Flutterwave sends the customer back here)
 * @param pricing      { amount, currency, interval } what one billing period costs ('yearly' or 'monthly')
 * @param planId       Flutterwave payment-plan id; when set, customers can pay once and be charged automatically each period
 */
export function createApp(
  store,
  {
    jwtSecret,
    corsOrigin,
    flutterwave = createFlutterwave({}),
    webhookHash,
    webUrl = 'http://localhost:5173',
    pricing = { amount: 120000, currency: 'NGN', interval: 'yearly' },
    planId,
    loginLimit = 10,
  } = {}
) {
  if (!jwtSecret) throw new Error('jwtSecret is required');
  if (!Number.isInteger(pricing.amount) || pricing.amount <= 0) throw new Error('pricing.amount must be a whole number above 0');
  if (!['yearly', 'monthly'].includes(pricing.interval)) throw new Error("pricing.interval must be 'yearly' or 'monthly'");

  const app = express();
  app.set('trust proxy', 1); // behind Render/Railway/Vercel, so rate limits see the real client address
  app.use(cors({ origin: corsOrigin?.length ? corsOrigin : true }));
  app.use(express.json({ limit: '200kb' }));

  const auth = createAuth(store, jwtSecret);

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api', authRoutes({ store, jwtSecret, auth, pricing, flutterwave, loginLimit, autoRenewAvailable: Boolean(planId) }));
  app.use('/api/billing', billingRoutes({ store, auth, flutterwave, pricing, planId, webUrl: webUrl.replace(/\/$/, ''), webhookHash }));
  app.use('/api/organisations/:orgId', organisationRoutes({ store, auth, pricing }));
  app.use('/api/stations/:stationId', auth, createStationContext(store), stationRoutes(store));
  app.use('/api/platform', platformRoutes({ store, auth, pricing }));

  app.use((err, req, res, next) => {
    if (err instanceof ValidationError) return res.status(422).json({ error: 'These numbers do not add up', errors: err.errors });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });

  return app;
}
