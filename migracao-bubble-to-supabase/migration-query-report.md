# Migration query report

Generated: 2026-04-26 UTC

This document maps the migrated Bubble -> Supabase graph into questions we can answer today, and into views that should probably exist later because the joins are too expensive or too easy to get wrong by hand.

Scope:

- Focuses on the migrated essential-oil domain, chemistry, products/blends, usage, safety, action systems, recipes, and adjacent raw corpora that currently have data in Postgres.
- Excludes generic app tables like `chat`, `agno_*`, and most `user_*` tables unless they connect directly to the migrated EO graph.
- Intentionally avoids query recommendations centered on empty placeholder tables. Those tables may be discontinued later and should not drive product planning.

Related docs:

- [migration-status.md](migration-status.md)
- [emotional-mapping-smoke-test.md](emotional-mapping-smoke-test.md)

## 1. High-level graph

The migrated database is centered on `essential_oils` and fans out into a few large analytical branches:

```text
essential_oils
  -> essential_oil_chemical_compounds -> chemical_compounds
       -> chemical_compound_therapeutic_properties -> eo_therapeutic_properties
       -> chemical_compound_functional_groups -> chemical_functional_groups
       -> chemical_compound_carbon_structures -> chemical_carbon_structures
  -> essential_oil_therapeutic_properties -> eo_therapeutic_properties
  -> essential_oil_health_concern -> eo_health_concerns
       -> essential_oil_how_to_use_health_concern -> eo_how_to_use -> eo_application_methods
  -> essential_oil_action_systems -> eo_action_systems
  -> essential_oil_extraction_methods / countries / plant_parts / aroma_scents
  -> essential_oil_application_methods / internal_use / dilution / phototoxicity / pregnancy safety
  -> essential_oil_reports
  -> essential_oil_emotional

eo_products
  -> eo_product_oils -> essential_oils
  -> eo_product_type_assignments -> eo_product_types
  -> eo_color_labels

eo_health_concern_recipes
  -> eo_health_concerns
  -> eo_health_concern_recipe_oils -> essential_oils
  -> eo_health_concern_recipe_instructions
  -> eo_health_concern_recipe_application_methods -> eo_application_methods
```

## 2. Current scale

These are the main surfaces that matter for analysis right now.

| Layer | Rows | What it is good for |
| --- | ---: | --- |
| `essential_oils` | 120 | canonical oil detail, safety, sourcing, chemistry, usage |
| `eo_products` | 303 | product and blend catalog, retail browsing, product family analysis |
| `chemical_compounds` | 141 | chemistry-centric navigation and hub analysis |
| `eo_therapeutic_properties` | 82 | normalized therapeutic vocabulary |
| `eo_health_concerns` | 599 | use-case / concern graph |
| `eo_how_to_use` | 43 | contextual usage instructions |
| `eo_action_systems` | 96 | body system / body part / goal taxonomy |
| `eo_color_labels` | 45 | merchandising and catalog faceting |
| `eo_health_concern_recipes` | 2254 | curated recipe content |
| `eo_health_concern_recipe_oils` | 6217 | recipe composition and drop counts |
| `eo_health_concern_recipe_instructions` | 5428 | step-by-step recipe instructions |
| `eo_health_concern_recipe_application_methods` | 2742 | recipe application method facets |
| `essential_oil_reports` | 60 | report / chromatography evidence corpus |
| `essential_oil_emotional` | 295 | raw emotional corpus for later semantic modeling |

Derived or high-value views already in the database:

| View | Rows | Main use |
| --- | ---: | --- |
| `v_essential_oil_full_details` | 120 | full oil detail record with many related arrays |
| `essential_oil_chemistry` | 400 | oil -> compound chemistry detail with ranges |
| `v_oil_sourcing_details` | 120 | plant part, extraction method, country |
| `v_oil_aroma_profile` | 120 | populated oil aroma scent profile |
| `essential_oils_with_safety` | 120 | oil detail plus safety JSON |
| `essential_oils_with_safety_ids` | 120 | same idea, with explicit safety IDs |
| `v_eo_product_oils_resolved` | 827 | product composition including main-product inheritance |
| `v_essential_oil_derived_therapeutic_properties` | 1527 | compound-derived therapeutic properties |
| `v_oil_usage_recommendations` | 13702 | concern -> method -> instruction graph |
| `v_oil_usage_by_method` | 2017 | oil -> method -> concern summary |
| `v_health_concern_usage_methods` | 432 | concern-level usage method counts |
| `v_oil_pregnancy_safety_tags` | 73 | clean pregnancy tag rows with legacy Bubble traceability |
| `v_oil_pregnancy_safety_profile` | 120 | one-row-per-oil pregnancy category and flags |

Lookup and taxonomy layers:

