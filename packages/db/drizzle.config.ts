import './src/load-env';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'mysql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'mysql://ares:ares@127.0.0.1:3306/ares',
  },
  verbose: true,
  strict: true,
});
