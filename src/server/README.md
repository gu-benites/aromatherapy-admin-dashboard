# Server/API Boundary

This dashboard follows a remote API data boundary:

- Frontend code calls the AromaChat API only, currently through `https://api.aromachat.app/api/admin/trpc`.
- Frontend code must not import database clients, Supabase service clients, service-role keys, or `DATABASE_URL`.
- `src/server/**` is retained only as legacy contract/type reference during the hard cutover.
- Runtime procedures that read or mutate app data now live in the API repo under `/api/admin/trpc`.
- Keep service integrations behind API routers/services so UI screens stay replaceable and typed.

Do not re-enable local dashboard route handlers for admin database access. The API service owns Postgres/Supabase/Redis access.
