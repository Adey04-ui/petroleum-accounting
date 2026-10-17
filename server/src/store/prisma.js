// PostgreSQL store (Prisma 7 + the pg driver adapter). Same interface as store/memory.js.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Prisma 7 needs a driver adapter: it connects to the database itself.
 * On serverless hosts (Vercel) every instance opens its own pool, so the pool is kept small there. Use your
 * database's POOLED connection string (Neon: the host with "-pooler") so these small pools share real connections.
 */
export function createPrismaClient(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const max = Number(process.env.DB_POOL_MAX) || (process.env.VERCEL ? 3 : 10);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max }) });
}

const notFound = (e) => e?.code === 'P2025';
const unique = (e) => e?.code === 'P2002';

export function createPrismaStore(prisma = createPrismaClient()) {
  const plainOrg = ({ _count, owners, ...o }) => ({ ...o, stationCount: _count?.stations ?? 0 });

  return {
    prisma,

    // ---- rate limiting (one atomic statement, so concurrent requests cannot slip past the limit)
    async hitRateLimit(key, max, windowMs) {
      const resetAt = new Date(Date.now() + windowMs);
      const rows = await prisma.$queryRaw`
        INSERT INTO "RateLimit" ("key", "count", "resetAt") VALUES (${key}, 1, ${resetAt})
        ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE WHEN "RateLimit"."resetAt" < (NOW() AT TIME ZONE 'UTC') THEN 1 ELSE "RateLimit"."count" + 1 END,
          "resetAt" = CASE WHEN "RateLimit"."resetAt" < (NOW() AT TIME ZONE 'UTC') THEN ${resetAt} ELSE "RateLimit"."resetAt" END
        RETURNING "count"`;
      if (Math.random() < 0.01) {
        await prisma.rateLimit.deleteMany({ where: { resetAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } } }); // tidy old rows now and then
      }
      return Number(rows[0].count) <= max;
    },
    async clearRateLimit(key) {
      await prisma.rateLimit.deleteMany({ where: { key } });
    },

    // ---- users
    findUserByEmail: (email) => prisma.user.findUnique({ where: { email } }),
    findUserById: (id) => prisma.user.findUnique({ where: { id } }),
    listUsersByIds: (ids) => prisma.user.findMany({ where: { id: { in: ids } } }),
    createUser: ({ name, email, passwordHash, isPlatformAdmin = false }) =>
      prisma.user.create({ data: { name, email, passwordHash, isPlatformAdmin } }),

    // ---- payments
    createPayment: ({ txRef, userId, organisationName, amount, currency }) =>
      prisma.payment.create({ data: { txRef, userId, organisationName, amount, currency } }),
    getPaymentByTxRef: (txRef) => prisma.payment.findUnique({ where: { txRef } }),
    async markPaymentFailed(txRef) {
      await prisma.payment.updateMany({ where: { txRef, status: 'pending' }, data: { status: 'failed' } });
    },
    /**
     * Creates the organisation for a verified payment, exactly once. Organisation.paymentId is UNIQUE, so two
     * requests racing (the browser redirect and Flutterwave's webhook) cannot create two organisations.
     */
    async fulfilPayment(txRef, flwTransactionId) {
      const payment = await prisma.payment.findUnique({ where: { txRef } });
      if (!payment) throw new Error('Unknown payment');
      const existing = await prisma.organisation.findUnique({ where: { paymentId: payment.id } });
      if (existing) return { organisation: existing, created: false };
      try {
        const organisation = await prisma.$transaction(async (tx) => {
          const org = await tx.organisation.create({
            data: { name: payment.organisationName, paymentId: payment.id, owners: { create: { userId: payment.userId } } },
          });
          await tx.payment.update({ where: { id: payment.id }, data: { status: 'successful', flwTransactionId } });
          return org;
        });
        return { organisation, created: true };
      } catch (e) {
        if (unique(e)) {
          const org = await prisma.organisation.findUnique({ where: { paymentId: payment.id } });
          if (org) return { organisation: org, created: false };
        }
        throw e;
      }
    },

    // ---- organisations
    getOrganisation: (id) => prisma.organisation.findUnique({ where: { id } }),
    async updateOrganisation(id, patch) {
      const data = {};
      if (patch.name !== undefined) data.name = patch.name;
      if (patch.status !== undefined) data.status = patch.status;
      try {
        return await prisma.organisation.update({ where: { id }, data });
      } catch (e) {
        if (notFound(e)) return null;
        throw e;
      }
    },
    async listOrganisationsForUser(userId) {
      const rows = await prisma.organisation.findMany({
        where: { owners: { some: { userId } } },
        include: { _count: { select: { stations: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(plainOrg);
    },
    async listAllOrganisations() {
      const rows = await prisma.organisation.findMany({
        include: { _count: { select: { stations: true } }, owners: { include: { user: { select: { id: true, name: true, email: true } } } } },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((o) => ({ ...plainOrg(o), owners: o.owners.map((x) => x.user) }));
    },
    async isOrgOwner(userId, orgId) {
      return Boolean(await prisma.orgOwner.findUnique({ where: { userId_organisationId: { userId, organisationId: orgId } } }));
    },
    async listOrgOwnerIds(orgId) {
      return (await prisma.orgOwner.findMany({ where: { organisationId: orgId }, select: { userId: true } })).map((r) => r.userId);
    },
    async addOrgOwner(orgId, userId) {
      await prisma.orgOwner.upsert({
        where: { userId_organisationId: { userId, organisationId: orgId } },
        create: { userId, organisationId: orgId },
        update: {},
      });
    },
    async removeOrgOwner(orgId, userId) {
      await prisma.orgOwner.deleteMany({ where: { userId, organisationId: orgId } });
    },

    // ---- stations
    /** Returns null when the organisation already has `max` stations. The organisation row is locked while counting. */
    createStation({ organisationId, name, address, max }) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Organisation" WHERE id = ${organisationId} FOR UPDATE`;
        const count = await tx.station.count({ where: { organisationId } });
        if (count >= max) return null;
        return tx.station.create({ data: { organisationId, name, address: address ?? null } });
      });
    },
    getStation: (id) => prisma.station.findUnique({ where: { id } }),
    listStations: (orgId) => prisma.station.findMany({ where: { organisationId: orgId }, orderBy: { createdAt: 'asc' } }),
    async updateStation(id, patch) {
      const data = {};
      if (patch.name !== undefined) data.name = patch.name;
      if (patch.address !== undefined) data.address = patch.address;
      try {
        return await prisma.station.update({ where: { id }, data });
      } catch (e) {
        if (notFound(e)) return null;
        throw e;
      }
    },
    async deleteStation(id) {
      await prisma.station.deleteMany({ where: { id } }); // roles, settings and days go with it (ON DELETE CASCADE)
    },

    // ---- station roles (staff)
    async getStationRole(userId, stationId) {
      const r = await prisma.stationRole.findUnique({ where: { userId_stationId: { userId, stationId } } });
      return r?.role ?? null;
    },
    async setStationRole(userId, stationId, role) {
      await prisma.stationRole.upsert({
        where: { userId_stationId: { userId, stationId } },
        create: { userId, stationId, role },
        update: { role },
      });
    },
    async removeStationRole(userId, stationId) {
      await prisma.stationRole.deleteMany({ where: { userId, stationId } });
    },
    listStationRolesForUser: (userId) => prisma.stationRole.findMany({ where: { userId } }),
    listStationRolesForOrg: (orgId) => prisma.stationRole.findMany({ where: { station: { organisationId: orgId } } }),
    async removeUserFromOrg(orgId, userId) {
      await prisma.$transaction([
        prisma.orgOwner.deleteMany({ where: { userId, organisationId: orgId } }),
        prisma.stationRole.deleteMany({ where: { userId, station: { organisationId: orgId } } }),
      ]);
    },

    // ---- per-station settings and days
    async getSetting(stationId, key) {
      const r = await prisma.setting.findUnique({ where: { stationId_key: { stationId, key } } });
      return r ? r.value : null;
    },
    async setSetting(stationId, key, value) {
      await prisma.setting.upsert({
        where: { stationId_key: { stationId, key } },
        create: { stationId, key, value },
        update: { value },
      });
    },
    async listDays(stationId) {
      const rows = await prisma.dayEntry.findMany({ where: { stationId }, orderBy: { date: 'asc' } });
      return rows.map((r) => ({ date: r.date, data: r.data }));
    },
    async getDay(stationId, date) {
      const r = await prisma.dayEntry.findUnique({ where: { stationId_date: { stationId, date } } });
      return r ? { date: r.date, data: r.data } : null;
    },
    async upsertDay(stationId, date, data, updatedById) {
      await prisma.dayEntry.upsert({
        where: { stationId_date: { stationId, date } },
        create: { stationId, date, data, updatedById: updatedById ?? null },
        update: { data, updatedById: updatedById ?? null },
      });
    },
    async deleteDay(stationId, date) {
      await prisma.dayEntry.deleteMany({ where: { stationId, date } });
    },
  };
}
