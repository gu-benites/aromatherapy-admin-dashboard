# AGENTS.md - AI Coding Agent Reference

Clerk User to debug auth issues or any user facing feature/app
  - Email: gustavo@inovado.com.br
  - Password: Zy05Wx3%INO


This file provides essential information for AI coding agents working on this project. It contains project-specific details, conventions, and guidelines that complement the README.

---

## Project Overview

**Next.js Admin Dashboard Starter** is a production-ready admin dashboard template built with:

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5.7
- **Styling**: Tailwind CSS v4
- **UI Components**: shadcn/ui (New York style)
- **Authentication**: Clerk (with Organizations/Billing support)
- **Error Tracking**: Sentry
- **Charts**: Recharts
- **Containerization**: Docker (Node.js Dockerfile)
- **Package Manager**: pnpm

The project follows a feature-based folder structure designed for scalability in SaaS applications, internal tools, and admin panels.

---

## Technology Stack Details

### Core Framework & Runtime

- Next.js 16.0.10 with App Router
- React 19.2.0
- TypeScript 5.7.2 with strict mode enabled

### Styling & UI

- Tailwind CSS v4 (using `@import 'tailwindcss'` syntax)
- PostCSS with `@tailwindcss/postcss` plugin
- shadcn/ui component library (Radix UI primitives)
- CSS custom properties for theming (OKLCH color format)

### State Management

- Zustand 5.x for local UI state (chat, kanban, notifications)
- Nuqs for URL search params state management
- TanStack Form + Zod for form handling (via `useAppForm` hook)

### Data Fetching & Caching

- TanStack React Query for data fetching, caching, and mutations
- Server-side prefetching with `HydrationBoundary` + `dehydrate`
- Client-side `useQuery` + nuqs `shallow: true` for tables (no RSC round-trips on pagination/filter)
- `useMutation` + `invalidateQueries` for form submissions
- Query client singleton in `src/lib/query-client.ts`

### Authentication & Authorization

- Clerk for authentication and user management
- Clerk Organizations for multi-tenant workspaces
- Clerk Billing for subscription management (B2B)
- Client-side RBAC for navigation visibility

### Data & APIs

- TanStack Table for data tables
- TanStack React Query for data fetching and mutations
- Recharts for analytics/charts
- tRPC is the primary API boundary for AromaChat admin data
- Service layer per feature (`api/types.ts` → `api/service.ts` → `api/queries.ts`)
- Route handlers at `src/app/api/` (for Route Handler or BFF patterns)
- Mock data in `src/constants/mock-api*.ts` (default, swap via service layer)
- API client utility in `src/lib/api-client.ts` (for fetch-based patterns)

### Development Tools

- ESLint 8.x with Next.js core-web-vitals config
- Prettier 3.x with prettier-plugin-tailwindcss
- Husky for git hooks
- lint-staged for pre-commit formatting

---

## Project Structure

