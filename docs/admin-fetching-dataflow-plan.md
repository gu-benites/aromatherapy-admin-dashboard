# Admin Dataflow and Fetching Plan

Generated: 2026-04-27 UTC

## Goal

This plan defines how the admin dashboard should fetch Supabase data through the application API.

Hard rule:

```text
Frontend -> tRPC API -> Supabase/Postgres
```

The frontend must not read Supabase directly. Clerk authenticates the user, tRPC owns authorization and validation, and the server API owns all joins, cache rules, write invalidation, and read-model shaping.

## Verified Runtime State

The database already has enough migrated data to power read-heavy admin screens.

Important populated surfaces:

| Surface | Rows | Frontend use |
| --- | ---: | --- |
| `essential_oils` | 120 | oil catalog and oil editor |
| `chemical_compounds` | 141 | chemistry panel |
| `essential_oil_chemical_compounds` | 400 | oil-compound ranges and provenance |
| `chemical_compound_therapeutic_properties` | 538 | compound-derived properties |
| `eo_therapeutic_properties` | 82 | therapeutic property catalog |
| `eo_health_concerns` | 599 | health concern catalog |
| `essential_oil_health_concern` | 3908 | oil-to-concern links |
| `eo_action_systems` | 96 | body system/body part/goal taxonomy |
| `health_concern_action_systems` | 1007 | concern-to-action-system links |
| `eo_how_to_use` | 43 | usage instruction catalog |
| `essential_oil_how_to_use_health_concern` | 1971 | concern usage graph |
| `eo_products` | 303 | product/blend catalog |
| `eo_product_oils` | 803 | product/blend composition |
| `eo_health_concern_recipes` | 2254 | recipe catalog and review queue |
| `eo_health_concern_recipe_oils` | 6217 | recipe composition |
| `eo_health_concern_recipe_instructions` | 5428 | recipe steps |
| `eo_health_concern_recipe_application_methods` | 2742 | recipe methods |
| `essential_oil_reports` | 60 | report/evidence attachments |
| `essential_oil_emotional` | 295 | future emotional/semantic corpus |

Useful populated views:

| View | Rows | Use |
| --- | ---: | --- |
| `v_oil_usage_recommendations` | 13702 | heavy usage recommendation graph |
| `v_oil_usage_by_method` | 2017 | oil usage grouped by method |
| `v_essential_oil_derived_therapeutic_properties` | 1527 | compound-derived oil properties |
| `v_eo_product_oils_resolved` | 827 | resolved product/blend composition |
| `v_health_concern_usage_methods` | 432 | concern method summary |
| `essential_oil_chemistry` | 400 | oil chemistry detail |
| `v_essential_oil_full_details` | 120 | broad oil detail aggregate |
| `essential_oils_with_safety` | 120 | oil detail plus safety JSON |
| `v_oil_pregnancy_safety_profile` | 120 | normalized pregnancy profile |
| `v_oil_aroma_profile` | 120 | aroma profile |
| `v_oil_sourcing_details` | 120 | sourcing profile |

Domain tables with zero rows should not drive fetch planning right now. Current empty domain tables include child safety, pet safety, energetic emotional property links, aroma note links, chakra links, and research papers.

## Current API Coverage

Existing read procedures:

| Router | Existing reads | Current limitation |
| --- | --- | --- |
| `system` | `databaseSummary` | only oil/pregnancy counts |
| `oils` | `list`, `byId` | detail is too shallow for the future oil editor |
| `pregnancy` | `statuses`, `profiles` | good enough for the safety section |
| `healthConcerns` | `forOil` | missing list/detail/search screens |
| `therapeuticProperties` | `forOil` | missing list/detail/search screens |
| `chemistry` | `oilCompounds` | missing compound list/detail/facets |
| `recipes` | `byId` | missing list, kanban, completeness, filters |

Existing mutation procedures are useful for write smoke tests, but the frontend now needs dedicated read models before UI wiring.

## Dataflow By Admin Area

### 1. Overview

Purpose: show editorial/data-quality status across all core areas.

Source tables/views:

```text
essential_oils
chemical_compounds
eo_products
eo_health_concern_recipes
eo_health_concerns
v_oil_pregnancy_safety_profile
```

API shape:

```ts
dashboard.summary()
```

Return:

- core counts
- recipe review counts
- recipe completeness counts
- oil coverage counts
- chemistry source split
- top data-quality gaps

This should be a single cached query. It is a dashboard card payload, not a CRUD endpoint.

### 2. Essential Oils

Purpose: oil catalog, oil detail, safety, chemistry, health knowledge, product/recipe usage.

Source graph:

