// Prisma 7 configuration. Prisma 7 no longer reads .env by itself, so we load it here.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// DATABASE_URL is only needed for commands that talk to the database (db push, studio).
// `prisma generate` (which runs on npm install) must work before you have created your .env file.
const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  ...(url ? { datasource: { url } } : {}),
});