```
/src
├── app/                    # Next.js App Router
│   ├── auth/              # Authentication routes (sign-in, sign-up)
│   ├── dashboard/         # Dashboard routes
│   │   ├── overview/      # Parallel routes (@area_stats, @bar_stats, etc.)
│   │   ├── product/       # Product management pages
│   │   ├── kanban/        # Kanban board page
│   │   ├── chat/          # Messaging page
│   │   ├── notifications/ # Notifications page
│   │   ├── workspaces/    # Organization management
│   │   ├── billing/       # Subscription billing
│   │   ├── exclusive/     # Pro plan feature example
│   │   └── profile/       # User profile
│   ├── api/               # API routes (if any)
│   ├── layout.tsx         # Root layout with providers
│   ├── page.tsx           # Landing page
│   ├── global-error.tsx   # Sentry-integrated error boundary
│   └── not-found.tsx      # 404 page
│
├── components/
│   ├── ui/                # shadcn/ui components (50+ components)
│   ├── layout/            # Layout components (sidebar, header, etc.)
│   ├── forms/             # Form field wrappers
│   ├── themes/            # Theme system components
│   ├── kbar/              # Command+K search bar
│   ├── icons.tsx          # Icon registry
│   └── ...
│
├── features/              # Feature-based modules
│   ├── auth/              # Authentication components
│   ├── overview/          # Dashboard analytics
│   ├── products/          # Product management (React Query + nuqs)
│   │   ├── api/
│   │   │   ├── types.ts   # Type contract (response shapes, filters, payloads)
│   │   │   ├── service.ts # Data access layer (swap for your backend)
│   │   │   └── queries.ts # React Query options + key factories
│   │   ├── components/    # Listing, form, table components
│   │   ├── schemas/       # Zod schemas
│   │   └── constants/     # Filter options
│   ├── users/             # User management (React Query + nuqs)
│   │   ├── api/           # Same pattern: types.ts → service.ts → queries.ts
│   │   └── components/    # Listing, table components
│   ├── react-query-demo/  # React Query showcase (Pokemon API)
│   ├── kanban/            # Kanban board with dnd-kit
│   ├── chat/              # Messaging UI (conversations, bubbles, composer)
│   ├── notifications/     # Notification center & store
│   └── profile/           # Profile management
│
├── config/                # Configuration files
│   ├── nav-config.ts      # Navigation with RBAC
│   └── ...
│
├── hooks/                 # Custom React hooks
│   ├── use-nav.ts         # RBAC navigation filtering
│   ├── use-data-table.ts  # Data table state
│   └── ...
│
├── lib/                   # Utility functions
│   ├── utils.ts           # cn() and formatters
│   ├── searchparams.ts    # Search param utilities
│   └── ...
│
├── types/                 # TypeScript type definitions
│   └── index.ts           # Core types (NavItem, etc.)
│
└── styles/                # Global styles
    ├── globals.css        # Tailwind imports + view transitions
    ├── theme.css          # Theme imports
    └── themes/            # Individual theme files

/docs                      # Documentation
│   ├── clerk_setup.md     # Clerk configuration guide
│   ├── nav-rbac.md        # Navigation RBAC documentation
│   └── themes.md          # Theme customization guide

/scripts                   # Dev tooling
    ├── cleanup.js         # Feature removal (self-contained, delete when done)
    └── postinstall.js     # Dev server cleanup message (auto-cleans)

Dockerfile                 # Node.js production Dockerfile
.dockerignore              # Docker build exclusions
```

---

## Build & Development Commands

```bash
# Install dependencies
pnpm install

# Development server
pnpm run dev         # Starts at http://localhost:3000

# Build for production
pnpm run build

# Start production server
pnpm run start

# Linting
pnpm run lint        # Run linter
pnpm run lint:fix    # Fix lint issues and format
pnpm run lint:strict # Zero warnings tolerance

# Formatting
pnpm run format      # Format files
pnpm run format:check # Check formatting

# Git hooks
pnpm run prepare     # Install Husky hooks
```

---

## Environment Configuration

Copy `env.example.txt` to `.env.local` and configure:

### Required for Authentication (Clerk)

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...