| Lookup table | Rows | Notes |
| --- | ---: | --- |
| `eo_product_types` | 17 | product catalog facet, including singular oils, mixes, kits, roll-ons, and supplements |
| `eo_application_methods` | 3 | aromatic, topical, internal |
| `eo_internal_use_statuses` | 2 | internal-use safety filter |
| `eo_dilution_recommendations` | 3 | neat, sensitive, dilute |
| `eo_phototoxicity_statuses` | 2 | phototoxic, non-phototoxic |
| `eo_countries` | 39 | extraction country lookup |
| `eo_plant_parts` | 11 | plant-part lookup |
| `eo_aroma_scents` | 46 | aroma scent lookup |
| `eo_pregnancy_nursing_statuses` | 5 | clean `code`/`name` plus legacy Bubble `status_description` |

Bridge layers that make the graph analytical:

| Bridge table | Rows | What it connects |
| --- | ---: | --- |
| `essential_oil_chemical_compounds` | 400 | oils to compounds, with provenance split |
| `chemical_compound_therapeutic_properties` | 538 | compounds to therapeutic properties |
| `essential_oil_therapeutic_properties` | 1601 | oils to direct therapeutic properties |
| `essential_oil_health_concern` | 3908 | oils to health concerns |
| `essential_oil_how_to_use_health_concern` | 1971 | how-to-use content to health concerns |
| `essential_oil_pregnancy_nursing_safety` | 73 | oils to pregnancy/nursing safety statuses |
| `essential_oil_action_systems` | 222 | oils to action systems |
| `health_concern_action_systems` | 1007 | health concerns to action systems |
| `essential_oil_how_to_use_action_systems` | 7 | how-to-use content to action systems |
| `eo_product_oils` | 803 | products to component oils |
| `eo_product_type_assignments` | 397 | products to category list entries |
| `chemical_compound_functional_groups` | 76 | compounds to functional groups |
| `chemical_compound_carbon_structures` | 77 | compounds to carbon structures |
| `chemical_functional_group_carbon_structures` | 12 | functional groups to carbon structures |
| `eo_therapeutic_property_functional_groups` | 80 | therapeutic properties to functional groups |
| `eo_therapeutic_property_carbon_structures` | 68 | therapeutic properties to carbon structures |

## 3. Questions we can answer directly today

### 3.1 Essential oil centric

| Question | Direct path now | Why this is direct |
| --- | --- | --- |
| Which oils are safe for internal use, non-phototoxic, and have a defined dilution rule? | `essential_oils` + `eo_internal_use_statuses` + `eo_phototoxicity_statuses` + `eo_dilution_recommendations` | all three are already materialized lookup FKs |
| Which oils have the strongest official chemistry evidence? | `essential_oil_chemical_compounds` filtered by `source_type = 'official_doterra'` | provenance is already stored row by row |
| Which oils depend mostly on secondary evidence? | `essential_oil_chemical_compounds` filtered by `source_type = 'secondary'` | easy provenance split, no extra joins needed |
| Which oils have the richest aroma profile? | `v_oil_aroma_profile` | the view already aggregates populated scent terms |
| Which oils have the broadest sourcing footprint? | `v_oil_sourcing_details` | it already combines plant part, method, and country |
| Which oils are connected to the most health concerns? | `essential_oil_health_concern` | direct many-to-many bridge |
| Which oils are connected to the most action systems? | `essential_oil_action_systems` | direct many-to-many bridge |
| Which oils have direct therapeutic properties vs compound-derived ones? | `essential_oil_therapeutic_properties` compared with `v_essential_oil_derived_therapeutic_properties` | direct and derived layers are intentionally separate |

Useful direct analyses:

- hub oils by degree centrality across compounds, concerns, action systems, and products
- oils with the biggest gap between direct therapeutic properties and compound-derived properties
- oils whose compound evidence is all secondary versus mostly official
- oils with multiple extraction countries or multiple extraction methods

### 3.2 Product and blend centric

| Question | Direct path now | Why this matters |
| --- | --- | --- |
| Is this item a singular oil, mix, kit, roll-on, or non-oil catalog item? | `eo_products` + `eo_product_types` | product segmentation is already normalized |
| Which products inherit their composition from a `main_product`? | `v_eo_product_oils_resolved` | inheritance is already resolved in the view |
| Which products have no resolved oils? | `eo_products` left join `v_eo_product_oils_resolved` | isolates kits, literature, diffusers, and other non-oil items |
| Which products share the same color label? | `eo_products` + `eo_color_labels` | merchandising facet already exists |
| Which product families have multiple categories? | `eo_products` + `eo_product_type_assignments` | `Category` is a list, not a scalar |
| Which product bundles mirror or duplicate a singular-oil profile? | `v_eo_product_oils_resolved` + `essential_oils` | composition overlap can be computed directly |

Useful direct analyses:

- family tree of products through `main_product_id`
- product catalog coverage by type and color label
- non-oil catalog items that should never appear in an oil recommendation surface
- product composition similarity using resolved component oils

