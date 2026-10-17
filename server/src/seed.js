// Creates the platform admin (you): PLATFORM_ADMIN_NAME, PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD in .env
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createPrismaStore } from './store/prisma.js';

const { PLATFORM_ADMIN_NAME = 'Platform Admin', PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD } = process.env;
if (!PLATFORM_ADMIN_EMAIL || !PLATFORM_ADMIN_PASSWORD || PLATFORM_ADMIN_PASSWORD.length < 8) {
  throw new Error('Set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD (8+ characters) first');
}
const store = createPrismaStore();
const email = PLATFORM_ADMIN_EMAIL.toLowerCase();
if (await store.findUserByEmail(email)) {
  console.log('That account already exists, nothing to do.');
} else {
  await store.createUser({ name: PLATFORM_ADMIN_NAME, email, passwordHash: await bcrypt.hash(PLATFORM_ADMIN_PASSWORD, 10), isPlatformAdmin: true });
  console.log(`Platform admin ${email} created.`);
}
await store.prisma.$disconnect();