# Redirect URLs
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/auth/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/auth/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard/overview
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard/overview
```

### Optional for Error Tracking (Sentry)

```env
NEXT_PUBLIC_SENTRY_DSN=https://...@....ingest.sentry.io/...
SENTRY_ORG=your-org
SENTRY_PROJECT=your-project
NEXT_PUBLIC_SENTRY_ORG=your-org
NEXT_PUBLIC_SENTRY_PROJECT=your-project
SENTRY_AUTH_TOKEN=sntrys_...
NEXT_PUBLIC_SENTRY_DISABLED=false  # Set to true to disable in dev
```

**Note**: Clerk supports "keyless mode" - the app works without API keys for initial development.

---

## Code Style Guidelines

### TypeScript

- Strict mode enabled
- Use explicit return types for public functions
- Prefer interface over type for object definitions
- Use `@/*` alias for imports from src

### Formatting (Prettier)

```json
{
  "singleQuote": true,
  "jsxSingleQuote": true,
  "semi": true,
  "trailingComma": "none",
  "tabWidth": 2,
  "arrowParens": "always"
}
```

### ESLint Rules

- `@typescript-eslint/no-unused-vars`: warn
- `no-console`: warn
- `react-hooks/exhaustive-deps`: warn
- `import/no-unresolved`: off (handled by TypeScript)

### Component Conventions

- Use function declarations for components: `function ComponentName() {}`
- Props interface named `{ComponentName}Props`
- shadcn/ui components use `cn()` utility for class merging
- Server components by default, `'use client'` only when needed

---

## Theming System

The project uses a sophisticated multi-theme system with 10 built-in themes:

- `vercel` (default)
- `claude`
- `neobrutualism`
- `supabase`
- `mono`
- `notebook`
- `light-green`
- `zen`
- `astro-vista`
- `whatsapp`

### Theme Files

- CSS files: `src/styles/themes/{theme-name}.css`
- Theme registry: `src/components/themes/theme.config.ts`
- Font config: `src/components/themes/font.config.ts`
- Active theme provider: `src/components/themes/active-theme.tsx`

### Adding a New Theme

1. Create `src/styles/themes/your-theme.css` with `[data-theme='your-theme']` selector
2. Import in `src/styles/theme.css`
3. Add to `THEMES` array in `src/components/themes/theme.config.ts`
4. (Optional) Add fonts in `font.config.ts`
5. (Optional) Set as default in `theme.config.ts`

See `docs/themes.md` for detailed theming guide.

---

## Navigation & RBAC System

### Navigation Configuration

Navigation is organized into groups in `src/config/nav-config.ts`:

```typescript
import { NavGroup } from '@/types';

export const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      {
        title: 'Dashboard',
        url: '/dashboard/overview',
        icon: 'dashboard',
        shortcut: ['d', 'd'],
        items: [],
        access: { requireOrg: true } // RBAC check
      }
    ]
  }
];
```

### Access Control Properties

- `requireOrg: boolean` - Requires active organization
- `permission: string` - Requires specific permission
- `role: string` - Requires specific role
- `plan: string` - Requires specific subscription plan
- `feature: string` - Requires specific feature

### Client-Side Filtering

The `useFilteredNavItems()` hook in `src/hooks/use-nav.ts` filters navigation client-side using Clerk's `useOrganization()` and `useUser()` hooks. This is for UX only - actual security checks must happen server-side.

---

## Authentication Patterns

### Protected Routes

Dashboard routes use Clerk's middleware pattern. Pages that require organization:

```tsx
import { auth } from '@clerk/nextjs';
import { redirect } from 'next/navigation';

export default async function Page() {
  const { orgId } = await auth();
  if (!orgId) redirect('/dashboard/workspaces');
  // ...
}
```

### Plan/Feature Protection

Use Clerk's `<Protect>` component for client-side:

```tsx
import { Protect } from '@clerk/nextjs';

<Protect plan='pro' fallback={<UpgradePrompt />}>
  <PremiumContent />
</Protect>;
```

Use `has()` function for server-side checks:

```tsx
import { auth } from '@clerk/nextjs';

const { has } = await auth();
const hasFeature = has({ feature: 'premium_access' });
```

---

## Data Fetching Patterns

### API Boundary Rule

For AromaChat admin features, the frontend must only talk to the application API. The API is the only layer allowed to talk to Supabase/Postgres, Redis, Sentry server APIs, or any other private service.

Required flow:

```
React UI / client components
  -> tRPC/API calls
  -> server routers/procedures
  -> server-only services/db/cache helpers
  -> Supabase/Postgres/Redis/external services
```

Forbidden in frontend/client code:

- Importing Postgres clients, Supabase service clients, Redis clients, or server-only DB helpers
- Reading private service credentials
- Calling Supabase/Postgres/Redis directly from React components
- Bypassing tRPC/API procedures for admin mutations or protected reads

Public React components should use tRPC React hooks such as `api.oils.list.useQuery(...)` and `api.recipes.create.useMutation(...)`, or feature service functions that call the local API. Server routers must enforce Clerk auth, admin authorization, Zod input validation, and then call the server-side data/cache services.

### Service Layer Architecture

Each feature has a three-file API layer:

```
src/features/<name>/api/
  types.ts      ← Type contract (response shapes, filters, payloads)
  service.ts    ← Data access functions (the ONE file to swap for your backend)
  queries.ts    ← React Query options + query key factories (stable, never changes)
```

**For AromaChat admin data, `service.ts` must not become a direct Supabase/Postgres/Redis client in frontend code.** If a feature uses a service layer, that service calls the local tRPC/API boundary. The API/server layer owns all private service access.

#### Backend Patterns

| Pattern                                            | How to implement                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **tRPC/API + server services** (AromaChat default) | Frontend calls tRPC/API; server procedures call Supabase/Postgres/Redis services            |
| **Server Actions + ORM** (template-only pattern)   | Add `'use server'` at top of `service.ts`, call ORM directly                                |
| **Route Handlers + ORM**                           | `service.ts` calls `/api/` routes via `apiClient`, route handlers call ORM                  |
| **BFF** (Next.js proxies to Laravel/Go/etc.)       | `service.ts` calls `/api/` routes via `apiClient`, route handlers proxy to external backend |
| **Direct external API** (template/demo only)       | `service.ts` calls external URL via `fetch()`; do not use for protected AromaChat data      |
| **Mock** (default)                                 | `service.ts` calls in-memory fake data stores                                               |

Route handlers at `src/app/api/` are ready for patterns 2 and 3. `src/lib/api-client.ts` provides a typed `fetch` wrapper.

### Query Key Factories

Each feature defines a key factory in `queries.ts` for type-safe, hierarchical cache invalidation:

```tsx
export const entityKeys = {
  all: ['entities'] as const,
  list: (filters: EntityFilters) => [...entityKeys.all, 'list', filters] as const,
  detail: (id: number) => [...entityKeys.all, 'detail', id] as const
};

// Usage in queryOptions
queryKey: entityKeys.list(filters);

// Usage in mutations — invalidate all entity queries
queryClient.invalidateQueries({ queryKey: entityKeys.all });
```

### React Query (Default for all new pages)

The project uses TanStack React Query with server-side prefetching and client-side cache management:

1. **Query options** defined in `queries.ts` — shared between server prefetch and client hooks
2. **Server prefetch** using `void queryClient.prefetchQuery()` + `HydrationBoundary` + `dehydrate` — `void` (fire-and-forget) is the standard TanStack pattern for Next.js App Router
3. **Client fetch** using `useSuspenseQuery()` — integrates with React Suspense so prefetched data streams in without showing a loading skeleton on first load
4. **Suspense boundary** wraps the client component — shows a fallback skeleton only on subsequent client-side navigations when cache is empty

```tsx
// Server component: prefetch + dehydrate
const queryClient = getQueryClient();
void queryClient.prefetchQuery(entitiesQueryOptions(filters)); // void, not await

return (
  <HydrationBoundary state={dehydrate(queryClient)}>
    <Suspense fallback={<Skeleton />}>
      <EntityTable />
    </Suspense>
  </HydrationBoundary>
);

// Client component: useSuspenseQuery (not useQuery)
const { data } = useSuspenseQuery(entitiesQueryOptions(filters));
```

**Why `void` + `useSuspenseQuery`:**

- `void` fires the prefetch without blocking the server component
- `useSuspenseQuery` integrates with React Suspense — the pending query streams in via Next.js streaming SSR
- With `<Suspense fallback={<Skeleton />}>`: skeleton shows immediately while data streams in — this is expected behavior, the skeleton IS the Suspense fallback during streaming
- Without `<Suspense>` wrapper: no skeleton, but the previous page stays visible until data fully resolves (feels like a slow navigation)
- Once data is cached (within `staleTime`), subsequent visits are instant — no skeleton

**Why NOT `useQuery`:**

- `useQuery` doesn't integrate with Suspense — returns `isLoading: true` and you must handle loading state manually
- Hydrated pending queries from `void` prefetch won't prevent the loading state
- Results in skeleton flash even when data is prefetched

### Mutations

Components import service functions for mutations. Use query key factories for invalidation:

```tsx
import { createEntity } from '../api/service';
import { entityKeys } from '../api/queries';

const mutation = useMutation({
  mutationFn: (data) => createEntity(data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: entityKeys.all });
    toast.success('Created');
  }
});
```

### Request Payload Validation

Use **Zod schemas plus typed form values** as the main request validation and payload-shaping layer. Do not rely on `FormData` for validation. `FormData` is only a raw browser transport/container and is mainly appropriate for native form posts or file uploads.

For editable admin flows, the validation stack is:

1. **TanStack Form** manages form state, touched fields, dynamic rows, dependent fields, submit state, and visible errors.
2. **Zod** validates and shapes the payload before the mutation runs.
3. **tRPC input schemas** validate the payload again at the API boundary before any database write.
4. **Mutation mappers** convert UI form values into the exact API input shape when the UI representation differs from the backend contract.

Keep payload schemas close to the feature that owns the workflow:

```
src/features/<name>/schemas/
  create-entity.ts
  update-entity.ts
  link-entity.ts
```

Prefer inferring form types from schemas:

```tsx
const oilCompoundSchema = z.object({
  essentialOilId: z.string().uuid(),
  compoundId: z.string().uuid(),
  minPercentage: z.number().min(0).max(100).nullable(),
  maxPercentage: z.number().min(0).max(100).nullable()
});

type OilCompoundFormValues = z.infer<typeof oilCompoundSchema>;

const form = useAppForm({
  defaultValues: {
    essentialOilId: '',
    compoundId: '',
    minPercentage: null,
    maxPercentage: null
  } satisfies OilCompoundFormValues,
  validators: {
    onSubmit: oilCompoundSchema
  },
  onSubmit: ({ value }) => {
    mutation.mutate(value);
  }
});
```

Repeat the validation at the tRPC boundary:

```tsx
adminProcedure
  .input(oilCompoundSchema)
  .mutation(async ({ ctx, input }) => {
    // Database mutation here.
  });
```

If the UI uses strings for numeric inputs, date widgets, tag editors, or dynamic arrays, normalize them before calling `mutation.mutate()` or define the schema with `z.coerce.*` when coercion is intentional. The API should receive a deliberate, typed payload, not raw form state.

### URL State Management

Use `nuqs` for search params state:

- `searchParamsCache` (server) — reads params in server components
- `useQueryState` (client) — reads/writes params in client components with `shallow: true`

### Data Tables

Tables use TanStack Table with React Query:

- Query options in `features/*/api/queries.ts`
- Column definitions in `features/*/components/*-tables/columns.tsx`
- Table component in `src/components/ui/table/data-table.tsx`
- Column pinning via `initialState.columnPinning` in `useDataTable`

---

## Error Handling & Monitoring

### Sentry Integration

Sentry is configured for both client and server:

- Client config: `src/instrumentation-client.ts`
- Server config: `src/instrumentation.ts`
- Global error: `src/app/global-error.tsx`

To disable Sentry in development:

```env
NEXT_PUBLIC_SENTRY_DISABLED=true
```

### Error Boundaries

- `global-error.tsx` - Catches all errors, reports to Sentry
- Parallel route `error.tsx` files for specific sections

---

## Testing Strategy

**Note**: This project does not include a test suite by default. Consider adding:

- **Unit tests**: Vitest or Jest for utilities and hooks
- **Component tests**: React Testing Library for UI components
- **E2E tests**: Playwright for critical user flows

Recommended test locations:

```
/src
  /__tests__           # Unit tests
  /features/*/tests    # Feature tests