### 3.3 Chemistry and property centric

| Question | Direct path now | Why this matters |
| --- | --- | --- |
| Which compounds act as hubs across many oils? | `essential_oil_chemical_compounds` | one compound can appear in many oils |
| Which compounds map to many therapeutic properties? | `chemical_compound_therapeutic_properties` | property inference is normalized at compound level |
| Which functional groups and carbon structures are shared across compounds? | `chemical_compound_functional_groups`, `chemical_compound_carbon_structures` | functional classification is normalized |
| Which therapeutic properties are broad versus narrow? | `eo_therapeutic_properties` + direct/derived joins | broadness can be measured by degree |
| Which properties are only direct oil annotations versus compound-derived? | compare `essential_oil_therapeutic_properties` with `v_essential_oil_derived_therapeutic_properties` | direct and inferred claims should not be conflated |
| Which oils are supported by both official compound ranges and secondary direct pairings? | `essential_oil_chemical_compounds` | provenance is kept per pair |

Useful direct analyses:

- functional-group coverage by oil family
- carbon-structure families that correlate with repeated therapeutic properties
- compounds that bridge many oils and many properties
- oils with unusually dense chemistry but sparse direct property labels

### 3.4 Health concern and usage centric

| Question | Direct path now | Why this matters |
| --- | --- | --- |
| Which health concerns have the most usage methods? | `v_health_concern_usage_methods` | already summarized at concern level |
| Which oils have readable usage instructions for a concern and a method? | `v_oil_usage_recommendations` | most of the recommendation surface is already flattened |
| Which oils vary by application method for the same concern? | `v_oil_usage_by_method` | lets you compare aromatic vs topical vs internal surfaces |
| Which concerns are only covered by recipes and not by a strong oil graph? | `eo_health_concerns` vs `essential_oil_health_concern` vs `eo_health_concern_recipes` | useful for gap detection |
| Which usage instructions are aromatic, topical, or internal? | `eo_how_to_use` + `eo_application_methods` | contextual method is already normalized |

Useful direct analyses:

- concern coverage density
- concern-to-oil overlap versus concern-to-recipe overlap
- instructions that only make sense in a specific method context
- concerns with many recipes but weak direct oil coverage

### 3.5 Action-system centric

| Question | Direct path now | Why this matters |
| --- | --- | --- |
| Which action systems are body systems, body parts, goals, life stages, or use contexts? | `eo_action_systems.action_type` | taxonomy is normalized as an enum |
| Which oils and concerns share the same action system? | `essential_oil_action_systems`, `health_concern_action_systems` | direct bridge tables already exist |
| Which how-to-use entries resolve to body parts? | `essential_oil_how_to_use_action_systems` + `v_essential_oil_how_to_use_body_part` | legacy body-part compatibility is preserved |
| Which products inherit action systems from component oils? | `eo_products -> v_eo_product_oils_resolved -> essential_oil_action_systems` | this is a direct graph traversal |
| Which action-system categories are most common? | `eo_action_systems` grouped by `action_type` | current distribution is already compact |

Current distribution:

- `body_part`: 60
- `body_system`: 10
- `therapeutic_goal`: 14
- `functional_area`: 5
- `life_stage`: 4
- `use_context`: 3

Useful direct analyses:

- action-system coverage by oil family
- body-part inheritance from how-to-use into concern navigation
- product-level action inference from component oils
- taxonomy QA on mixed or ambiguous action-system labels

### 3.6 Safety centric

| Question | Direct path now | Why this matters |
| --- | --- | --- |
| Which oils are safe for internal use? | `essential_oils.internal_use_status_id -> eo_internal_use_statuses` | binary, user-facing safety filter |
| Which oils require dilution, are sensitive, or are neat? | `essential_oils.dilution_recommendation_id -> eo_dilution_recommendations` | topical guidance filter |
| Which oils are phototoxic? | `essential_oils.phototoxicity_status_id -> eo_phototoxicity_statuses` | sun-exposure filter |
| Which oils are safe or risky in pregnancy/nursing? | `v_oil_pregnancy_safety_profile` | clean category and flags already apply the Bubble pipeline logic |

Important labels currently available:

- Internal use: `Safe for Internal Use`, `Not for Internal Use`
- Dilution: `Neat`, `Sensitive`, `Dilute`
- Phototoxicity: `Phototoxic`, `Non-Phototoxic`

Pregnancy safety now has a clean app-facing layer:

- `pregnancy_safe_all_trimesters`: 16 oils
- `pregnancy_safe_after_first_trimester`: 21 oils; this applies the Bubble `pregnancy-safe-100 AND NOT pregnancy-safe-3months` filter rule
- `pregnancy_professional_guidance`: 11 oils
- `pregnancy_no_guidance`: 72 oils

Additive flags:

