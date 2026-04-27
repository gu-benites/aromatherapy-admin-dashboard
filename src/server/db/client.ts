import 'server-only';

import postgres, { type Sql } from 'postgres';

const globalForPostgres = globalThis as typeof globalThis & {
  postgresSql?: Sql;
};

function createSqlClient() {
  const databaseUrl = process.env.DATABASE_URL_SESSION || process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL_SESSION or DATABASE_URL is required');
  }

  return postgres(databaseUrl, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 5,
    prepare: false
  });
}

function getSqlClient() {
  globalForPostgres.postgresSql ??= createSqlClient();

  return globalForPostgres.postgresSql;
}

export const sql = new Proxy((() => undefined) as unknown as Sql, {
  apply(_target, thisArg, argArray) {
    return Reflect.apply(getSqlClient(), thisArg, argArray);
  },
  get(_target, property) {
    const client = getSqlClient();
    const value = Reflect.get(client, property);

    return typeof value === 'function' ? value.bind(client) : value;
  }
}) as Sql;
