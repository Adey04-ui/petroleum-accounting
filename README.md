# Station Sales

A multi-tenant web app for fuel stations, installable on a phone and usable with no signal. Someone creates an account and
**pays with Flutterwave** (card, renewing automatically each year, or once by card/transfer/USSD) to create an **organisation**.
They get their own dashboard where they add up to **5 stations**, create staff logins, and give each person a role at each
station. Staff enter the day's report (meters, tanks, deliveries, transfers, prices, payments, credit, banking, expenses);
the app works out tolerance, available cash, profit, stock cost and the gain or loss from fuel price changes, and the owner
can download any month as Excel.

```
server/   Express API, Prisma 7 + PostgreSQL, Flutterwave billing, the calculation engine (server/src/engine)
web/      Vite + React (JSX) app, a PWA (installable, works offline), styled with Apple-style design
```

Everything is plain JavaScript.

## Who can do what

| | Can do |
|---|---|
| **Platform admin** (you) | See every organisation, suspend one, set a paid-until date by hand, match unmatched payments |
| **Organisation owner** (whoever paid) | Everything in their organisation: stations (max 5), staff and roles, station setup, cost prices and profit, **changing a saved day**, a day's own tolerance, Excel, renewing |
| **Manager** (per station) | Add a day, record deliveries (litres). Sees cash, tolerance and sales, never cost prices or profit |
| **Attendant** (per station) | Add a day. Same view as a manager, but cannot record deliveries |

**Once a day is saved, only an owner can change it.** Staff who spot a mistake ask the owner, who can correct anything,
including that one day's allowed tolerance (for example 0.8 L per 20 L changed to 1.5 L per 20 L for a single day).
Role rules live in `server/src/permissions.js`; the 5-station limit and the 7-day grace period in `server/src/limits.js`.

## The daily report

Per product (PMS, AGO): pumps (opening, closing, return-to-tank per pump, or "not used today"), a price, a dip for **each named tank**,
deliveries (into a chosen tank), and fuel **moved, not sold** (to another tank, or out of the station). Then the money: a box for each
card/POS/transfer type you list in Settings (Moniepoint, Zenith...), credit sales and credit paid back, cash banked today, itemised
expenses, and optionally a **carried-forward cash balance** (off by default; turn it on in Settings).

## Subscriptions

- A subscription period (yearly by default) is paid for with Flutterwave. **Automatic renewal** uses a Flutterwave payment plan (card only).
  Customers who prefer bank transfer or USSD can pay one period at a time instead and renew by paying again.
- A lapsed subscription gets a **7-day grace period**, then the organisation is **read-only**: everyone can still sign in, look at everything and
  download Excel, but nothing can be changed until the owner renews. Their data is never held back.
- A Flutterwave subscription belongs to an email address, so one email can have **one** automatically renewing organisation.
- Charges Flutterwave makes by itself are matched to an organisation by the payer's email. Any that cannot be matched wait on the platform screen for you to match.

## Offline use

Install it (Android: browser menu, Install app. iPhone: Safari, Share, Add to Home Screen). With no signal the app still opens, and a day you save
is kept on the phone and **uploads by itself** when the signal returns (or from the "waiting" pill in the top bar). If the server refuses a saved day, or someone
else changed that day, it stays on the phone with the reason until you decide. iPhones cannot sync in the background, so a queued day uploads the next time the app is opened.

## Try it now (no database, no Flutterwave keys)

```bash
cd server && npm install && npm run dev:memory    # API on :4000. Data is NOT saved; payments are fake
cd web    && npm install && npm run dev           # app on :5173
```

Open http://localhost:5173. Sign in as `owner@example.com` / `password123` (also `manager@`, `attendant@`, `admin@`), or choose **Create account** and "pay" for a new organisation (nobody is charged).

## Real setup

1. **Database.** Create a PostgreSQL database on Neon and copy the connection string.
2. **Server.** `cd server && cp .env.example .env`, fill it in, then:
   ```bash
   npm install            # also runs `prisma generate`
   npm run db:push        # creates or updates the tables (use the DIRECT Neon string here)
   npm run seed           # creates your platform-admin login
   npm run create-plan    # creates the Flutterwave plan; put the printed id in FLW_PLAN_ID
   npm start
   ```
3. **Flutterwave** (v3 keys). Put the **secret key** in `FLW_SECRET_KEY`. Under Settings > Webhooks set the URL to `https://YOUR-API/api/billing/webhook` and a **secret hash** of your choosing; put the same value in `FLW_SECRET_HASH`.
4. **Web.** `cd web && npm install`, then `npm run dev`, or `npm run build` for production (output in `web/dist`).

## Deploy

See `UPDATE.md` for the Vercel steps. In short: API from the `server` folder (Root Directory `server`; `DATABASE_URL` = the pooled Neon string, plus every variable in `.env.example`), web from the `web` folder with `VITE_API_URL` = your API address.

## Tests

```bash
cd server && npm test                                   # engine, API, billing, roles, tenant isolation (in-memory)
TEST_DATABASE_URL=postgresql://... npm test             # the same, ALSO against real PostgreSQL through Prisma (empty test database: it drops and recreates the tables)
cd web && npm test                                      # forms, the whole customer journey, offline saving and upload, sheet gestures (needs `npm install` in server/ too)
```

## Notes

- The phone's live preview and the server use the same formulas for everything staff are allowed to see (litres, tolerance, cash); a test checks them against each other. Cost prices and profit are only ever calculated on the server and only sent to owners.
- **Prisma 7** needs a driver adapter and reads `server/prisma.config.mjs`. `prisma-client-js` is used because it generates plain JavaScript.
- Everything is recalculated from a station's full history on each request. Fine for years of data at a handful of stations; add stored snapshots if it ever gets slow.
- Failed logins are limited to 10 per 15 minutes per address, counted in the database so the limit holds across serverless instances.
- Browser Back is not wired up; the app has its own Back button.
- Not built: refunds, email reminders and email verification at sign-up, per-tank pump mapping (tolerance is worked out per product), moving fuel between your own stations as a linked pair.
