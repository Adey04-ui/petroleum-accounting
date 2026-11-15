# Latest update: POS declarations, date switching and comma-formatted values

This update builds on the existing project without changing the Prisma schema.

## POS declarations and charges

- Each configured payment channel whose label contains `POS` has a declaration input.
- POS declarations are stored beside their payment line in `DayEntry.data` JSON as `payments[].declaration`.
- A missing declaration is incomplete; an explicitly entered `0` is a valid declaration.
- Daily POS charges are total POS sales minus total POS declarations, but only when every configured POS channel has a declaration.
- Incomplete days do not contribute to the monthly POS-charge total.
- Completed monthly POS charges are deducted from `profitAfterExpenses`, separately from ordinary expenses and adjustments. They do not change cash reconciliation or `totalExpenses`.
- The previous Moniepoint-only declaration field and calculation have been removed. Existing older records remain readable; they simply have no new POS declaration data and therefore count as incomplete for POS charges.

## Date switching

- Selecting an empty date changes the selected date but leaves the current form values untouched.
- Selecting a date that already has a saved record loads that record into the form.
- The saved-day check runs asynchronously; stale date-check responses are ignored.
- Saving asks the user to confirm the selected date. Cancelling keeps the form values.

## Comma-formatted numbers

Numeric input processing removes commas before converting values to numbers. This applies to daily entries, station setup values and monthly adjustments. For example, `1,234,567.89` is processed as `1234567.89`.

## Database

No Prisma schema change or database migration is required for this update. POS declarations are stored in the existing `DayEntry.data` JSON field. The older deployment instructions below describe earlier project changes; their `db:push` step is not needed for this update.

## Verification

Server JavaScript syntax checks, frontend JavaScript/JSX parsing and focused runtime checks for POS calculations and comma parsing passed. The full Vitest suites were not run because dependencies were not installed in this environment (the package cache did not contain all required packages).

---

# Updating your deployed app

The archive provided for this update contains the full project in its existing `fuelapp2/` folder structure. The list of files changed in this update is in `CHANGED_FILES.txt`. Your database, Vercel projects and settings stay as they are.

## 1. Put the files in

1. Commit what you have now (so you can go back): `git add -A && git commit -m "before update"`.
2. Unzip this package over your project folder, so `server/...` and `web/...` land on your existing `server/` and `web/`. Say yes to overwrite.
3. Delete the files listed under "Delete these" at the bottom of this page (if any).
4. `cd server && npm install` and `cd ../web && npm install` (new libraries, and Prisma regenerates its client).

## 2. Update the database (adds columns, keeps your data)

Put your **direct** Neon connection string (host without `-pooler`) in `server/.env` as `DATABASE_URL`, then:

```bash
cd server
npm run db:push
```

It adds: when each organisation is paid until, the payer's email for automatic renewal, a version number on each saved day, and a few columns on payments.
Nothing is deleted. **Organisations you already have get no expiry**, so they keep working exactly as before; you can set a date for any of them
from the Platform screen (the "Date" button).

Your existing stations keep working: each product gets one tank named "Tank 1" until you rename it or add more in Settings, and every day already saved is read as before.

## 3. The new price and automatic renewal

1. In `server/.env` set `ORG_PRICE=120000`, `ORG_CURRENCY=NGN`, `BILLING_INTERVAL=yearly`, and your `FLW_SECRET_KEY`.
2. Run `npm run create-plan` (in `server/`). It creates the recurring plan at Flutterwave and prints a line like `FLW_PLAN_ID=12345`.
   (This is the one call I could not test against the real Flutterwave. If it errors, create the plan by hand in the dashboard under Payments, Payment plans: amount 120000, interval yearly, currency NGN, and use its id.)
3. On **Vercel** (API project, Settings, Environment Variables) set `ORG_PRICE=120000`, `BILLING_INTERVAL=yearly` and `FLW_PLAN_ID=<the id>`. Then **redeploy** the API and the web project.
   Without `FLW_PLAN_ID` the app still works but offers one period at a time (no automatic renewal).
4. Flutterwave's webhook URL is the same as before. Renewals and cancellations arrive on it. Keep Flutterwave's reminder emails switched on: the owner's cancel link is in them.

## 4. Try it (use Flutterwave TEST keys first)

1. Create a new account, create an organisation, pay with a Flutterwave test card. You should land on the dashboard showing "Renews automatically every year".
2. Open a station, Settings: name your tanks, list your payment types (Moniepoint POS, Zenith POS...), save.
3. Daily entry: enter a day. Try the report you shared (PMS tank 470 L, received 5,530, closing 5,780, price 1,310): you should see the 53.46 L gap and an available balance of ₦49,367.40.
4. Sign in as an attendant: add a day, then try to change it (it is locked). As the owner, change that day and set "Allowed tolerance, this day only".
5. On a phone: install the app, switch to aeroplane mode, enter a day, switch the signal back on. It uploads by itself.

## What changed, in plain words

- **Tanks:** several named tanks per product, a dip for each, deliveries go into a chosen tank, fuel can be moved between tanks or out of the station without being counted as a loss.
- **Report format:** return-to-tank per pump, pumps marked "not used today", named card/POS/transfer lines, credit sales and credit paid back, cash banked, itemised expenses, optional carried-forward balance (Settings, off by default).
- **Editing:** after a day is saved only the owner can change it. The owner can also set one day's own tolerance allowance.
- **Subscriptions:** 120,000 per year, automatic renewal by card or pay-one-period-at-a-time; 7-day grace, then read-only; owner "Renew" button; platform screen shows paid-until dates, lets you set a date by hand and match charges that Flutterwave made that do not match an organisation.
- **Offline:** installable app; days saved with no signal upload by themselves; "waiting" pill in the top bar; conflicts and refusals are kept with the reason.

## Things I could not test for real

- Flutterwave itself (plans, renewal webhooks, the create-plan call). Everything is tested against a fake that follows Flutterwave's documentation.
- The installed app and offline mode on real phones. They are tested in a simulated browser. Please test on one Android phone and, if you can, one iPhone.
- `npm run db:push` itself (it needs Prisma's migration engine, which I could not download here). The database layer is tested against a real PostgreSQL using a hand-written copy of the same tables.