- `has_professional_guidance`: 12 oils
- `has_labor_delivery_guidance`: 8 oils
- `has_lactation_guidance`: 0 oils

Use `v_oil_pregnancy_safety_profile` for app-facing filters. Do not query legacy `eo_pregnancy_nursing_statuses.status_description` directly unless auditing Bubble migration. The legacy string `pregnancy-safe-100` is not the app category by itself; the app-facing category `pregnancy_safe_after_first_trimester` means `pregnancy-safe-100` and not `pregnancy-safe-3months`.

Starter pregnancy safety queries:

```sql
-- Oils safe after the first trimester, matching the old Bubble preg-100 pipeline.
select
  oil_name_english,
  oil_name_portuguese,
  has_professional_guidance,
  has_labor_delivery_guidance,
  legacy_pregnancy_tags
from v_oil_pregnancy_safety_profile
where pregnancy_safety_category_code = 'pregnancy_safe_after_first_trimester'
order by oil_name_english;
```

```sql
-- Oils with labor/delivery guidance, regardless of trimester category.
select
  oil_name_english,
  pregnancy_safety_category_code,
  legacy_pregnancy_tags
from v_oil_pregnancy_safety_profile
where has_labor_delivery_guidance
order by oil_name_english;
```

```sql
-- Audit clean codes against legacy Bubble tags.
select
  oil_name_english,
  pregnancy_tag_code,
  pregnancy_tag_name,
  legacy_bubble_tag
from v_oil_pregnancy_safety_tags
order by oil_name_english, pregnancy_tag_code;
```

Useful direct analyses:

- oils that are simultaneously non-phototoxic, neat, and internal-safe
- oils that are internal-safe but still need topical dilution or sun-exposure cautions
- oils with the fewest contradictions across safety layers
- oils with pregnancy category and labor/professional-guidance flags compared against general internal, dilution, and phototoxicity status

### 3.7 Sourcing, aroma, and catalog faceting

| Question | Direct path now | Why this matters |
| --- | --- | --- |
| Which oils come from which countries, methods, and plant parts? | `v_oil_sourcing_details` | source metadata is already pre-aggregated |
| Which oils have which aroma scents? | `v_oil_aroma_profile` | user-facing sensory browsing surface |
| Which products share a color label? | `eo_products` + `eo_color_labels` | useful for catalog and merchandising |
| Which color labels are unused? | `eo_color_labels` left join `eo_products` | detects empty merchandising facets |
| Which products are missing a color label? | `eo_products` where `color_label_id is null` | identifies incomplete catalog metadata |

Current color-label split:

- linked products: 210
- unlinked products: 93

Useful direct analyses:

- color label coverage by product family
- source-country clusters by product type
- aroma profiles by oil family or compound family
- oils and products that need catalog cleanup because their metadata is sparse

### 3.8 Recipe centric

| Question | Direct path now | Why this matters |
| --- | --- | --- |
| Which recipes are tied to a health concern? | `eo_health_concern_recipes.health_concern_id` | the recipe graph is already normalized |
| Which oils are in a recipe? | `eo_health_concern_recipe_oils` | direct recipe composition |
| Which instruction text belongs to which recipe? | `eo_health_concern_recipe_instructions` | direct presentation layer |
| Which recipes support aromatic, topical, or internal use? | `eo_health_concern_recipe_application_methods` + `eo_application_methods` | explicit method facet exists |
| Which health concerns have the largest recipe surface? | `eo_health_concern_recipes` + bridges | good for recommendation ranking |
| Which recipes are incomplete? | rows without `health_concern_id` or with missing text/oils | simple audit query |

Useful direct analyses:

- most reused oils across recipes
- most common recipe methods by concern
- recipe completeness and orphan detection
- whether a concern is addressed by a recipe, by a how-to-use entry, or by both

### 3.9 Raw corpora and evidence

| Question | Direct path now | Why this matters |
| --- | --- | --- |
| What chromatography/report metadata exists for each oil? | `essential_oil_reports` | evidence corpus with file metadata |
| Which reports are duplicated or missing storage metadata? | `essential_oil_reports` | file hash and storage fields are already present |
| What emotional roots and symptom labels appear in the raw emotional corpus? | `essential_oil_emotional` | unstructured but rich semantic source |
| Which emotional records match health concerns or action systems exactly? | `essential_oil_emotional` + normalized lookup tables | ideal for later matching and explainability |

Useful direct analyses:

- report provenance and file integrity
- emotional-to-concern normalization
- semantic search over raw emotional records
- chromatography-backed learning cards and report traceability

## 4. Views that already earn their keep

These are the views I would treat as first-class analytical surfaces instead of ad hoc SQL.

