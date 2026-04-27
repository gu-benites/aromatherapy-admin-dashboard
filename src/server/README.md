# Server/API Boundary

This dashboard follows a backend-first data boundary:

- Frontend code calls the application API only, currently through `/api/trpc`.
- Frontend code must not import database clients, Supabase service clients, service-role keys, or `DATABASE_URL`.
- `src/server/**` owns Postgres/Supabase/service access.
- tRPC procedures that read or mutate app data must use `protectedProcedure`, which requires Clerk auth.
- Keep service integrations behind routers/services so UI screens stay replaceable and typed.

The initial API uses direct Postgres access because this Supabase instance is self-hosted and the migrated data already lives in Postgres tables and views.
