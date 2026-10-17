// LOCAL TRYOUT ONLY: runs the whole API with an in-memory store (no database) and a fake Flutterwave
// (nobody is charged). Everything is lost when you stop it. Do not deploy this.
import bcrypt from 'bcryptjs';
import { createApp } from './createApp.js';
import { createMemoryStore } from './store/memory.js';
import { createFakeFlutterwave } from './fakeFlutterwave.js';

const store = createMemoryStore();
const password = 'password123';
const passwordHash = await bcrypt.hash(password, 10);
const user = (name, email, extra = {}) => store.createUser({ name, email, passwordHash, ...extra });

const admin = await user('Platform Admin', 'admin@example.com', { isPlatformAdmin: true });
const owner = await user('Demo Owner', 'owner@example.com');
const manager = await user('Demo Manager', 'manager@example.com');
const attendant = await user('Demo Attendant', 'attendant@example.com');

await store.createPayment({ txRef: 'demo', userId: owner.id, organisationName: 'Demo Fuels', amount: 1, currency: 'NGN' });
const { organisation } = await store.fulfilPayment('demo', 'demo');
const north = await store.createStation({ organisationId: organisation.id, name: 'Ikeja Station', address: 'Ikeja, Lagos', max: 5 });
await store.createStation({ organisationId: organisation.id, name: 'Ijebu Station', address: 'Ijebu-Ode', max: 5 });
await store.setStationRole(manager.id, north.id, 'manager');
await store.setStationRole(attendant.id, north.id, 'attendant');

const port = process.env.PORT ?? 4000;
createApp(store, {
  jwtSecret: 'local-tryout-secret-local-tryout',
  flutterwave: createFakeFlutterwave(),
  webUrl: process.env.WEB_URL ?? 'http://localhost:5173',
  pricing: { amount: 10000, currency: 'NGN' },
}).listen(port, () => {
  console.log(`Tryout API on http://localhost:${port} (data is NOT saved, payments are fake)`);
  console.log(`Password for all: ${password}`);
  console.log('  owner@example.com      owns "Demo Fuels" (2 stations)');
  console.log('  manager@example.com    manager at Ikeja Station');
  console.log('  attendant@example.com  attendant at Ikeja Station');
  console.log('  admin@example.com      platform admin');
  console.log('Or create a new account and "pay" for a new organisation.');
});