| View | Use it for | Why it is worth keeping |
| --- | --- | --- |
| `v_essential_oil_full_details` | one-stop oil detail page | exposes most of the oil graph in one row |
| `essential_oil_chemistry` | compound lists and ranges per oil | ideal for chemistry inspection and compound-ranking pages |
| `v_oil_sourcing_details` | plant part / method / country | clean source metadata for each oil |
| `v_oil_aroma_profile` | aroma scent terms | clean sensory browsing surface |
| `essential_oils_with_safety` | oil detail with nested safety JSON | UI-friendly and easy to cache |
| `essential_oils_with_safety_ids` | same idea, but explicit FKs preserved | better for auditing and joins |
| `v_oil_usage_recommendations` | concern -> method -> instruction surface | the main recommendation graph |
| `v_oil_usage_by_method` | oil/method summary by concern | useful for compare-and-rank UI |
| `v_health_concern_usage_methods` | concern-level usage method counts | good for dashboard and QA |
| `v_eo_product_oils_resolved` | product composition with inheritance | essential for blend/product pages |
| `v_essential_oil_derived_therapeutic_properties` | compound-derived property inference | keeps inference separate from direct annotation |
| `v_oil_pregnancy_safety_tags` | clean pregnancy tag rows | preserves legacy Bubble tag strings while exposing clean names |
| `v_oil_pregnancy_safety_profile` | pregnancy category and flags | main app-facing pregnancy safety surface |
| `v_eo_body_part` | legacy body-part compatibility | helps preserve older surfaces while canonicalizing to action systems |
| `v_essential_oil_how_to_use_body_part` | legacy body-part compatibility for how-to-use | same reason as above |

When to favor a view over raw joins:

- when the same join chain is reused in more than one UI
- when the join chain is easy to get wrong, especially inheritance or derived inference
- when the result is aggregation-heavy and should be cached or materialized later

## 5. Future views worth materializing

These are the ones I would expect to save time later.

| Proposed view | Core join chain | Why it should exist |
| --- | --- | --- |
| `v_oil_evidence_profile` | `essential_oils -> essential_oil_chemical_compounds -> chemical_compounds -> chemical_compound_therapeutic_properties -> eo_therapeutic_properties`, plus safety, sourcing, aroma, action systems | one canonical oil page with provenance and derived semantics |
| `v_product_knowledge_profile` | `eo_products -> v_eo_product_oils_resolved -> essential_oils`, plus product types and color labels | product family page and catalog browse surface |
| `v_health_concern_recommendation_graph` | `eo_health_concerns -> essential_oil_health_concern -> essential_oils -> essential_oil_how_to_use_health_concern -> eo_how_to_use -> eo_application_methods`, plus recipes | concern-focused recommendation and instruction surface |
| `v_compound_network` | `chemical_compounds -> chemical_* bridges -> essential_oil_chemical_compounds -> chemical_compound_therapeutic_properties` | chemistry research, hub detection, and clustering |
| `v_oil_safety_profile` | `essential_oils -> internal/dilution/phototoxicity`, plus `v_oil_pregnancy_safety_profile` | unified safety and suitability filter from populated safety data |
| `v_action_system_coverage` | `eo_action_systems` + oil, concern, and how-to-use bridges | taxonomy QA and semantic navigation |
| `v_emotional_semantic_graph` | `essential_oil_emotional` + exact/fuzzy matches to `eo_health_concerns` and `eo_action_systems` | later semantic search and explainability layer |
| `v_report_evidence_bridge` | `essential_oil_reports` + oil and compound joins | report provenance and evidence-backed chemistry |
| `v_recipe_completeness` | `eo_health_concern_recipes` + oil/instruction/method bridges | recipe QA, gap detection, and ranking |

Materialize first if the page is user-facing or heavily reused:

- product knowledge profile
- oil evidence profile
- health-concern recommendation graph
- recipe completeness
- report evidence bridge

## 6. Direct query patterns that are easy to miss

These are the joins that usually produce the best insights without needing new schema.

### 6.1 Product inherits oil semantics

`eo_products -> v_eo_product_oils_resolved -> essential_oils -> essential_oil_action_systems -> eo_action_systems`

This answers:

- which product families inherit body-system or therapeutic-goal semantics from component oils
- which blends should appear in the same semantic browse surface as their singular oils

### 6.2 Concern -> usage -> recipe triangle

`eo_health_concerns -> essential_oil_how_to_use_health_concern -> eo_how_to_use -> eo_application_methods`

plus

`eo_health_concerns -> eo_health_concern_recipes -> eo_health_concern_recipe_oils`

This answers:

- whether a concern is best served by a recipe, by a usage instruction, or by both
- which concerns are overrepresented in recipe content but underrepresented in how-to-use content

### 6.3 Chemistry -> property -> oil backfill

`chemical_compounds -> chemical_compound_therapeutic_properties -> eo_therapeutic_properties`

and then back to

`essential_oil_chemical_compounds -> essential_oils`

This answers:

- which oil claims are backed by compound evidence
- which compounds are broad hubs across many oils and many properties

### 6.4 Emotional corpus -> normalized ontology