/e2e                   # Playwright tests
```

---

## Deployment

### AromaChat Live Deployment

This project is deployed as a Dockerized Next.js standalone app behind the existing Traefik instance on the VPS.

Live URL:

- `https://admin.aromachat.app`

Runtime location on the VPS:

- Compose file: `/opt/aromachat-admin-dashboard/docker-compose.yml`
- Runtime env file: `/opt/aromachat-admin-dashboard/.env`
- Docker image: `aromachat-admin-dashboard:latest`
- Container name: `aromachat-admin-dashboard`
- External Docker network: `coolify`

Traefik routes are owned by Docker labels on the app container:

- HTTP router: `Host(\`admin.aromachat.app\`)` on entrypoint `http`
- HTTPS router: `Host(\`admin.aromachat.app\`)` on entrypoint `https`
- HTTP redirects to HTTPS through `aromachat-admin-redirect`
- HTTPS uses TLS cert resolver `letsencrypt`
- Service forwards to container port `3000`
- `traefik.docker.network` must remain `coolify`

Do not replace this with generic Vercel deployment assumptions unless the user explicitly asks to migrate hosting.

### Environment Variables for Production

Ensure these are set in your deployment platform:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- All `NEXT_PUBLIC_*` variables for client-side access
- `SENTRY_*` variables if using error tracking
- `DATABASE_URL`
- `REDIS_URL`
- `CLERK_ADMIN_USERS`
- `TRPC_DEV_AUTH_ENABLED=0`
- `TRPC_ENABLE_TEST_MUTATIONS=0`