```text
essential_oils
  -> essential_oils_with_safety
  -> v_oil_pregnancy_safety_profile
  -> v_oil_sourcing_details
  -> v_oil_aroma_profile
  -> essential_oil_chemistry
  -> essential_oil_therapeutic_properties
  -> v_essential_oil_derived_therapeutic_properties
  -> essential_oil_health_concern
  -> essential_oil_action_systems
  -> eo_product_oils / v_eo_product_oils_resolved
  -> eo_health_concern_recipe_oils
  -> essential_oil_reports
```

Required API reads:

```ts
oils.list({ page, pageSize, search, safety, pregnancyCategory, internalUse, dilution, phototoxicity })
oils.detail({ id })
oils.editorContext({ id })
oils.relationshipSummary({ id })
oils.facets()
```

Recommended payload split:

- `oils.list`: light rows only; never return full relationship arrays here.
- `oils.detail`: identity, description, image, safety, sourcing, aroma, high-level counts.
- `oils.editorContext`: all editable relation data for the admin edit screen.
- `oils.relationshipSummary`: tabs/counts for compounds, concerns, properties, recipes, products, reports.
- `oils.facets`: safety lookups, application methods, product types, pregnancy categories.

Fetching pattern:

- Server prefetch first list page for route load.
- Client refetches list on filters/search.
- Detail page should fetch `oils.detail` immediately.
- Heavy tabs should fetch lazily when opened: chemistry, recipes, products, health concerns.

### 3. Chemistry

Purpose: a dedicated expert panel for compounds, ranges, source quality, functional groups, carbon structures, and therapeutic-property derivation.

Source graph:

```text
chemical_compounds
  -> essential_oil_chemical_compounds -> essential_oils
  -> chemical_compound_therapeutic_properties -> eo_therapeutic_properties
  -> chemical_compound_functional_groups -> chemical_functional_groups
  -> chemical_compound_carbon_structures -> chemical_carbon_structures
  -> essential_oil_chemistry
```

Current data signal:

- 400 oil-compound links.
- 206 secondary links.
- 194 official dōTERRA links.
- 118 of 120 oils have at least one compound.

Required API reads:

```ts
chemistry.compoundsList({ page, pageSize, search, sourceType, functionalGroupId, carbonStructureId })
chemistry.compoundDetail({ id })
chemistry.compoundOilLinks({ compoundId, page, pageSize })
chemistry.compoundPropertyLinks({ compoundId })
chemistry.oilCompounds({ essentialOilId })
chemistry.facets()
chemistry.coverageSummary()
```

Recommended payload split:

- `compoundsList`: compound row plus counts of oils/properties/groups.
- `compoundDetail`: compound identity, PubChem/carbon fields, functional groups, carbon structures.
- `compoundOilLinks`: oil percentages and source provenance.
- `compoundPropertyLinks`: therapeutic properties linked to compound.
- `coverageSummary`: missing ranges, missing groups, missing property links, official vs secondary split.

Fetching pattern:

- Compound list is paginated and filterable.
- `facets` can be cached aggressively because functional groups and carbon structures are tiny.
- The chemical matrix should not load all joins by default; load only the selected compound or selected oil.

### 4. Products And Blends

Purpose: product catalog, blend composition, product types, color labels, and inheritance through `main_product_id`.

Source graph:

```text
eo_products
  -> eo_product_type_assignments -> eo_product_types
  -> eo_color_labels
  -> eo_product_oils -> essential_oils
  -> v_eo_product_oils_resolved
```

Current data signal:

- 303 products.
- 803 direct product-oil links.
- 827 resolved product-oil rows.
- Largest product types: Single-oil 110, Mix 95, Roll-on 47, Roll-on-touch 41.

Required API reads:

```ts
products.list({ page, pageSize, search, productTypeId, colorLabelId, countryCode, hasResolvedOils })
products.detail({ id })
products.composition({ id, resolved: boolean })
products.facets()
products.coverageSummary()
```

Recommended payload split:

- `products.list`: catalog row, price fields, product type names, resolved oil count.
- `products.detail`: identity, image, URLs, price fields, type assignments, color label.
- `products.composition`: component oils with position and resolution source.
- `coverageSummary`: products without resolved oils, products with multiple categories, products using main-product inheritance.

Fetching pattern:

- Product list can be server-side paginated.
- Composition should be loaded on detail only.
- The resolved composition view is a good Redis candidate.

### 5. Recipes

Purpose: recipe catalog, review queue, completeness, kanban, recipe detail editor.

Source graph:

```text
eo_health_concern_recipes
  -> eo_health_concerns
  -> eo_health_concern_recipe_oils -> essential_oils
  -> eo_health_concern_recipe_instructions
  -> eo_health_concern_recipe_application_methods -> eo_application_methods
```

