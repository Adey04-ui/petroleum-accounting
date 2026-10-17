-- Hand-written equivalent of prisma/schema.prisma, used ONLY by the tests (so they can run on a plain
-- PostgreSQL without Prisma's migration engine). In real use, `npm run db:push` creates the tables.
DROP TABLE IF EXISTS "RateLimit", "Payment", "DayEntry", "Setting", "StationRole", "Station", "OrgOwner", "Organisation", "User" CASCADE;

CREATE TABLE "User" (
  "id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL, "email" TEXT NOT NULL, "passwordHash" TEXT NOT NULL,
  "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "Payment" (
  "id" TEXT PRIMARY KEY, "txRef" TEXT NOT NULL, "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "organisationName" TEXT NOT NULL, "amount" INTEGER NOT NULL, "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending', "flwTransactionId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Payment_txRef_key" ON "Payment"("txRef");
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

CREATE TABLE "Organisation" (
  "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'active',
  "paymentId" TEXT REFERENCES "Payment"("id") ON DELETE SET NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Organisation_paymentId_key" ON "Organisation"("paymentId");

CREATE TABLE "OrgOwner" (
  "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "organisationId" TEXT NOT NULL REFERENCES "Organisation"("id") ON DELETE CASCADE,
  PRIMARY KEY ("userId", "organisationId")
);
CREATE INDEX "OrgOwner_organisationId_idx" ON "OrgOwner"("organisationId");

CREATE TABLE "Station" (
  "id" TEXT PRIMARY KEY, "organisationId" TEXT NOT NULL REFERENCES "Organisation"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL, "address" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Station_organisationId_idx" ON "Station"("organisationId");

CREATE TABLE "StationRole" (
  "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "stationId" TEXT NOT NULL REFERENCES "Station"("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL, PRIMARY KEY ("userId", "stationId")
);
CREATE INDEX "StationRole_stationId_idx" ON "StationRole"("stationId");

CREATE TABLE "Setting" (
  "stationId" TEXT NOT NULL REFERENCES "Station"("id") ON DELETE CASCADE,
  "key" TEXT NOT NULL, "value" JSONB NOT NULL, PRIMARY KEY ("stationId", "key")
);

CREATE TABLE "DayEntry" (
  "stationId" TEXT NOT NULL REFERENCES "Station"("id") ON DELETE CASCADE,
  "date" TEXT NOT NULL, "data" JSONB NOT NULL, "updatedById" INTEGER, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("stationId", "date")
);

CREATE TABLE "RateLimit" ("key" TEXT PRIMARY KEY, "count" INTEGER NOT NULL, "resetAt" TIMESTAMP(3) NOT NULL);