Production runtime secrets live in `/opt/aromachat-admin-dashboard/.env`, not in committed files. Public `NEXT_PUBLIC_*` variables that affect the Next.js client bundle must also be passed as Docker build args when the image is built. Clerk path values such as `NEXT_PUBLIC_CLERK_SIGN_IN_URL` must be unquoted; quoted values get baked into auth redirects literally.

### Docker

The production image is built from:

- `Dockerfile` — Node.js-based, pnpm-managed

The app uses `output: 'standalone'` in `next.config.ts`. Pass `NEXT_PUBLIC_*` vars as `--build-arg` at build time and runtime secrets through the compose env file.

Operational commands:

```bash
# Build image from repo root.
sudo docker build \
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" \
  --build-arg NEXT_PUBLIC_CLERK_SIGN_IN_URL="$NEXT_PUBLIC_CLERK_SIGN_IN_URL" \
  --build-arg NEXT_PUBLIC_CLERK_SIGN_UP_URL="$NEXT_PUBLIC_CLERK_SIGN_UP_URL" \
  --build-arg NEXT_PUBLIC_SENTRY_DSN="$NEXT_PUBLIC_SENTRY_DSN" \
  --build-arg NEXT_PUBLIC_SENTRY_ORG="$NEXT_PUBLIC_SENTRY_ORG" \
  --build-arg NEXT_PUBLIC_SENTRY_PROJECT="$NEXT_PUBLIC_SENTRY_PROJECT" \
  --build-arg NEXT_PUBLIC_SENTRY_DISABLED="$NEXT_PUBLIC_SENTRY_DISABLED" \
  -t aromachat-admin-dashboard:latest .

# Start/recreate live container.
sudo docker compose -f /opt/aromachat-admin-dashboard/docker-compose.yml up -d

# Check status and logs.
sudo docker compose -f /opt/aromachat-admin-dashboard/docker-compose.yml ps
sudo docker logs --tail=200 aromachat-admin-dashboard
```

