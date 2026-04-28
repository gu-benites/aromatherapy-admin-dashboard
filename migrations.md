• Yes, moving the admin dashboard into ~/turborepo-docker makes sense now.

  My recommendation: move it into the monorepo, but not as a rushed file move. Do it as a controlled migration to apps/admin

  Why it makes sense:

  - The dashboard and API are now tightly coupled through tRPC types.
  - The current cross-repo type import is fragile, especially for Docker builds.
  - Shared packages like @repo/api-client, auth, observability, database types, Redis, and config are already in the turborepo.
  - CI/build/typecheck will be easier to reason about from one workspace.
  - Deployment can still remain separate: API container and admin dashboard container, same repo.

  Main risk:

  - The dashboard currently has its own Next 16 / React 19 / Tailwind v4 / package versions. The turborepo API is Next 15 in apps/api. Moving it may expose dependency/
    version conflicts unless isolated correctly.

  Best path, probability estimate:
  | Option | My read |
  |---|---:|
  | Move dashboard into turborepo-docker/apps/admin, keep it as an independent workspace app with its own dependencies first | 90% |

  I’d do this in phases:

  1. Add apps/admin to turborepo-docker.
  2. Copy dashboard source, configs, Dockerfile, scripts, public assets.
  3. Make it a workspace package, but initially preserve its own dependency versions.
  4. Replace dashboard tsconfig cross-repo paths with normal workspace imports.
  5. Verify pnpm --filter admin build, typecheck, lint/format.
  6. Update Docker build/deploy paths to build from monorepo.
  7. Only after that, consolidate shared config/dependencies.

  So: yes, move it. The admin dashboard is no longer an independent migration artifact; it is now part of the AromaChat platform surface.

• Findings

  1. Current type dataflow can silently degrade.
     The dashboard imports AdminAppRouter from @repo/api-client/admin in src/trpc/react.tsx:9, but tsconfig.json:18 still has cross-repo path fallbacks, including src/
     types/api-client-admin.ts:1. That fallback is an empty router type, so an isolated build can compile while losing real admin procedure type coverage. Moving into
     the monorepo fixes this only if the fallback is removed.
  2. Dependency isolation is mandatory for phase 1.
     The dashboard is Next 16 / React 19.2 / Tailwind v4 / newer Clerk and Sentry in package.json:24. The turborepo apps are mostly Next 15 / React 19.1, for example /
     home/ubuntu/turborepo-docker/apps/api/package.json:19. Do not try to consolidate versions during the move.
  3. Docker/build dataflow must change deliberately.
     The dashboard currently builds as a standalone repo via Dockerfile:1. Turborepo apps use monorepo-root builds with turbo prune, as in /home/ubuntu/turborepo-
     docker/apps/api/Dockerfile:11. The admin image should be built from the monorepo root with a new apps/admin/Dockerfile.
  4. “Frontend-only” is not fully clean if copied as-is.
     The dashboard still has local API routes such as src/app/api/products/route.ts:1. They appear mock/demo-oriented, not DB-backed, but they are still backend route
     surface. If the rule is strict, remove or disable them during migration.
  5. Legacy backend dependencies and env vars will pollute the monorepo.
     The dashboard still carries postgres, redis, and backend-style env examples. Those should not become part of the admin app unless there is a proven runtime use.
     The admin runtime should need Clerk public config, Sentry config, and the admin API URL, not DB/Redis/test mutation envs.
  6. Naming and port collisions need to be avoided.
     The monorepo already has apps/app named app and using port 3000. The moved dashboard should be apps/admin, with package name admin, and a distinct dev port such as 3004.

  Verdict

  Yes, move it into turborepo-docker, but your proposed “independent workspace app first” path is the right constraint. The move should preserve the dashboard’s own
  dependency versions and tooling first, then remove cross-repo hacks, then clean runtime boundaries.

  Target Dataflow

  Runtime should stay:

  Browser -> apps/admin Next app -> Clerk getToken() -> https://api.aromachat.app/api/admin/trpc -> apps/api adminProcedure -> Prisma/Redis/Postgres

  Type/build flow should become:

  apps/admin -> workspace @repo/api-client/admin -> apps/api AdminAppRouter type

  No ../turborepo-docker path aliases. No fallback empty router. No direct dashboard import of API runtime server code.

  Revised Migration Plan

  1. Create apps/admin in /home/ubuntu/turborepo-docker.
  2. Copy dashboard source, configs, public assets, Dockerfile logic, and scripts.
  3. Set package name to admin; preserve current dashboard dependencies initially.
  4. Add @repo/api-client: workspace:*.
  5. Remove the local fallback AdminAppRouter shim and cross-repo tsconfig paths.
  6. Keep admin tRPC URL configurable, preferably NEXT_PUBLIC_ADMIN_API_URL, defaulting to https://api.aromachat.app/api/admin/trpc.
  7. Remove or disable local DB/Redis/server runtime code from the moved app.
  8. Decide whether mock /api/products and /api/users stay as demo routes or are removed for strict frontend-only compliance.
  9. Add apps/admin/Dockerfile using monorepo-root turbo prune admin --docker.
  10. Verify with pnpm --filter admin build, typecheck, lint/format, and browser network inspection.
  11. Update deployment to build the admin image from the monorepo root.
  12. Only after that, consolidate shared configs and dependency versions.

  Required Gates

  Before calling the move successful:

  - pnpm --filter admin build passes.
  - Typecheck proves real AdminAppRouter procedures, with no empty fallback.
  - rg '../turborepo-docker|../bubble-to-supabase-migration' apps/admin returns nothing meaningful.
  - No admin runtime imports DB, Redis, local tRPC server, or API context.
  - Browser calls only https://api.aromachat.app/api/admin/trpc for admin data.
  - Docker build works from /home/ubuntu/turborepo-docker.
  - Signed-out redirect and signed-in Clerk admin call both work.

  Your 90% estimate is reasonable only under those constraints. If dependency consolidation or cleanup is mixed into the initial file move, the risk goes up sharply.

