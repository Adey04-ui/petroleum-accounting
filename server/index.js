// The entry point, both for `npm start` and for Vercel.
//
// Vercel looks for a file named index.js (or app.js / server.js, here or in src/) that imports Express and either
// exports the app as the default export or starts a listener. This file does both: on Vercel it only exports
// (Vercel runs the app itself); everywhere else it also listens on PORT.
import 'dotenv/config';
import express from 'express';
import { createApp } from './src/createApp.js';
import { createPrismaStore } from './src/store/prisma.js';
import { createFlutterwave } from './src/flutterwave.js';

void express; // imported only so Vercel recognises this file as the Express entry point

const { JWT_SECRET, PORT = 4000, CORS_ORIGIN = '', WEB_URL = 'http://localhost:5173' } = process.env;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
if (!JWT_SECRET || JWT_SECRET.length < 16) throw new Error('JWT_SECRET must be set (at least 16 characters)');

const amount = Number(process.env.ORG_PRICE ?? 120000);
if (!Number.isInteger(amount) || amount <= 0) throw new Error('ORG_PRICE must be a whole number above 0');
const interval = process.env.BILLING_INTERVAL ?? 'yearly';
if (!['yearly', 'monthly'].includes(interval)) throw new Error("BILLING_INTERVAL must be 'yearly' or 'monthly'");
if (!process.env.FLW_PLAN_ID) console.warn('FLW_PLAN_ID is not set: customers can only pay for one period at a time (no automatic renewal). Run `npm run create-plan`.');

const flutterwave = createFlutterwave({ secretKey: process.env.FLW_SECRET_KEY });
if (!flutterwave.enabled) console.warn('FLW_SECRET_KEY is not set: payments are disabled, so new organisations cannot be created.');

const app = createApp(createPrismaStore(), {
  jwtSecret: JWT_SECRET,
  corsOrigin: CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
  flutterwave,
  webhookHash: process.env.FLW_SECRET_HASH,
  webUrl: WEB_URL,
  pricing: { amount, currency: process.env.ORG_CURRENCY ?? 'NGN', interval },
  planId: process.env.FLW_PLAN_ID || undefined,
});

if (!process.env.VERCEL) app.listen(PORT, () => console.log(`API listening on port ${PORT}`));

export default app;