`essential_oil_emotional.metadata -> body_part_or_symptom / emotional_root / underlying_emotions`

matched against

- `eo_health_concerns`
- `eo_action_systems`
- `eo_body_part` compatibility layer or canonical body-part action systems

This answers:

- which emotional records are already anchored to a known concern
- which ones need fuzzy matching or a curated synonym map

## 7. Modeling rules that should stay explicit

These rules are worth keeping in the report because they explain why some joins are valid and others are not.

- `how_to_use` is contextual recommendation data, not general oil permission.
- Products and blends should not be inserted into `essential_oils`.
- `essential_oil_therapeutic_properties` and `v_essential_oil_derived_therapeutic_properties` answer different questions and should not be merged mentally.
- `source_type` on `essential_oil_chemical_compounds` is the provenance layer.
- Multi-valued taxonomy rows should stay normalized; do not flatten them into a single text field.
- Query planning should be driven by populated tables only. Placeholder tables with zero rows should stay out of learning paths, dashboards, and recommendation surfaces until they receive real data or are removed.
- `eo_pregnancy_nursing_statuses.status_description` preserves the legacy Bubble tag; app code should prefer the clean pregnancy views and clean `code`/`name` fields.

## 8. Further query options for an aromatherapy education and self-learning app

These query options are intentionally built only from populated tables and views. They are useful for lessons, guided exploration, quizzes, comparison pages, and explainable recommendations.

### 8.1 Lesson and curriculum builders

| Learning surface | Query path | Usage in the app |
| --- | --- | --- |
| Beginner oil profile lessons | `v_essential_oil_full_details`, `v_oil_aroma_profile`, `v_oil_sourcing_details`, `essential_oils_with_safety` | one compact lesson per oil: identity, sourcing, aroma, allowed methods, safety, and starter use cases |
| Chemistry-first lessons | `essential_oil_chemistry -> chemical_compounds -> chemical_compound_therapeutic_properties -> eo_therapeutic_properties` | explain why an oil is associated with a property by showing its major compounds and their mapped properties |
| Body-system modules | `eo_action_systems -> essential_oil_action_systems -> essential_oils`, plus `health_concern_action_systems` | build units such as respiratory, digestive, skin, emotional, or muscular support from the existing action-system taxonomy |
| Concern-based lessons | `eo_health_concerns -> essential_oil_health_concern -> essential_oils -> v_oil_usage_recommendations` | teach a condition or goal, then show oils and method-specific instructions |
| Recipe practice lessons | `eo_health_concern_recipes -> eo_health_concern_recipe_oils -> essential_oils`, plus instructions and application methods | turn recipes into exercises: identify intent, method, oils, drops, carrier, and protocol |
| Evidence-reading lessons | `essential_oil_reports` joined by `oil_name` to `essential_oils`, plus `essential_oil_chemistry` | teach learners how report metadata and compound ranges relate to an oil profile |
| Product/blend decomposition | `eo_products -> v_eo_product_oils_resolved -> essential_oils` | let learners open a blend/product and study its component oils and inherited semantics |

Starter query for an oil lesson card:

```sql
select
  o.id,
  o.name_english,
  o.name_portuguese,
  o.name_scientific,
  s.plant_parts,
  s.extraction_methods,
  s.countries,
  a.aroma_scents,
  iu.name as internal_use,
  d.name as dilution,
  p.name as phototoxicity
from essential_oils o
left join v_oil_sourcing_details s on s.oil_id = o.id
left join v_oil_aroma_profile a on a.oil_id = o.id
left join eo_internal_use_statuses iu on iu.id = o.internal_use_status_id
left join eo_dilution_recommendations d on d.id = o.dilution_recommendation_id
left join eo_phototoxicity_statuses p on p.id = o.phototoxicity_status_id
where o.id = :essential_oil_id;
```

### 8.2 Guided discovery and recommendation queries

| User question | Query path | Good UI result |
| --- | --- | --- |
| "What should I study for this concern?" | `eo_health_concerns -> essential_oil_health_concern -> essential_oils`, plus `v_oil_usage_recommendations` | ranked concern page with oils, application methods, and readable instructions |
| "Which oils are similar to this one?" | shared rows in `essential_oil_health_concern`, `essential_oil_therapeutic_properties`, `essential_oil_action_systems`, and `essential_oil_chemical_compounds` | similarity carousel for compare-and-learn workflows |
| "Which oils teach this compound?" | `chemical_compounds -> essential_oil_chemical_compounds -> essential_oils` ordered by `typical_percentage` or `max_percentage` | compound lesson pages with example oils |
| "Which recipes use oils I already know?" | learner-known oil IDs against `eo_health_concern_recipe_oils` | recipe practice recommendations from familiar ingredients |
| "Which products contain this oil?" | `essential_oils -> v_eo_product_oils_resolved -> eo_products` | product/blend browse from a single oil profile |
| "Which concerns connect to this body system or goal?" | `eo_action_systems -> health_concern_action_systems -> eo_health_concerns` | action-system learning map |
| "Which oils are suitable for this method?" | `essential_oil_application_methods -> eo_application_methods`, combined with safety lookups | method-specific browse for aromatic, topical, and internal learning paths |

