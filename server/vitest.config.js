import { defineConfig } from 'vitest/config';

// The PostgreSQL runs share one test database, so test files must not run at the same time.
export default defineConfig({ test: { fileParallelism: false } });