The app must stay on the `coolify` Docker network so Traefik can route to it and so it can reach the existing Redis container by network alias.

Redis is a server-side cache behind tRPC/API only. Frontend code must never connect to Redis directly.

### Build Considerations

- Output: `standalone` (optimized for Docker/self-hosting)
- Images: Configured for `api.slingacademy.com`, `img.clerk.com`, `clerk.com`
- Sentry source map upload requires `SENTRY_AUTH_TOKEN`; keep `SENTRY_ORG`, `SENTRY_PROJECT`, `NEXT_PUBLIC_SENTRY_ORG`, and `NEXT_PUBLIC_SENTRY_PROJECT` aligned with the deployed project
- Clerk development keys can make the app work but should not be treated as production-ready credentials

---

## Feature Cleanup System

A single `scripts/cleanup.js` file handles removal of optional features:

```bash
# Interactive mode — prompts for each feature
node scripts/cleanup.js --interactive

# Remove specific features
node scripts/cleanup.js clerk           # Remove auth/org/billing
node scripts/cleanup.js kanban          # Remove kanban board
node scripts/cleanup.js chat            # Remove messaging UI
node scripts/cleanup.js notifications   # Remove notification center
node scripts/cleanup.js themes          # Keep one theme, remove rest
node scripts/cleanup.js sentry          # Remove error tracking

# Remove multiple at once
node scripts/cleanup.js kanban chat notifications

# Preview without changing files
node scripts/cleanup.js --dry-run kanban

# List all features
node scripts/cleanup.js --list
```