Starter query for concern study recommendations:

```sql
select
  hc.id as health_concern_id,
  coalesce(hc.name_english, hc.benefit_name) as health_concern,
  o.id as essential_oil_id,
  o.name_english as oil_name,
  count(distinct ur.how_to_use_id) as instruction_count,
  count(distinct eotp.property_id) as direct_property_count,
  count(distinct eas.action_system_id) as action_system_count
from eo_health_concerns hc
join essential_oil_health_concern eohc on eohc.health_concern_id = hc.id
join essential_oils o on o.id = eohc.essential_oil_id
left join v_oil_usage_recommendations ur
  on ur.health_concern_id = hc.id
 and ur.essential_oil_id = o.id
left join essential_oil_therapeutic_properties eotp on eotp.essential_oil_id = o.id
left join essential_oil_action_systems eas on eas.essential_oil_id = o.id
where hc.id = :health_concern_id
group by hc.id, hc.name_english, hc.benefit_name, o.id, o.name_english
order by instruction_count desc, direct_property_count desc, action_system_count desc, o.name_english;
```

Starter query for "find similar oils":

```sql
with selected as (
  select :essential_oil_id::uuid as oil_id
),
matches as (
  select eohc.essential_oil_id, 3 as weight
  from essential_oil_health_concern eohc
  where eohc.health_concern_id in (
    select health_concern_id from essential_oil_health_concern where essential_oil_id = (select oil_id from selected)
  )
  union all
  select eotp.essential_oil_id, 2
  from essential_oil_therapeutic_properties eotp
  where eotp.property_id in (
    select property_id from essential_oil_therapeutic_properties where essential_oil_id = (select oil_id from selected)
  )
  union all
  select eas.essential_oil_id, 2
  from essential_oil_action_systems eas
  where eas.action_system_id in (
    select action_system_id from essential_oil_action_systems where essential_oil_id = (select oil_id from selected)
  )
  union all
  select eocc.essential_oil_id, 1
  from essential_oil_chemical_compounds eocc
  where eocc.chemical_compound_id in (
    select chemical_compound_id from essential_oil_chemical_compounds where essential_oil_id = (select oil_id from selected)
  )
)
select
  o.id,
  o.name_english,
  sum(m.weight) as similarity_score
from matches m
join essential_oils o on o.id = m.essential_oil_id
where o.id <> (select oil_id from selected)
group by o.id, o.name_english
order by similarity_score desc, o.name_english
limit 12;
```

### 8.3 Quiz, flashcard, and spaced-repetition query options

| Exercise type | Query path | Prompt idea |
| --- | --- | --- |
| Oil identity flashcards | `essential_oils`, `v_oil_sourcing_details`, `v_oil_aroma_profile` | show plant part, country, aroma, and scientific name; ask the learner to identify the oil |
| Safety filter quiz | `essential_oils -> eo_internal_use_statuses / eo_dilution_recommendations / eo_phototoxicity_statuses` | ask whether an oil is internal-safe, phototoxic, neat, sensitive, or dilute |
| Method matching quiz | `v_oil_usage_recommendations` | show a concern and instruction; ask whether it is aromatic, topical, or internal |
| Compound matching quiz | `essential_oil_chemistry` | show a compound and percentage range; ask which oil it appears in |
| Property inference quiz | `chemical_compound_therapeutic_properties` and `v_essential_oil_derived_therapeutic_properties` | ask which property can be inferred from an oil's compound profile |
| Recipe ordering quiz | `eo_health_concern_recipe_instructions` | scramble steps and ask the learner to restore `step_order` |
| Drops and formulation quiz | `eo_health_concern_recipe_oils` | ask learners to calculate total drops or identify the highest-drop oil in a recipe |

Starter query for quiz candidates with enough supporting facts:

```sql
select
  o.id,
  o.name_english,
  count(distinct eocc.chemical_compound_id) as compound_count,
  count(distinct eohc.health_concern_id) as concern_count,
  count(distinct eotp.property_id) as property_count,
  count(distinct eas.action_system_id) as action_system_count
from essential_oils o
left join essential_oil_chemical_compounds eocc on eocc.essential_oil_id = o.id
left join essential_oil_health_concern eohc on eohc.essential_oil_id = o.id
left join essential_oil_therapeutic_properties eotp on eotp.essential_oil_id = o.id
left join essential_oil_action_systems eas on eas.essential_oil_id = o.id
group by o.id, o.name_english
having count(distinct eocc.chemical_compound_id) >= 2
   and count(distinct eohc.health_concern_id) >= 5
   and count(distinct eotp.property_id) >= 3
order by concern_count desc, compound_count desc, o.name_english;
```

