import fs from 'node:fs';
import pg from 'pg';
import { createMemoryStore } from '../src/store/memory.js';
import { createPrismaStore, createPrismaClient } from '../src/store/prisma.js';

// The in-memory store always runs. Set TEST_DATABASE_URL to also run everything against a real PostgreSQL
// through Prisma (the tables are dropped and recreated each time, so use an empty test database).
const url = process.env.TEST_DATABASE_URL;
export const storeKinds = ['memory', ...(url ? ['postgres'] : [])];

export async function makeStore(kind) {
  if (kind === 'memory') return { store: createMemoryStore(), close: async () => {} };
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  await client.end();
  const prisma = createPrismaClient(url);
  return { store: createPrismaStore(prisma), close: () => prisma.$disconnect() };
}