Current data signal:

- 2254 recipes.
- 657 reviewed.
- 351 without oils.
- 1602 without parsed instruction rows.
- 0 without health concern.
- 0 without application method.

Required API reads:

```ts
recipes.list({ page, pageSize, search, reviewed, healthConcernId, applicationMethodId, completeness })
recipes.detail({ id })
recipes.kanban({ groupBy: 'review_status' | 'completeness' | 'health_concern' })
recipes.completenessSummary()
recipes.reviewQueue({ page, pageSize, issue })
recipes.facets()
```

Recommended payload split:

- `recipes.list`: title, health concern, reviewed flag, oil count, instruction count, method count, completeness status.
- `recipes.detail`: recipe base fields plus oils, instructions, methods.
- `recipes.kanban`: grouped cards with minimal fields; do not return full text.
- `reviewQueue`: issue-specific rows such as missing oils, missing parsed instructions, unreviewed.

Fetching pattern:

- The kanban should fetch compact card payloads.
- Recipe detail should fetch full text only when a card/list row is opened.
- Completeness summary can be cached for short intervals.

### 6. Health Knowledge

Purpose: manage health concerns, action systems, how-to-use, and therapeutic properties.

Source graph:

```text
eo_health_concerns
  -> essential_oil_health_concern -> essential_oils
  -> health_concern_action_systems -> eo_action_systems
  -> essential_oil_how_to_use_health_concern -> eo_how_to_use -> eo_application_methods
  -> eo_health_concern_recipes

eo_therapeutic_properties
  -> essential_oil_therapeutic_properties -> essential_oils
  -> chemical_compound_therapeutic_properties -> chemical_compounds
  -> eo_therapeutic_property_functional_groups
  -> eo_therapeutic_property_carbon_structures
```

Current data signal:

- 599 concerns.
- 595 concerns with oil links.
- 537 concerns with recipes.
- 586 concerns with action systems.
- 82 therapeutic properties.
- 96 action systems.
- 43 how-to-use rows.

Required API reads:

```ts
healthKnowledge.concernsList({ page, pageSize, search, actionSystemId, hasRecipes, hasOils })
healthKnowledge.concernDetail({ id })
healthKnowledge.concernUsage({ id })
healthKnowledge.actionSystemsList({ page, pageSize, search, actionType })
healthKnowledge.actionSystemDetail({ id })
healthKnowledge.howToUseList({ page, pageSize, search, applicationMethodId })
healthKnowledge.therapeuticPropertiesList({ page, pageSize, search, source: 'direct' | 'derived' | 'both' })
healthKnowledge.therapeuticPropertyDetail({ id })
healthKnowledge.facets()
```

Recommended payload split:

- Concern list rows should include counts for oils, recipes, usage methods, and action systems.
- Concern detail should show linked oils, recipes, usage instructions, action systems.
- Therapeutic property detail must separate direct oil links from compound-derived evidence.
- How-to-use list should include application method and number of health concerns using it.

Fetching pattern:

- Concern and property lists can be paginated.
- Usage graph views can be cached because they are read-heavy and join-heavy.

## Cross-Area Fetching Rules

1. Lists are server-side paginated.
2. List rows carry counts and status badges, not full child arrays.
3. Detail pages use one primary detail query plus lazy tab queries.
4. Small lookups and facets are long-lived cached data.
5. Heavy graph views are fetched only through explicit read-model procedures.
6. Search params should be normalized through `nuqs` so URLs are shareable.
7. Mutations invalidate domain keys instead of forcing global refetch.

## TanStack Query Strategy

Use tRPC React hooks as the frontend API client.

Recommended defaults:

| Query class | Example | Browser stale time |
| --- | --- | ---: |
| Immutable/small lookups | application methods, product types, safety statuses | 30-60 min |
| Facets | oil facets, chemistry facets, recipe facets | 5-15 min |
| Overview summaries | dashboard summary, completeness summary | 30-60 sec |
| Lists | oils/products/recipes/compounds | 30-90 sec |
| Details | oil/product/recipe/compound detail | 1-5 min |
| Lazy heavy tabs | usage graph, resolved products, chemistry matrix | 1-5 min |

Query-key pattern:

```ts
oils: {
  all: ['oils'],
  lists: ['oils', 'list'],
  list: filters => ['oils', 'list', filters],
  detail: id => ['oils', 'detail', id],
  editorContext: id => ['oils', 'editor-context', id],
  facets: ['oils', 'facets']
}
```

Invalidation examples:

