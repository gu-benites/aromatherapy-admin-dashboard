• Yes. That was the point: the admin repo proved the database workflows, but the durable API should live in ~/turborepo-docker/apps/api behind api.aromachat.app.

  Migration Plan

  1. Move the admin tRPC surface into the API repo
      - Source: bubble-to-supabase-migration/src/server/api/routers/*
      - Target: turborepo-docker/apps/api/lib/trpc/routers/admin/*
      - Current admin surface is about 99 procedures:
          - oils
          - chemistry
          - healthConcerns
          - therapeuticProperties
          - healthKnowledge
          - recipes
          - products
          - pregnancy
          - dashboard
          - system
          - viewer
          - gated testData
  2. Add proper admin auth to the API
      - Add adminProcedure to apps/api/lib/trpc/core.ts.
      - Use shared Clerk project, now already aligned.
      - Use CLERK_ADMIN_USERS in API env too.
      - Keep user/mobile procedures separate from admin procedures.
  3. Preserve validated SQL first
      - The admin repo uses postgres raw SQL heavily.
      - The API repo uses Prisma through @repo/database.
      - Best first move: add a sql client to the API context using the same postgres package and DATABASE_URL, so the already-validated admin queries can move with
        minimal behavioral risk.
      - Later, we can refactor selected pieces to Prisma if it improves maintainability.
  4. Move Redis cache helpers
      - Source: admin src/server/cache/*
      - Target: API apps/api/lib/cache/* or shared packages/redis
      - Reuse existing API Redis connection.
      - Keep cache invalidation with domain version bumps for mutations.
  5. Port the real workflow tests
      - Convert the manual fake-data validation we did into API integration tests:
          - create fake essential oil
          - edit oil fields
          - create/link/unlink health concerns
          - create/link therapeutic properties
          - create compounds
          - link compound to oil
          - update percentages
          - create recipe
          - fetch dashboard/editor context
          - cleanup fake data
      - Tests should live under apps/api/tests/admin/*.
  6. Expose admin router under API
      - Add to API root router:
          - admin.oils
          - admin.chemistry
          - admin.recipes
          - etc.
      - Keep existing mobile/client routes unchanged:
          - essentialOils
          - protocols
          - subscription
          - etc.
  7. Update admin frontend to call only api.aromachat.app
      - Remove local DB access from admin dashboard.
      - Admin frontend tRPC client points to https://api.aromachat.app/api/trpc.
      - Browser sends Clerk token.
      - API validates Clerk token and admin user ID.
  8. Deploy and cut over
      - Deploy API with new admin routers.
      - Run full API admin tests against production-like DB using obvious fake data.
      - Switch admin frontend to remote API.
      - Redeploy admin.
      - Disable/remove duplicated admin backend routes from the dashboard repo after confidence.

  The key decision: move behavior first with minimal changes, especially SQL and cache logic, then clean architecture after the API owns it. This reduces the chance of
  breaking all the workflows we already validated.

• Model changed to gpt-5.5 medium for Plan mode.

  # Migrate Admin Database API From Dashboard Repo to api.aromachat.app

  ## Summary

  Move the validated aromatherapy expert/admin database API out of /home/ubuntu/bubble-to-supabase-migration and into /home/ubuntu/turborepo-docker/apps/api, so the
  admin dashboard becomes frontend-only and talks to api.aromachat.app.

  Locked decisions:

  - Rewrite admin data access to Prisma, not raw postgres.
  - Run Prisma introspection and commit schema/generated client updates.
  - Preserve existing admin procedure names for the dashboard contract.
  - Avoid collision with the current mobile/public API by exposing admin tRPC at a separate endpoint: /api/admin/trpc.
  - Hard switch the admin dashboard to the remote API.
  - Mutation smoke tests are local-only, never automatic against deployed production.

  ## Key Changes

  ### API Repo: ~/turborepo-docker

  1. Add full admin Prisma coverage.
      - Run Prisma introspection against the same Supabase/Postgres database.
      - Commit updates to packages/database/prisma/schema.prisma.
      - Regenerate and commit packages/database/generated/client/**, since this repo already tracks generated Prisma client output.
      - Ensure these admin tables/views are available or consciously handled:
          - Core tables: oils, compounds, health concerns, therapeutic properties.
          - Admin workflow tables: recipes, recipe oils, recipe instructions, recipe application methods.
          - Product tables: products, product oils, product type assignments, product types.
          - Action-system tables and links.
          - Compound link tables: compound-property, functional group, carbon structure links.
          - Read-only views currently used by admin fetches.
      - For views that Prisma cannot model because they have no stable unique identifier, use database.$queryRaw with typed row DTOs. Do not add the standalone
        postgres client.
  2. Add admin tRPC infrastructure.
      - Keep existing /api/trpc behavior unchanged for mobile/web consumers.
      - Add a new route handler at /api/admin/trpc.
      - Add a new adminAppRouter containing the migrated admin routers with the same root names used today:
          - chemistry
          - dashboard
          - healthConcerns
          - healthKnowledge
          - oils
          - pregnancy
          - products
          - recipes
          - system
          - testData
          - therapeuticProperties
          - viewer
      - Add adminProcedure to API tRPC core:
          - Requires Clerk auth.
          - Allows only CLERK_ADMIN_USERS.
          - Throws UNAUTHORIZED when no user exists.
          - Throws FORBIDDEN when the user is not in CLERK_ADMIN_USERS.
  3. Reimplement admin routers with Prisma.
      - Move behavior from src/server/api/routers/* in the dashboard repo into API admin routers.
      - Preserve input/output shapes unless Prisma forces a safe serialization change.
      - Convert Decimal values to plain strings or numbers consistently before returning them to tRPC clients.
      - Use Prisma transactions for multi-table create/update/delete flows.
      - Use Prisma relation operations where clear; use $queryRaw only for read-only views or database features Prisma cannot model.
      - Keep destructive cleanup/test-data mutations behind TRPC_ENABLE_TEST_MUTATIONS=1 and non-production checks.
  4. Add API Redis cache helpers for admin data.
      - Reuse @repo/redis.
      - Port the admin cache behavior:
          - versioned domain keys
          - cache health
          - invalidation after mutations
      - Use a new prefix, for example aroma-api-admin:v1, to avoid colliding with old dashboard cache keys.
      - Invalidate these domains after writes:
          - dashboard
          - oils
          - chemistry
          - healthKnowledge
          - recipes
          - products
          - pregnancy
  5. Update API env and deployment config.
      - Add to API dev and deployed envs:
          - CLERK_ADMIN_USERS=user_33AD3olib22lZ15a4F88Q6Bk14c,user_32xryWfAf4UcAdIyeiVQ1UHSn3J
          - NEXT_PUBLIC_ADMIN_URL=https://admin.aromachat.app
          - TRPC_ENABLE_TEST_MUTATIONS=0 for deployed production.
      - Update API CORS to allow https://admin.aromachat.app.
      - Keep existing Clerk and Sentry values already aligned.
      - Rebuild and redeploy aromachat-api.

  ### Admin Dashboard Repo: ~/bubble-to-supabase-migration

  1. Hard switch frontend tRPC to the remote API.
      - Change the tRPC client URL from /api/trpc to https://api.aromachat.app/api/admin/trpc.
      - Add auth headers from Clerk:
          - Browser client: use Clerk token in Authorization: Bearer <token>.
          - Server helpers, if kept: use server-side Clerk getToken() and forward the same header.
      - Keep the existing procedure names at call sites.
  2. Remove runtime local backend usage.
      - Stop using the local /api/trpc route for admin database operations.
      - Remove or disable the local route handler after the remote API passes tests.
      - Keep type-only code temporarily only if needed for current compile stability; no dashboard runtime code may connect directly to Postgres, Redis, Supabase, or
        local tRPC services.
  3. Keep frontend-only rule explicit.
      - Dashboard may call only api.aromachat.app.
      - API owns all database, Redis, Supabase/Postgres, mutation, and cache behavior.

  ## Test Plan

  ### API Unit and Contract Tests

  Add tests under apps/api/tests/admin or apps/api/lib/trpc/routers/admin/__tests__.

  Required auth tests:

  - Anonymous admin query fails with UNAUTHORIZED.
  - Authenticated non-admin user fails with FORBIDDEN.
  - Admin user from CLERK_ADMIN_USERS succeeds.
  - testData mutations fail unless TRPC_ENABLE_TEST_MUTATIONS=1 and environment is non-production.

  Required router registration tests:

  - /api/trpc still exposes existing mobile/public routers.
  - /api/admin/trpc exposes admin routers.
  - Existing essentialOils procedures still work.
  - Admin oils procedures do not overwrite public/mobile essentialOils.

  Required Prisma behavior tests:

  - Create/update/read oil.
  - Link/unlink application method.
  - Link/unlink pregnancy status.
  - Upsert/remove child safety.
  - Upsert/remove pet safety.
  - Create/update/read compound.
  - Link/unlink compound to therapeutic property.
  - Upsert/remove compound percentage link on oil.
  - Create/update/read health concern.
  - Link/unlink health concern to oil.
  - Create/update/read therapeutic property.
  - Link/unlink therapeutic property to oil.
  - Create/update/read recipe.
  - Add/update/remove recipe oils, instructions, and application methods.
  - Create/update/read product.
  - Add/remove product oil and product type assignment.
  - Cache invalidates after write and returns fresh read.

  ### Local-Only Smoke Tests

  Port the existing dashboard scripts into the API repo:

  - expert-workflow
  - fetch-workflow
  - cache-workflow

  Run only against a local API server:

  - Default URL: http://127.0.0.1:3002.
  - Require explicit local env:
      - TRPC_DEV_AUTH_ENABLED=1
      - TRPC_DEV_AUTH_TOKEN=...
      - TRPC_ENABLE_TEST_MUTATIONS=1
  - Use fake data prefix:
      - CODEX_DELETE_ME_TRPC_<timestamp>
  - Cleanup must run before and after the smoke workflow.
  - Never run these mutation smoke tests automatically in production CI.

  Acceptance criteria for local smoke:

  - Create fake oil.
  - Create health concern.
  - Link health concern to oil.
  - Create therapeutic property.
  - Link property to oil.
  - Create chemical compound.
  - Link compound to property.
  - Link compound to oil with min/max/typical percentages.
  - Edit percentages and verify readback.
  - Create recipe.
  - Add recipe oil.
  - Add preparation and usage instructions.
  - Add application method.
  - Create product.
  - Add product oil.
  - Fetch dashboard summary.
  - Fetch oil detail/editor context.
  - Fetch chemistry detail.
  - Fetch recipe detail.
  - Fetch health knowledge detail.
  - Verify cache hit on second cacheable read.
  - Cleanup all fake data.

  ### Deployment Validation

  After deploying API:

  - GET https://api.aromachat.app/health returns 200.
  - GET https://api.aromachat.app/api reports Redis and database connected.
  - Admin tRPC anonymous call rejects.
  - Admin tRPC authenticated admin call succeeds.
  - API logs have no Clerk, Prisma, Sentry, or Redis startup errors.

  After deploying dashboard:

  - https://admin.aromachat.app/auth/sign-in returns 200.
  - https://admin.aromachat.app/dashboard/overview redirects to /auth/sign-in when signed out.
  - After signing in as gustavo@inovado.com.br, dashboard calls hit https://api.aromachat.app/api/admin/trpc.
  - Browser console has no CORS, Clerk, or tRPC errors.
  - No dashboard request touches local /api/trpc for database workflows.

  ## Implementation Order

  1. Prepare API auth/env/CORS.
  4. Implement admin router modules in API with Prisma.
  7. Run API typecheck/build/tests locally.
  8. Deploy API container.
  9. Hard switch dashboard tRPC client to remote admin endpoint.
  10. Remove or disable dashboard local tRPC runtime.
  11. Rebuild/deploy dashboard.
  12. Validate with Playwright login and network/console inspection.

  ## Assumptions

  - The existing API Clerk project remains the single auth authority.
  - Admin users are:
      - user_33AD3olib22lZ15a4F88Q6Bk14c
      - user_32xryWfAf4UcAdIyeiVQ1UHSn3J
  - The existing API database URL points to the same Supabase/Postgres dataset used by the dashboard validation.
  - api.aromachat.app remains the only backend consumed by the dashboard.
  - Production mutation smoke tests are intentionally out of scope.
  - Prisma is the canonical implementation target; $queryRaw is allowed only through Prisma for read-only views or unsupported database constructs.