• Verdict
  Yes, move it to /home/ubuntu/turborepo-docker/apps/admin, but treat this as a controlled app migration, not a blind repo copy.

  My probability read:

  | Path | Success probability | Notes |
  |---|---:|---|
  | Move as independent apps/admin, preserve deps first, remove cross-repo shims/server runtime | 88-90% | Best path |
  | Copy dashboard as-is into apps/admin and clean later | 65% | Moves legacy server and mock API surface into monorepo |
  | Move and immediately consolidate deps/config/UI packages | 50-60% | Too many variables at once |

  Current Dataflow
  Runtime target should be:

  Browser
  -> apps/admin Next app
  -> Clerk getToken()
  -> https://api.aromachat.app/api/admin/trpc
  -> apps/api admin tRPC handler
  -> Clerk verifyToken + CLERK_ADMIN_USERS gate
  -> Prisma/Redis/Postgres

  That is mostly in place on the API side. The dashboard client already creates a typed tRPC client and sends Clerk bearer tokens to the remote admin endpoint in src/
  trpc/react.tsx:9. The API admin route verifies bearer tokens and admin IDs in /home/ubuntu/turborepo-docker/apps/api/lib/trpc/admin/core.ts:60, and its route handler
  avoids token-prefix logging in /home/ubuntu/turborepo-docker/apps/api/app/api/admin/trpc/handler.ts:13.

  Main Findings

  1. The dashboard type flow is still fragile.
     tsconfig.json:18 points across repos and then falls back to an empty router shim in src/types/api-client-admin.ts:12. After moving into the monorepo, delete that
     fallback. The only type source should be @repo/api-client/admin.
  2. The dashboard still carries legacy backend runtime code.
     src/server/README.md:7 says src/server/** is legacy only, but the files still import Postgres and Redis, for example src/server/api/trpc.ts:6. Do not move this
     into apps/admin unless it is quarantined or deleted.
  3. Local mock API routes remain.
     src/app/api/products/route.ts:21 and src/app/api/users/route.ts:21 expose mock route handlers. They are not DB-backed, but they violate a strict “frontend-only
     admin” rule.
  4. There are no Aroma admin UI screens wired yet.
     I found the tRPC provider, but no real api.oils.*, api.recipes.*, etc. hook usage in dashboard source. The move is therefore mostly app shell + future admin UI
     placement, not a complete UI data migration.
  5. Dependency isolation is required.
     Dashboard is Next 16.2.1, React 19.2.4, tRPC 11.16.0 in package.json:67. Turborepo apps are mostly Next 15 / React 19.1. Keep the admin app independent first.
  6. Local admin dev needs CORS/auth attention.
     API CORS dev fallbacks include ports 3000-3002 only in /home/ubuntu/turborepo-docker/apps/api/lib/trpc/cors.ts:11. If apps/admin runs on 3004, add
     http://localhost:3004 or set NEXT_PUBLIC_ADMIN_URL=http://localhost:3004 in local API env.

  Detailed Migration Sketch

  1. Create apps/admin in /home/ubuntu/turborepo-docker.
  2. Copy only the dashboard app assets needed for runtime:
     src, public, components.json, next.config.ts, postcss.config.js, Dockerfile logic, scripts needed by the app. Exclude .git, .next, node_modules, old .agents, and
     stale generated files.
  3. Rename package:
     name: "admin", dev port 3004, keep current dependencies initially. Add @repo/api-client: workspace:*.
  4. Replace TypeScript paths:
     keep @/* -> ./src/*; use monorepo paths for @repo/*; remove ../turborepo-docker; delete src/types/api-client-admin.ts.
  5. Make tRPC URL configurable:
     use NEXT_PUBLIC_ADMIN_TRPC_URL, defaulting to https://api.aromachat.app/api/admin/trpc.
  6. Delete or quarantine frontend-forbidden backend code:
     remove src/server/**, remove postgres, redis, server-only, DB/Redis env examples, and move admin smoke tests to apps/api if still needed.
  7. Decide on demo routes:
     either delete src/app/api/products and src/app/api/users, or clearly mark them as disabled/demo-only. For strict frontend-only, delete them.
  8. Add apps/admin/Dockerfile using monorepo root build:
     mirror API’s turbo prune admin --docker pattern, but do not build database. Build with pnpm turbo run build --filter=admin --only.
  9. Add API local support:
     add http://localhost:3004 to dev CORS fallback or configure API NEXT_PUBLIC_ADMIN_URL per environment.
  10. Verify gates:
     pnpm install, pnpm --filter admin typecheck, pnpm --filter admin lint, pnpm --filter admin build, Docker build from monorepo root, and rg '../turborepo-docker|../
     bubble-to-supabase-migration|src/server|@/server|DATABASE_URL|REDIS_URL|fallbackAdminRouter' apps/admin.
  11. Browser validation:
     signed-out redirect works, signed-in admin loads, network calls go only to /api/admin/trpc on api.aromachat.app or configured local API, no local dashboard DB/
     Redis calls.
  12. Deployment:
     update the live admin compose build context to /home/ubuntu/turborepo-docker, Dockerfile to apps/admin/Dockerfile, keep Traefik labels and container port behavior
     unchanged.

  No code changes made in this review pass.

• This review is solid. I would treat it as the migration checklist.

  The two items I would make non-negotiable before starting:

  1. Do not move src/server/** into apps/admin.
     Since it is already marked legacy-only and still imports Postgres/Redis, copying it creates exactly the backend runtime ambiguity we are trying to remove.
  2. Delete the empty router fallback during the move.
     apps/admin must fail typecheck if @repo/api-client/admin is unavailable. A fallback empty router makes the build look healthy while hiding broken admin procedure
     types.

  I would slightly adjust the order:

  1. Add API local CORS support for the future admin port first, likely http://localhost:3004.
  2. Create apps/admin with preserved dashboard deps.
  3. Copy only runtime frontend files, excluding src/server/**, local backend smoke scripts, .next, node_modules, and repo metadata.
  4. Wire @repo/api-client: workspace:*.
  5. Remove cross-repo tsconfig paths and fallback type shim.
  6. Make the admin tRPC URL env-configurable.
  7. Decide whether to delete mock /api/products and /api/users; for strict frontend-only, delete them.
  8. Add monorepo Dockerfile using turbo prune admin --docker.
  9. Run the verification gates.

  The conclusion is unchanged: move it, but keep it isolated first. The biggest success factor is preserving dependency versions while removing runtime/backend
  ambiguity and cross-repo typing hacks.

A later model-level
    25 + * refactor should replace supported table operations with Prisma model calls.


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