### 8.4 Learning progress and personalization surfaces

The current migrated graph can personalize study content without needing new migration tables. App-specific progress can live outside this graph, while the EO graph provides the candidate content.

| Personalization goal | Query option | Why it works |
| --- | --- | --- |
| Next oil to study | rank oils by unseen health concerns, compounds, or action systems | uses dense oil links without needing user-generated EO data |
| Remedial safety practice | filter oils by missed safety status and pull contrasting examples | safety lookups are normalized and complete for core oil-level status |
| Build a weekly study path | alternate oil, concern, chemistry, recipe, and product lessons | each lesson type comes from a populated branch of the graph |
| Explain a recommendation | return the concern link, method instruction, shared action system, and compound-derived property | makes recommendation output auditable |
| Bilingual learning | use English and Portuguese fields from oils, concerns, properties, action systems, and products | supports language toggles and translation drills |
| Evidence confidence | separate official compound rows from secondary rows using `source_type` | teaches provenance instead of treating all chemical links equally |

Starter query for a balanced weekly study path:

```sql
(
  select 'oil' as lesson_type, o.id, o.name_english as title, null::text as subtitle
  from essential_oils o
  join essential_oil_chemical_compounds eocc on eocc.essential_oil_id = o.id
  group by o.id, o.name_english
  order by count(*) desc, o.name_english
  limit 3
)
union all
(
  select 'concern', hc.id, coalesce(hc.name_english, hc.benefit_name), hc.name_portuguese
  from eo_health_concerns hc
  join essential_oil_health_concern eohc on eohc.health_concern_id = hc.id
  group by hc.id, hc.name_english, hc.benefit_name, hc.name_portuguese
  order by count(*) desc, coalesce(hc.name_english, hc.benefit_name)
  limit 3
)
union all
(
  select 'compound', cc.id, cc.name, cc.carbon_structure
  from chemical_compounds cc
  join essential_oil_chemical_compounds eocc on eocc.chemical_compound_id = cc.id
  group by cc.id, cc.name, cc.carbon_structure
  order by count(*) desc, cc.name
  limit 3
)
union all
(
  select 'recipe', r.id, r.recipe_title, coalesce(hc.name_english, hc.benefit_name)
  from eo_health_concern_recipes r
  left join eo_health_concerns hc on hc.id = r.health_concern_id
  where r.recipe_title is not null
  order by r.bubble_created_at desc nulls last, r.created_at desc
  limit 3
);
```

### 8.5 Admin and content QA queries for the education app

| QA question | Query path | Use |
| --- | --- | --- |
| Which oils are too sparse for a complete lesson? | count compounds, concerns, action systems, properties, aroma scents, and sourcing rows per oil | hide or queue sparse lessons for editorial review |
| Which health concerns have recipes but weak usage instructions? | `eo_health_concern_recipes` compared with `v_oil_usage_recommendations` | decide where to improve instruction content |
| Which recipes lack structured oils, instructions, or methods? | recipe table left joined to recipe bridges | QA recipe cards before publishing them |
| Which products have prices but no resolved oils? | `eo_products` left join `v_eo_product_oils_resolved` | separate non-oil catalog lessons from blend/oil lessons |
| Which chemistry rows lack useful percentages? | `essential_oil_chemical_compounds` where all percentage fields are null | avoid weak compound quizzes |
| Which report records need storage cleanup? | `essential_oil_reports` where storage fields or hashes are null | keep evidence links reliable |

Starter query for recipe completeness:

```sql
select
  r.id,
  r.recipe_title,
  coalesce(hc.name_english, hc.benefit_name) as health_concern,
  count(distinct ro.essential_oil_id) as oil_count,
  count(distinct ri.id) as instruction_count,
  count(distinct ram.application_method_id) as method_count,
  bool_or(r.reviewed_by_daiane) as reviewed
from eo_health_concern_recipes r
left join eo_health_concerns hc on hc.id = r.health_concern_id
left join eo_health_concern_recipe_oils ro on ro.recipe_id = r.id
left join eo_health_concern_recipe_instructions ri on ri.recipe_id = r.id
left join eo_health_concern_recipe_application_methods ram on ram.recipe_id = r.id
group by r.id, r.recipe_title, hc.name_english, hc.benefit_name
order by oil_count asc, instruction_count asc, method_count asc, r.recipe_title;
```

## 9. Where the report should go next

If this database keeps growing in the same direction, the next useful layer is not more tables. It is a small set of explicit graph views that make the oil, product, concern, chemistry, safety, and semantic domains queryable without hand-writing the same join chains over and over.

The strongest candidates are:

1. a single oil evidence profile
2. a product knowledge profile
3. a concern recommendation graph
4. a safety profile
5. a chemistry network
6. an emotional semantic graph