- Updating an oil invalidates `oils.detail(id)`, `oils.editorContext(id)`, `oils.lists`, `dashboard.summary`.
- Updating oil chemistry invalidates `oils.detail(id)`, `chemistry.compoundsList`, `chemistry.coverageSummary`, and compound detail keys touched by the mutation.
- Updating a recipe invalidates `recipes.detail(id)`, `recipes.lists`, `recipes.kanban`, `recipes.completenessSummary`.
- Linking a health concern invalidates both the oil detail keys and health-knowledge concern keys.

## Redis Cache Plan

Redis should be a server-side cache behind tRPC. It should not replace TanStack Query.

Current VPS check:

- Host `redis-cli` is not required.
- The Redis container to use is `n480kw48o4c4w0sssgkowk0s` on Docker network `coolify`.
- The container image is `redis:7.2`.
- The container alias is also `n480kw48o4c4w0sssgkowk0s`.
- The container currently responds to authenticated `PING`.
- The current Redis accepts password authentication. Although a username exists in the container env, ACL-style `AUTH username password` did not authenticate in the current container test.

Installed package:

```text
redis
```

Recommended key namespace:

```text
aroma-admin:v1:{domain}:{procedure}:{stableHash(input)}
```

Recommended TTLs:

| Payload | TTL |
| --- | ---: |
| static lookup/facet payloads | 30-60 min |
| overview summaries | 60 sec |
| recipe completeness/kanban | 60-180 sec |
| heavy view-backed reads | 5-15 min |
| detail read models | 1-5 min |
| search results | 30-60 sec |

Invalidation strategy:

- API mutations delete exact detail keys and bump a domain version key.
- Bulk migration/import scripts should bump all affected domain versions.
- For early implementation, domain-version keys are simpler than maintaining large key sets:

```text
aroma-admin:v1:version:oils
aroma-admin:v1:version:chemistry
aroma-admin:v1:version:recipes
aroma-admin:v1:version:products
aroma-admin:v1:version:health-knowledge
```

Each cache key includes the current domain version. Bumping the version makes old keys stale without needing a blocking scan/delete.

## Fetch Smoke Test Plan

Add a new script:

```text
scripts/api-smoke-tests/fetch-workflow.mjs
```

It should use the same dev-header authentication pattern as the mutation smoke test.

Test groups:

### 1. Auth

- anonymous protected read fails
- dev-header authenticated read succeeds

### 2. Overview

- `dashboard.summary` returns nonzero counts for oils, recipes, products, compounds, concerns
- summary matches direct database expectations within exact count checks for core tables

### 3. Essential Oils

- `oils.list` returns paginated rows and total
- search by a known oil returns at least one row
- safety/pregnancy filters return rows where available
- first row detail returns identity, safety, sourcing/aroma summaries, and relationship counts
- lazy tab reads return compounds, concerns, properties, recipes/products where present

### 4. Chemistry

- `chemistry.compoundsList` returns compounds with oil/property counts
- filter by `official_doterra` and `secondary` both return rows
- first compound detail returns linked oils or linked properties
- invalid percentage inputs remain covered by the existing mutation smoke test

### 5. Products

- `products.list` returns product type and resolved-oil counts
- filter `Mix` returns blend/product rows
- product detail returns composition from `v_eo_product_oils_resolved`

### 6. Recipes

- `recipes.list` returns recipe rows with completeness badges
- unreviewed filter returns rows
- missing-oils issue returns rows because the DB currently has 351 recipes without oils
- detail returns oils, instructions, and application methods where present
- kanban returns grouped compact cards

### 7. Health Knowledge

- concerns list returns counts for oils, recipes, action systems
- concern detail returns linked oils and recipes
- action system list returns rows grouped by action type
- therapeutic property detail separates direct oil links from derived compound evidence

### 8. Cache Behavior

After Redis is active:

- first request returns `cache: miss`
- repeated identical request returns `cache: hit`
- mutation invalidates or version-bumps the affected domain
- request after mutation returns fresh data

### 9. Performance Budgets

Suggested first budgets for local/staging:

| Query class | Uncached target | Cached target |
| --- | ---: | ---: |
| lookup/facet | < 300 ms | < 75 ms |
| list page | < 700 ms | < 150 ms |
| detail read model | < 900 ms | < 200 ms |
| heavy graph view | < 1500 ms | < 250 ms |
| dashboard summary | < 1000 ms | < 150 ms |

## Implementation Order

1. Add read-model routers before building final UI screens.
2. Add `fetch-workflow` smoke test and make it pass against the current database.
3. Add Redis client and cache helper only after Redis is active on the VPS.
4. Wire the frontend lists and detail pages to tRPC with TanStack Query.
5. Add cache invalidation to existing mutations.
6. Add UI-level optimistic updates only after the read contracts stabilize.

The next practical implementation step is the read API layer, not more mutations.
