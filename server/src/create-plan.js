// Creates the Flutterwave payment plan that powers automatic renewals, and prints its id.
// Run once:  npm run create-plan   then put the id in FLW_PLAN_ID (locally and on Vercel).
// (You can also create the plan by hand in the Flutterwave dashboard under Payments > Payment plans:
//  same amount, interval and currency as ORG_PRICE, BILLING_INTERVAL and ORG_CURRENCY.)
import 'dotenv/config';
import { createFlutterwave } from './flutterwave.js';

const amount = Number(process.env.ORG_PRICE ?? 120000);
const interval = process.env.BILLING_INTERVAL ?? 'yearly';
const currency = process.env.ORG_CURRENCY ?? 'NGN';
if (!process.env.FLW_SECRET_KEY) throw new Error('Set FLW_SECRET_KEY first');

const flw = createFlutterwave({ secretKey: process.env.FLW_SECRET_KEY });
const { id } = await flw.createPlan({ name: `Station Sales ${interval} (${currency} ${amount})`, amount, interval, currency });
console.log(`Created payment plan ${id}.\nAdd this to your environment:  FLW_PLAN_ID=${id}`);
