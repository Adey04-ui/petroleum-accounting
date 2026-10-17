# Station Sales

A multi-tenant web app for fuel stations. Someone creates an account, **pays once with Flutterwave** to create an
**organisation**, and gets their own dashboard where they add up to **5 stations**, create staff logins, and give each
person a role at each station. Staff enter the day's meter readings, dips, deliveries, prices and banking figures; the
app works out tolerance, cash to lodge, profit, stock cost and the gain or loss from fuel price changes, and the owner
can download any month as Excel.

```
server/   Express API, Prisma 7 + PostgreSQL, Flutterwave billing, the calculation engine (server/src/engine)
web/      Vite + React (JSX) app, styled with Apple-style design (springs, sheets, translucent materials)
```

Everything is plain JavaScript.

## Who is who

| | Can do |
|---|---|
| **Platform admin** (you) | See every organisation, suspend or reactivate one |
| **Organisation owner** (whoever paid) | Add/rename/delete stations (max 5), add staff and set roles, set up each station, see cost prices and profit, download Excel, add other owners |
| **Manager** (per station) | Enter daily figures and record deliveries (litres). Sees cash, tolerance and sales, never cost prices or profit |
| **Attendant** (per station) | Enter daily figures. Same view as a manager, but cannot change deliveries |

A person can have a different role at each station, and can belong to several organisations. The role rules live in
`server/src/permissions.js`; the 5-station limit is in `server/src/limits.js`.

## Try it now (no database, no Flutterwave keys)

```bash
cd server && npm install && npm run dev:memory    # API on :4000. Data is NOT saved; payments are fake
cd web    && npm install && npm run dev           # app on :5173
```

Open http://localhost:5173. Sign in as `owner@example.com` / `password123` (also `manager@`, `attendant@`, `admin@`),
or choose **Create account** and "pay" for a brand-new organisation (nobody is charged).

## Real setup

1. **Database.** Create a PostgreSQL database on Neon and copy the connection string.
2. **Server.** `cd server && cp .env.example .env`, fill it in (see the comments inside), then:
   ```bash
   npm install            # also runs `prisma generate`
   npm run db:push        # creates the tables (Prisma 7 reads DATABASE_URL via prisma.config.mjs)
   npm run seed           # creates your platform-admin login
   npm start
   ```
3. **Flutterwave.** In the dashboard: copy your **secret key** into `FLW_SECRET_KEY`. Under Settings > Webhooks set the URL to
   `https://YOUR-API/api/billing/webhook` and a **secret hash** of your choosing, and put the same value in `FLW_SECRET_HASH`.
   Start with your *test* keys; switch to live keys when you are ready. These are Flutterwave **v3** keys.
4. **Web.** `cd web && npm install`, then `npm run dev`, or `npm run build` for production (output in `web/dist`).

## Deploy

### API on Vercel

Vercel runs the whole Express app as one serverless function. The project is already set up for it (`server/index.js` is the entry point
Vercel looks for; it exports the app and only listens on a port when it is *not* running on Vercel).

1. **Neon:** use the **pooled** connection string (the host contains `-pooler`) as `DATABASE_URL` on Vercel. Use the **direct** one on your own computer for `npm run db:push`.
   Pick a Neon region near your users (for Nigeria, a European one such as Frankfurt or London).
2. **Create the tables from your computer, not from Vercel:** put the direct string in `server/.env` and run `npm run db:push` and `npm run seed`. Run `db:push` again whenever the schema changes.
3. **Vercel project:** import the repository and set **Root Directory** to `server`. Leave the build settings alone: `npm install` runs `prisma generate` automatically.
4. **Environment variables** (Project Settings > Environment Variables): `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN` (your web address, no trailing slash),
   `WEB_URL` (same address), `ORG_PRICE`, `ORG_CURRENCY`, `FLW_SECRET_KEY`, `FLW_SECRET_HASH`. (`PLATFORM_ADMIN_*` are only needed on your computer for the seed.)
5. **Function region** (Project Settings > Functions): choose the region closest to your Neon database. A function in the US talking to a database in Europe makes every request slower.
6. **Flutterwave webhook URL:** `https://YOUR-API.vercel.app/api/billing/webhook`.
7. Vercel's free **Hobby** plan is for personal, non-commercial use. A paid product needs the **Pro** plan.

### API anywhere else (Render, Railway, ...)

Root directory `server`. Build `npm install && npx prisma db push`. Start `npm start`. Same environment variables.

### Web (Vercel, Netlify, Render static)

Root directory `web`, framework Vite, variable `VITE_API_URL` = your API address (no trailing slash).

## How paying works

1. The signed-in user enters an organisation name; the API records a **pending** payment and asks Flutterwave for a payment page.
2. They pay on Flutterwave, which sends them back to `WEB_URL/?payment=return&...`.
3. The app asks the API to confirm; **the API asks Flutterwave** whether that transaction really succeeded, for the right amount, currency and reference.
4. Only then is the organisation created, with the payer as its owner. Flutterwave's webhook does the same check in case the customer closed the page early.
   Either path (or both) creates the organisation **exactly once** (enforced by a unique constraint in the database).

Not built: renewals or subscriptions (the payment is one-off), refunds, and email verification at sign-up.

## Tests

```bash
cd server && npm test                                   # engine, API, roles, tenant isolation, billing (in-memory)
TEST_DATABASE_URL=postgresql://... npm test             # the same, ALSO against real PostgreSQL through Prisma (use an empty test database: it drops and recreates the tables)
cd web && npm test                                      # click-through of the whole journey incl. the sheet gestures (needs `npm install` in server/ too)
```

## Notes

- **Prisma 7** needs a driver adapter (`@prisma/adapter-pg`) and reads its settings from `server/prisma.config.mjs`. The `prisma-client-js`
  generator is used because it produces plain JavaScript; the newer `prisma-client` generator only outputs TypeScript.
- Everything is recalculated from a station's full history on each request. Fine for years of data at a handful of stations; add stored snapshots if it ever gets slow.
- The login token is kept in the browser's local storage and sessions last 12 hours. Failed logins are limited to 10 per 15 minutes per address, counted in the database so the limit holds across serverless instances.
- Browser Back is not wired up; the app has its own Back button.
