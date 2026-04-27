import 'server-only';

import postgres, { type Sql } from 'postgres';

const databaseUrl = process.env.DATABASE_URL_SESSION || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL_SESSION or DATABASE_URL is required');
}

const globalForPostgres = globalThis as typeof globalThis & {
  postgresSql?: Sql;
};

export const sql =
  globalForPostgres.postgresSql ??
  postgres(databaseUrl, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 5,
    prepare: false
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPostgres.postgresSql = sql;
}