**Safety**: Script requires git repository with at least one commit. Use `--force` to skip.

After cleanup, delete `scripts/cleanup.js` — the dev server message auto-cleans on next start.

---

## Icon System

**All icons come from a single source: `src/components/icons.tsx`.**

The project uses `@tabler/icons-react` as the sole icon package. Every icon is re-exported through a centralized `Icons` object — **never import directly from `@tabler/icons-react` or any other icon package**.

### Usage

```tsx
import { Icons } from '@/components/icons';

// In JSX
<Icons.search className='h-4 w-4' />
<Icons.chevronRight className='h-4 w-4' />

// Passing as a prop
icon={Icons.check}
```

### Adding a New Icon

1. Import the tabler icon in `src/components/icons.tsx`
2. Add a semantic key to the `Icons` object
3. Use `Icons.yourKey` everywhere — never the raw import

```tsx
// In src/components/icons.tsx
import { IconNewIcon } from '@tabler/icons-react';

export const Icons = {
  // ...existing icons
  newIcon: IconNewIcon
};
```

### Available Icon Categories

| Category        | Example Keys                                                                  |
| --------------- | ----------------------------------------------------------------------------- |
| General         | `check`, `close`, `search`, `settings`, `trash`, `spinner`, `info`, `warning` |
| Navigation      | `chevronDown`, `chevronLeft`, `chevronRight`, `chevronUp`, `chevronsUpDown`   |
| Layout          | `dashboard`, `kanban`, `panelLeft`                                            |
| User            | `user`, `account`, `profile`, `teams`                                         |
| Communication   | `chat`, `notification`, `phone`, `video`, `send`                              |
| Files           | `page`, `post`, `media`, `fileTypePdf`, `fileTypeDoc`                         |
| Actions         | `add`, `edit`, `upload`, `share`, `login`, `logout`                           |
| Theme           | `sun`, `moon`, `brightness`, `laptop`, `palette`                              |
| Text formatting | `bold`, `italic`, `underline`, `text`                                         |
| Data / Charts   | `trendingUp`, `trendingDown`, `eyeOff`, `adjustments`                         |

### Icon Showcase Page

Browse all available icons at `/dashboard/elements/icons` — a searchable grid of every icon in the registry.

### Why This Pattern?

- **Single source of truth** — swap icon packages by editing one file
- **Semantic naming** — `Icons.trash` is clearer than `IconTrash` scattered across files
- **Discoverability** — autocomplete on `Icons.` shows every available icon
- **No direct dependencies** — components never couple to a specific icon package

---

## Common Development Tasks

### Adding a New Feature (End-to-End)

1. Create `src/features/<name>/api/types.ts` — response types, filter types, mutation payloads
2. Create `src/features/<name>/api/service.ts` — data access functions (mock by default)
3. Create `src/features/<name>/api/queries.ts` — query key factory + `queryOptions`
4. Create page route: `src/app/dashboard/<name>/page.tsx`
5. Create feature components in `src/features/<name>/components/`
6. Add navigation item in `src/config/nav-config.ts`
7. (Optional) Add route handlers in `src/app/api/<name>/` for REST API patterns
8. (Optional) Register new icon in `src/components/icons.tsx`

### Adding a New API Route

1. Create: `src/app/api/my-route/route.ts`
2. Export HTTP method handlers: `GET`, `POST`, etc.
3. For BFF pattern: proxy requests to your external backend

### Adding a shadcn Component

```bash
npx shadcn add component-name
```

### Adding a New Theme

See "Theming System" section above or `docs/themes.md`.

---

## Troubleshooting

### Common Issues

**Build fails with Tailwind errors**

- Ensure using Tailwind CSS v4 syntax (`@import 'tailwindcss'`)
- Check `postcss.config.js` uses `@tailwindcss/postcss`

**Clerk keyless mode popup**

- Normal in development without API keys
- Click popup to claim application or set env variables

**Theme not applying**

- Check theme name matches in CSS `[data-theme]` and `theme.config.ts`
- Verify theme CSS is imported in `theme.css`

**Navigation items not showing**

- Check `access` property in nav config
- Verify user has required org/permission/role

---

## External Documentation

- [Next.js App Router](https://nextjs.org/docs/app)
- [Clerk Next.js SDK](https://clerk.com/docs/references/nextjs)
- [shadcn/ui](https://ui.shadcn.com/docs)
- [Tailwind CSS v4](https://tailwindcss.com/docs)
- [TanStack Table](https://tanstack.com/table/latest)
- [Sentry Next.js](https://docs.sentry.io/platforms/javascript/guides/nextjs/)

---

## Notes for AI Agents

1. **Always use `cn()` for className merging** - never concatenate strings manually
2. **Respect the feature-based structure** - put new feature code in `src/features/`
3. **Server components by default** - only add `'use client'` when using browser APIs or React hooks
4. **Type safety first** - avoid `any`, prefer explicit types
5. **Follow existing patterns** - look at similar components before creating new ones
6. **Environment variables** - prefix with `NEXT_PUBLIC_` for client-side access
7. **shadcn components** - don't modify files in `src/components/ui/` directly; extend them instead
8. **Icons** - NEVER import icons directly from `@tabler/icons-react` or any other icon package. All icons must be registered in `src/components/icons.tsx` and imported as `import { Icons } from '@/components/icons'`. To add a new icon: add the tabler import to `icons.tsx`, add a semantic key to the `Icons` object, then use `Icons.keyName` in your component.
9. **Page headers** - Always use `PageContainer` props (`pageTitle`, `pageDescription`, `pageHeaderAction`) for page headers. Never import `<Heading>` manually in pages — `PageContainer` handles that internally.
10. **Forms** - Use TanStack Form via `useAppForm` from `@/components/ui/tanstack-form`. Never use `useState` inside `AppField` render props — extract stateful logic into separate components.
11. **Button loading** - Use `<Button isLoading={isPending}>` for loading states. Uses CSS Grid overlap trick for zero layout shift. When `isLoading` is not passed, button behaves as default shadcn. `SubmitButton` in forms handles this automatically via form `isSubmitting` state.
12. **API boundary** - Frontend/client code only talks to tRPC/API. Only server routers/procedures and server-only services may talk to Supabase/Postgres, Redis, Sentry server APIs, or other private services. Never import DB/cache clients or private service helpers into React components.
13. **Data layer** - Always go through the feature API layer: `types.ts` → `service.ts`/tRPC hooks → `queries.ts` where applicable. Components import types from `types.ts`, API callers from the feature API layer or `@/trpc/react`, and query options from `queries.ts`. Never import from `@/constants/mock-api*` directly in components.
