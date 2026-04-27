# Bubble to Supabase migration status

Generated: 2026-04-26 UTC

## Scope

This report focuses on relationalizing the Bubble data graph around essential oils, chemistry, usage, extraction, aroma, and health concerns into Postgres/Supabase.

Product tables such as `product-worldwide` and `product-www_internal_dilution` are intentionally out of scope.

## Sources checked

- Bubble API key and database URL: `bubble/env.md`
- Bubble exposed types list: `bubble/types.html`
- Legacy n8n flow: `bubble/n8n_legacy_flow_Data Bubble_to_ Supabase.json`
- Supabase/Postgres live schema: `backend.aromachat.app:5432/postgres`

Important note: `types.html` shows `version-test` URLs, but `env.md` says the Bubble environment is `live`. This report uses live Bubble API data as the source of truth.

## Environment validation

- Bubble Data API is reachable.
- Postgres/Supabase is reachable and authenticates on both `backend.rotinanatural.com.br` and `backend.aromachat.app`.
- `backend.rotinanatural.com.br` and `backend.aromachat.app` currently appear to expose the same Postgres contents by schema fingerprint and public-table row counts.

## Decisions made

These decisions were made after reviewing the initial migration gaps and rechecking newly exposed Bubble types.

### 1. Model blends/products separately from essential oils

Decision: do not insert Bubble mixes/blends directly into `essential_oils`.

The 44 Bubble `oil_specific` rows missing from Supabase are mostly mixes/blends/products and have `Is_mix = true`. These should be represented as products/blends, not as single essential oils.

Selected model:

- `eo_product_types`
- `eo_products`
- `eo_product_oils`

`eo_product_types` should be a separate lookup table, not a loose text field, so product types can be registered and managed independently.

`eo_product_oils` should store the product/blend composition by linking each product to its component `essential_oils`.

### 2. Use Bubble `oil_product` as the product/blend source

Decision: migrate `oil_product` as the source for products/blends.

After exposing `oil_product`, Bubble live returned 303 rows. The key field is:

- `oil_product.singular_oils_inside`

This field contains the component oils inside a product/blend.

Current live Bubble findings:

- `oil_product` rows: 303
- products with `singular_oils_inside`: 212
- product/component pairs: 856
- component refs already present in Supabase `essential_oils`: 790
- component refs pointing to the 44 not-yet-modeled mixes/blends: 66

Migration rule:

- Import `oil_product` into `eo_products`.
- Import `oil_product.Category` into/through `eo_product_types`.
- Import `oil_product.singular_oils_inside` into `eo_product_oils`.
- Ignore self/circular references when a product points to its own mix/blend identity.

This supports future queries such as: which blend/product has the highest known amount of a given compound, by traversing:

`eo_products -> eo_product_oils -> essential_oils -> essential_oil_chemical_compounds -> chemical_compounds`

### 3. Track chemical compound source with a Postgres enum

Decision: keep official and secondary oil-compound relationships in the same table, but prevent duplicate oil/compound pairs and store source metadata.

`composto_quimico_range` is treated as the official/validated source because it comes from the dōTERRA chemistry handbook material.

`oil_specific.Composto Químico` is treated as a secondary source because those relations appear to come from secondary sources, chromatography, or manual curation.

Selected schema direction:

```sql
CREATE TYPE chemical_compound_source_type AS ENUM (
  'official_doterra',
  'secondary',
  'chromatography',
  'manual',
  'unknown'
);

ALTER TABLE essential_oil_chemical_compounds
ADD COLUMN source_type chemical_compound_source_type NOT NULL DEFAULT 'unknown',
ADD COLUMN source_reference text;
```

Deduplication rule:

```sql
UNIQUE (essential_oil_id, chemical_compound_id)
```

Source priority rule:

- If an oil/compound pair exists from `composto_quimico_range`, keep it as `official_doterra`.
- If the same oil/compound pair also appears in `oil_specific.Composto Químico`, do not insert a duplicate.
- If an oil/compound pair appears only in `oil_specific.Composto Químico`, insert it as `secondary`.
- If a pair exists as `secondary` and later appears as official, upgrade it to `official_doterra` and fill the official percentage/range fields.

No `confidence_score` column should be added now. If confidence is needed later, it can be derived in code or views from `source_type`.

### 4. Do not store oil therapeutic properties derived from compounds as direct oil properties

Decision: do not migrate `oil_specific.Propriedade Quimica Pelo Composto` directly into `essential_oil_therapeutic_properties`.

That field should be treated as derived data. The normalized source of truth should be:

`chemical_compound -> therapeutic_property`

Selected schema direction:

```sql
chemical_compound_therapeutic_properties
- chemical_compound_id
- therapeutic_property_id
- source_type
- source_reference
- created_at
```

With:

```sql
UNIQUE (chemical_compound_id, therapeutic_property_id)
```

Then create a derived view:

```sql
v_essential_oil_derived_therapeutic_properties
```

The view should derive:

`essential_oil -> chemical_compound -> therapeutic_property`

Initial Bubble sources for compound/property relations:

- `composto_quimico.Propriedade Funcional`
- `propriedade_quimica.Composto Químico`

### 5. Normalize chemical functional groups and carbon structures

Decision: normalize both functional groups and carbon structures rather than keeping them only as text fields.

Bubble live has:

- `quimica_grupo_funcional`: 8 rows
- `quimica_estrutura_carbono`: 3 rows

Examples:

- `Limonene`: `Alkene` + `Monoterpene`
- `Linalool`: `Alcohol` + `Monoterpene`
- `Beta-caryophyllene`: `Alkene` + `Sesquiterpene`
- `Camphor`: `Ketone` + `Monoterpene`
- `Eugenol`: `Phenylpropene` + `Phenol` + `Monoterpene`

`Eugenol` is the important example proving this is not always a simple one-value text field: one compound can have more than one functional group.

Selected schema direction:

- `chemical_functional_groups`
- `chemical_carbon_structures`
- `chemical_compound_functional_groups`
- `chemical_compound_carbon_structures`
- `chemical_functional_group_carbon_structures`

This supports future queries such as:

- which oils contain phenols?
- which blends contain monoterpenes?
- which therapeutic properties are associated with alcohols?
- which compounds bridge multiple chemical groups?

### 6. Normalize `sistemas_atuacao` as action systems

Decision: migrate Bubble `sistemas_atuacao` into a relational action-system model.

After exposing `sistemas_atuacao`, Bubble live returned 39 rows. The previously suspected `zzz_sistemas_corporais` type returned 0 rows and should be ignored as legacy/test data.

Current live Bubble findings:

- `sistemas_atuacao` rows: 39
- referenced system IDs from oils/health concerns/products: 37
- unresolved referenced IDs: 0
- `zzz_sistemas_corporais` rows: 0

Fields available in `sistemas_atuacao` include:

- `Nome Sistema Atuacao`
- `Iconify`
- `is_body_system`
- `Oleo Específico`
- `Principais usos doencas`
- `Oleo_produto`

`Iconify` should not be migrated because it was only used by the legacy UI.

`is_body_system` should not be migrated directly because the approved model uses an enum instead.

Selected schema direction:

```sql
CREATE TYPE eo_action_system_type AS ENUM (
  'body_system',
  'body_part',
  'functional_area',
  'therapeutic_goal',
  'life_stage',
  'use_context',
  'unknown'
);
```

```sql
eo_action_systems
- id
- bubble_uid
- name
- name_portuguese
- action_type eo_action_system_type
- created_at
- updated_at
```

Relations to create:

```sql
essential_oil_action_systems
- essential_oil_id
- action_system_id
```

```sql
health_concern_action_systems
- health_concern_id
- action_system_id
```

Decision: do not create `eo_product_systems`.

Product/blend systems can be derived through:

`eo_products -> eo_product_oils -> essential_oils -> essential_oil_action_systems`

Only add a direct `eo_product_systems` table in a future migration if product-level curation from Bubble needs to be preserved separately from component-oil inheritance.

Decision: manually classify all 39 `sistemas_atuacao` rows into `eo_action_system_type`; do not default all non-body-system rows to `unknown`.

Existing `eo_body_part` rows should also be migrated into `eo_action_systems` with:

```text
action_type = 'body_part'
```

This avoids maintaining two separate concepts for body parts.

Current compatibility requirement:

- `eo_body_part` exists and has 57 rows.
- `essential_oil_how_to_use_body_part` already links `eo_how_to_use` to body parts.

Migration direction:

- Preserve `eo_body_part.id` as `eo_action_systems.id` where possible.
- Create `essential_oil_how_to_use_action_systems`.
- Migrate old `essential_oil_how_to_use_body_part` rows into the new bridge.
- Keep compatibility views such as `v_eo_body_part` and `v_essential_oil_how_to_use_body_part` for old read paths.

Example classification direction:

- `Cérebro` -> `body_part`
- `Límbico` -> `body_system`
- `Respiratório` -> `body_system`
- `Digestivo e Intestinal` -> `body_system`
- `Pele, unha e cabelo` -> `body_part`
- `Sono` -> `therapeutic_goal`
- `Estresse` -> `therapeutic_goal`
- `Atletas` -> `use_context`
- `Gravidez` -> `life_stage`
- `Crianças` -> `life_stage`
- `Primeiros Socorros` -> `use_context`

### 7. Migrate `color-label` as UX/UI metadata

Decision: migrate Bubble `color-label` because it is important for product/oil UX/UI.

Current Bubble status:

- `oil_specific.color-label` exists as a single ID field.
- `oil_product.color-label` exists as a single ID field.
- The target Bubble type is exposed as `color_label`.

Fields available in `color_label` include:

- `color-name-english`
- `color-name-portuguese`
- `hex-color`
- `oil_specific`
- `oil_product`

Current reference counts from live Bubble data:

- `color_label` rows: 45
- distinct `color-label` IDs referenced: 45
- total references from `oil_specific` and `oil_product`: 289
- referenced IDs resolved by `color_label`: 45/45
- unreferenced `color_label` rows: 0

Selected schema direction:

```text
eo_color_labels
- id
- bubble_uid
- name_english
- name_portuguese
- color_hex
- created_at
- updated_at
```

Because Bubble stores a single `color-label` per oil/product, use nullable foreign keys rather than bridge tables unless the Bubble target type reveals a many-label model later.

```text
essential_oils.color_label_id -> eo_color_labels.id
eo_products.color_label_id -> eo_color_labels.id
```

Migration requirement:

- insert labels into `eo_color_labels`;
- map `oil_specific.color-label` to `essential_oils.color_label_id`;
- map `oil_product.color-label` to `eo_products.color_label_id`.

## Legacy n8n coverage

The legacy n8n flow mainly covers:

- Bubble `oil_specific`
- Bubble `composto_quimico_range`
- Supabase lookups into `essential_oils`
- Inserts/checks for chemistry and extraction method data
- Inserts into relation tables equivalent to:
  - `essential_oil_chemical_compounds`
  - `essential_oil_extraction_methods`

The n8n flow does not appear to cover the full EO graph now present in Supabase, especially countries, plant parts, aroma, health concerns, how-to-use, body parts, and the deeper chemistry taxonomy.

## Current Supabase EO schema

Core lookup tables present:

| Supabase table | Rows |
| --- | ---: |
| `essential_oils` | 120 |
| `chemical_compounds` | 141 |
| `eo_extraction_methods` | 6 |
| `eo_countries` | 39 |
| `eo_plant_parts` | 11 |
| `eo_aroma_scents` | 46 |
| `eo_health_concerns` | 599 |
| `eo_therapeutic_properties` | 82 |
| `chemical_functional_groups` | 8 |
| `chemical_carbon_structures` | 3 |
| `eo_body_part` | 57 |
| `eo_how_to_use` | 43 |
| `eo_application_methods` | 3 |
| `eo_internal_use_statuses` | 2 |
| `eo_dilution_recommendations` | 3 |
| `eo_phototoxicity_statuses` | 2 |
| `eo_action_systems` | 96 |
| `eo_color_labels` | 45 |

Core relation tables present:

| Supabase table | Rows |
| --- | ---: |
| `essential_oil_chemical_compounds` | 400 |
| `essential_oil_extraction_methods` | 121 |
| `essential_oil_extraction_countries` | 145 |
| `essential_oil_plant_parts` | 153 |
| `essential_oil_aroma_scents` | 371 |
| `essential_oil_health_concern` | 3908 |
| `essential_oil_application_methods` | 316 |
| `essential_oil_therapeutic_properties` | 1601 |
| `chemical_compound_therapeutic_properties` | 538 |
| `chemical_compound_functional_groups` | 76 |
| `chemical_compound_carbon_structures` | 77 |
| `chemical_functional_group_carbon_structures` | 12 |
| `eo_therapeutic_property_functional_groups` | 80 |
| `eo_therapeutic_property_carbon_structures` | 68 |
| `essential_oil_action_systems` | 222 |
| `health_concern_action_systems` | 1007 |
| `essential_oil_how_to_use_action_systems` | 7 |
| `essential_oil_how_to_use_body_part` | 7 |
| `essential_oil_how_to_use_health_concern` | 1971 |
| `essential_oil_pregnancy_nursing_safety` | 73 |

Product/blend tables present:

| Supabase table/view | Rows |
| --- | ---: |
| `eo_products` | 303 |
| `eo_product_types` | 17 |
| `eo_product_type_assignments` | 397 |
| `eo_product_oils` | 803 |
| `v_eo_product_oils_resolved` | 827 |

Empty EO relation tables:

| Supabase table | Rows | Status |
| --- | ---: | --- |
| `essential_oil_aroma_notes` | 0 | no clear Bubble source confirmed in the current exposed EO graph |
| `essential_oil_chakra_association` | 0 | no clear Bubble source confirmed in the current exposed EO graph |
| `essential_oil_child_safety` | 0 | no clear Bubble source confirmed in the current exposed EO graph |
| `essential_oil_pet_safety` | 0 | no clear Bubble source confirmed in the current exposed EO graph |
| `essential_oil_energetic_emotional_properties` | 0 | no clear Bubble source confirmed in the current exposed EO graph |

Removed EO relation tables:

| Supabase table | Previous rows | Reason |
| --- | ---: | --- |
| `usage_instructions` | 0 | Unused alternative direct model for `oil + health concern + application method + instruction_text`. No views/functions depended on it; current usage data lives in `eo_how_to_use`, `eo_application_methods`, and `essential_oil_how_to_use_health_concern`. |

Compatibility views:

- `v_essential_oil_full_details.application_methods` now represents the general oil-level application methods migrated from Bubble `oil_specific` booleans:
  `Aromático`, `Tópico`, and `Ingestão`.
- General coverage: 120/120 oils have at least one general application method.
- `derived_application_methods` was removed from `v_essential_oil_full_details` because deriving oil-level permission from `how_to_use` through health concerns is misleading.
- `how_to_use` data must remain contextual recommendation/instruction data for health concerns, not a source of general oil-level application permission.

## Lookup coverage against live Bubble

| Concept | Bubble type | Bubble live rows | Supabase mapped rows | Status |
| --- | --- | ---: | ---: | --- |
| Essential oils | `oil_specific` | 164 | 120 | 44 Bubble rows are products/blends, not singular oils; see implementation backlog item 1 |
| Chemical compounds | `composto_quimico` | 141 | 141 | complete |
| Compound ranges | `composto_quimico_range` | 194 | 194 in `essential_oil_chemical_compounds.bubble_id` | complete |
| Extraction methods | `extracao_modo` | 6 | 6 | complete |
| Extraction countries | `extracao_pais` | 194 | 39 | all oil-linked country relations are loaded, but unused country lookup rows are not loaded |
| Plant parts | `extracao_parte_planta` | 11 | 11 | complete |
| Aroma descriptions/scents | `descricao_aromatica` | 45 | 46 | Bubble live is covered; Supabase has 1 extra row from another environment or older run |
| Health concerns | `queixa-foco` | 599 | 599 | complete |
| Therapeutic properties | `propriedade_quimica` | 88 | 82 | 5 Bubble alias rows were consolidated into their canonical concepts; 1 empty Bubble record was excluded from the migration |
| How-to-use | `how_use` | 43 | 43 | complete |
| Body parts | `body_part` | 57 | 57 | complete |

## Relation coverage against live Bubble

| Relation | Bubble source | Bubble pairs | Supabase pairs | Status |
| --- | --- | ---: | ---: | --- |
| Oil -> chemical compound, using range rows | `composto_quimico_range` | 194 | 194 official `official_doterra` pairs | complete |
| Oil -> chemical compound, using direct oil list | `oil_specific.Composto Químico` | 399 | 400 total Supabase pairs, including 206 `secondary` pairs | complete |
| Oil -> extraction method | `oil_specific.Modo de Extração` plus inverse `extracao_modo.Óleo Específico` | 121 | 121 | complete |
| Oil -> extraction country | `oil_specific.País de Extração` plus inverse `extracao_pais.Óleo Específico` | 145 | 145 | complete |
| Oil -> plant part | `oil_specific.Parte da planta` plus inverse `extracao_parte_planta.Óleo Específico` | 153 | 153 | complete |
| Oil -> aroma scent | `oil_specific.Descrição Aromática` plus inverse `descricao_aromatica.Óleo Específico` | 371 | 371 | complete |
| Singular oil -> health concern | union of `oil_specific.Principais Usos e doenças` and inverse `queixa-foco.oleos Específicos`, excluding products/mix/blends | 3908 | 3908 | complete |
| Oil -> therapeutic property, direct | `oil_specific.Propriedade Química` plus inverse `propriedade_quimica.Óleos específicos` | 1374 | 1601 | all direct Bubble pairs are loaded; Supabase has 227 extra pairs |
| Compound -> therapeutic property | union of `composto_quimico.Propriedade Funcional` and inverse `propriedade_quimica.Composto Químico` | 539 | 538 in `chemical_compound_therapeutic_properties` after consolidating one redundant alias row | complete |
| Oil -> therapeutic property by compound | derived from `essential_oil_chemical_compounds -> chemical_compound_therapeutic_properties` | 1527 | 1527 in `v_essential_oil_derived_therapeutic_properties` | complete as derived view |
| How-to-use -> body part | `how_use.body_part` | 7 | 7 | complete |
| How-to-use -> health concern | `how_use_pivot` | 1971 | 1971 | complete |

### Therapeutic property anomaly note

`Muscle Relaxant` currently maps to only 2 oils in Supabase:

- `Clary Sage`
- `Peppermint`

This is materially narrower than neighboring properties such as `Relaxant` and `Antispasmodic`, which include many other oils that look like plausible muscle-relaxant candidates. The current state suggests one of these is true:

- Bubble used a different category for some muscle-relaxant oils.
- Bubble omitted `Muscle Relaxant` from many oils that should have had it.
- `Muscle Relaxant` is a narrow subtype and should not be treated as a synonym for `Relaxant`.

For now, keep the existing IDs and treat this as an audit anomaly, not a consolidation candidate.

## Implementation backlog

This section separates work that is already decided but not yet implemented from the remaining open questions.

### 1. Implement products/blends

Status: implemented on 2026-04-26.

The 44 Bubble `oil_specific` rows not present in `essential_oils` should not be inserted as singular oils. They are products/blends and should be migrated through the product model:

- `eo_product_types`
- `eo_products`
- `eo_product_oils`
- `eo_product_type_assignments`
- `v_eo_product_oils_resolved`

Bubble source:

- `oil_product`
- `oil_product.Category`
- `oil_product.singular_oils_inside`
- `oil_product.color-label`

Known Bubble live counts:

- `oil_product` rows: 303
- products with `singular_oils_inside`: 212
- product/component pairs: 856
- component refs already present in Supabase `essential_oils`: 790
- component refs pointing to not-yet-modeled mixes/blends: 66

Implementation result:

- `eo_products`: 303 rows.
- `eo_product_types`: 17 rows.
- `eo_product_type_assignments`: 397 rows.
- `eo_product_oils`: 803 rows.
- direct mapped `oil_product.singular_oils_inside` component rows: 790.
- conservative exact-name inferred single-oil product rows: 13.
- `v_eo_product_oils_resolved`: 827 rows.
- product rows with `primary_product_type_id`: 259/303.
- product rows without Bubble category, therefore no primary type: 44/303.
- product rows without resolved oils: 75/303, mostly kits, diffusers, supplements, literature, personal-care products, or other non-oil catalog items.

Modeling detail: Bubble `oil_product.Category` is a list. The first category is stored as `eo_products.primary_product_type_id` for convenient product-type filtering, and all categories are preserved through `eo_product_type_assignments`.

`v_eo_product_oils_resolved` includes direct product-oil rows and also inherits oils from `main_product` when a product has no direct singular-oil rows, which covers cases such as `Deep Blue Rub`.

### 2. Import secondary direct oil-compound pairs

Status: implemented on 2026-04-26.

`composto_quimico_range` is already fully migrated into `essential_oil_chemical_compounds` and remains the official dōTERRA source with ranges.

`oil_specific.Composto Químico` contains secondary direct oil-compound pairs:

- Bubble direct pairs: 399
- overlap with range-based pairs: 193
- secondary-only pairs imported: 206

Implementation result:

- created `chemical_compound_source_type`;
- added `essential_oil_chemical_compounds.source_type`;
- added `essential_oil_chemical_compounds.source_reference`;
- kept one `chemical_compounds` row per compound;
- preserved the existing primary key on `(essential_oil_id, chemical_compound_id)`;
- marked the 194 existing range rows as `official_doterra`;
- inserted the 206 missing direct-list pairs as `secondary`;
- no confidence score was added.

Current source distribution:

- `official_doterra`: 194 pairs.
- `secondary`: 206 pairs.
- total `essential_oil_chemical_compounds`: 400 pairs.

### 3. Implement compound-derived therapeutic properties

Status: implemented on 2026-04-26.

Do not load `oil_specific.Propriedade Quimica Pelo Composto` directly into `essential_oil_therapeutic_properties`.

Instead, created/populated:

```text
chemical_compound_therapeutic_properties
```

Then created:

```text
v_essential_oil_derived_therapeutic_properties
```

The source of truth should be:

`essential_oil -> chemical_compound -> therapeutic_property`

Relevant Bubble sources:

- `composto_quimico.Propriedade Funcional`
- `propriedade_quimica.Composto Químico`
- `oil_specific.Propriedade Quimica Pelo Composto` as a comparison/audit source only

Implementation result:

- `composto_quimico.Propriedade Funcional`: 538 pairs.
- `propriedade_quimica.Composto Químico`: 539 pairs.
- Bubble union: 539 pairs.
- mapped union pairs: 539.
- stored `chemical_compound_therapeutic_properties`: 538 after consolidating redundant alias overlap.
- missing after import: 0.
- derived `v_essential_oil_derived_therapeutic_properties`: 1527 oil/property pairs.
- Supabase `eo_therapeutic_properties` currently has 82 rows after consolidating 5 Bubble alias rows into their canonical concepts and excluding the empty Bubble record `1654649682745x721249058084880400`.

### 4. Normalize chemistry taxonomy

Status: implemented on 2026-04-26.

Bubble has normalized chemistry taxonomy concepts that Supabase currently stores only partially as text.

Bubble source types/fields:

- `quimica_estrutura_carbono`: 3 rows
- `quimica_grupo_funcional`: 8 rows
- `composto_quimico.Estrutura Carbono`
- `composto_quimico.Grupo Funcional`
- `propriedade_quimica.Estrutura Carbono`
- `propriedade_quimica.Grupo Funcional`
- `quimica_estrutura_carbono.Grupo Funcional Químico`
- `quimica_grupo_funcional.Estrutura de Carbono`

Tables/bridges created and populated:

- `chemical_functional_groups`
- `chemical_carbon_structures`
- `chemical_compound_functional_groups`
- `chemical_compound_carbon_structures`
- `chemical_functional_group_carbon_structures`
- `eo_therapeutic_property_functional_groups`
- `eo_therapeutic_property_carbon_structures`

Implementation result:

- `chemical_functional_groups`: 8 rows.
- `chemical_carbon_structures`: 3 rows.
- `chemical_compound_functional_groups`: 76 rows.
- `chemical_compound_carbon_structures`: 77 rows.
- `chemical_functional_group_carbon_structures`: 12 rows.
- `eo_therapeutic_property_functional_groups`: 80 rows.
- `eo_therapeutic_property_carbon_structures`: 68 rows.

### 5. Implement action systems/body systems

Status: implemented on 2026-04-26.

Bubble `sistemas_atuacao` is exposed and should be migrated into the approved action-system model.

Known Bubble live counts:

- `sistemas_atuacao`: 39 rows
- referenced system IDs from oils/health concerns/products: 37
- unresolved referenced IDs: 0
- `zzz_sistemas_corporais`: 0 rows, legacy/test only

Implementation result:

- created/populated `eo_action_systems`: 96 rows.
- manually classified all 39 Bubble `sistemas_atuacao` rows into `eo_action_system_type`.
- migrated 57 existing `eo_body_part` rows into `eo_action_systems` while preserving their UUIDs.
- created/populated `essential_oil_action_systems`: 222 rows.
- created/populated `health_concern_action_systems`: 1007 rows.
- created/populated `essential_oil_how_to_use_action_systems`: 7 rows.
- created compatibility view `v_eo_body_part`: 60 body-part/action rows.
- created compatibility view `v_essential_oil_how_to_use_body_part`: 7 rows.
- did not create `eo_product_systems`.
- product systems remain derivable through product component oils and `essential_oil_action_systems`.

Action-system classification distribution:

- `body_system`: 10.
- `body_part`: 60, including 57 old body parts plus 3 Bubble `sistemas_atuacao` rows classified as body parts.
- `functional_area`: 5.
- `therapeutic_goal`: 14.
- `life_stage`: 4.
- `use_context`: 3.
- `unknown`: 0.

### 6. Implement color labels

Status: implemented on 2026-04-26.

Bubble `color-label` is in scope because it is important UX/UI metadata.

Known Bubble live counts:

- `color_label` rows: 45
- distinct referenced color-label IDs: 45
- total references from `oil_specific` and `oil_product`: 289
- referenced IDs resolved by `color_label`: 45/45
- unreferenced `color_label` rows: 0

Implementation result:

- created/populated `eo_color_labels`: 45 rows.
- added/mapped `essential_oils.color_label_id`: 78 oils currently linked.
- added/mapped `eo_products.color_label_id`: 210 products currently linked.
- kept `eo_products.color_label_bubble_uid` as traceability for Bubble source IDs.

## Completed or resolved follow-up items

### Health concern links are complete for singular oils

All `how_use_pivot` usage relations are migrated, and direct singular-oil-to-health-concern links are now complete.

The comparison uses the union of both Bubble sides because Bubble relation fields are not perfectly symmetric:

- `oil_specific.Principais Usos e doenças`
- `queixa-foco.oleos Específicos`

For singular oils only, excluding products/mix/blends:

- Bubble union: 3908 pairs.
- Supabase `essential_oil_health_concern`: 3908 pairs.
- Missing after import: 0.
- Extra Supabase pairs outside the Bubble union: 0.
- Duplicate pairs: 0.

The 105 missing singular-oil pairs identified from the Bubble union were imported. Product/mix/blend health concern pairs were intentionally not imported into `essential_oil_health_concern`; they belong in the product/blend model.

### Chromatography/PDF reports are resolved

Chromatography should remain modeled as oil report evidence, not parsed into normalized chemistry compounds.

Current implementation:

- `essential_oil_reports` stores report metadata.
- report PDFs were migrated to Supabase Storage bucket `essential-oil-reports`.
- the report table keeps source URL/storage metadata for traceability.

### Safety/application method modeling is resolved for general oil methods

Supabase has non-null status columns for all 120 currently migrated oils:

- `essential_oils.internal_use_status_id`: 120/120
- `essential_oils.dilution_recommendation_id`: 120/120
- `essential_oils.phototoxicity_status_id`: 120/120

Pregnancy safety naming and query semantics were cleaned up on 2026-04-27 after verifying live Bubble `oil_specific.filters-category` against Postgres:

- Bubble pregnancy-tagged oils: 51.
- Postgres pregnancy-tagged oils: 51.
- Row/tag mismatches by Bubble `_id`: 0.
- `eo_pregnancy_nursing_statuses.status_description` still preserves the legacy Bubble tag strings.
- Clean app-facing values now live in `eo_pregnancy_nursing_statuses.code` and `name`.
- `v_oil_pregnancy_safety_tags` exposes one clean tag row per oil/tag.
- `v_oil_pregnancy_safety_profile` exposes one row per oil with final pregnancy category and additive flags.

Clean pregnancy categories:

- `pregnancy_safe_all_trimesters`: 16 oils.
- `pregnancy_safe_after_first_trimester`: 21 oils; this applies the Bubble pipeline rule `pregnancy-safe-100` and not `pregnancy-safe-3months`.
- `pregnancy_professional_guidance`: 11 oils.
- `pregnancy_no_guidance`: 72 oils, including labor-only oils with no trimester/professional category.

Additive pregnancy flags:

- `has_professional_guidance`: 12 oils.
- `has_labor_delivery_guidance`: 8 oils.
- `has_lactation_guidance`: 0 oils.

Related safety bridge tables are still empty and are tracked in the open pending item below:

- `essential_oil_child_safety`
- `essential_oil_pet_safety`

`essential_oil_application_methods` was recreated and populated from Bubble `oil_specific` boolean fields as a general oil-level method model:

- `Aromático` -> `Aromatic`: 120 oils.
- `Tópico` -> `Topical`: 120 oils.
- `Ingestão` -> `Internal`: 76 oils.

The table keeps RLS aligned with other public EO relation tables: anonymous SELECT is allowed, and admin users can manage rows.

Current contextual how-to-use data is:

- Bubble `how_use`: 43 rows.
- Supabase `eo_how_to_use`: 43 rows.
- Bubble `how_use.main_category` maps to `eo_application_methods`:
  - `use-aromatic` -> `Aromatic`: 6 rows.
  - `use-topic` -> `Topical`: 34 rows.
  - `use-internal` -> `Internal`: 3 rows.
- Bubble `how_use_pivot`: 1975 rows, of which 4 are incomplete because either `how_use` or `queixa-foco` is missing.
- Supabase `essential_oil_how_to_use_health_concern`: 1971 valid rows.
- `usage_instructions` was dropped after confirming it had 0 rows and no view/function dependencies. Its intended direct model (`oil + health concern + application method + instruction_text`) was not used; the data landed in `eo_how_to_use` plus bridge tables instead.

Important modeling decision: `eo_how_to_use.application_method_id` describes the method for a contextual recommendation tied to a health concern. It must not be inherited by every oil linked to that health concern. General oil-level application methods are stored only in `essential_oil_application_methods`, migrated from the Bubble `oil_specific` boolean fields.

Bubble `oil_specific` has boolean fields such as:

- `Aromático`
- `Tópico`
- `Ingestão`
- `Fotossensível`
- `Diluição Obrigatória`
- `Diluição 2x`

Those appear to have been transformed into status lookup IDs. General oil-level application methods are resolved; deeper safety/emotional/chakra/aroma-note tables remain a separate pending review.

## Still pending for later review

### 7. Review empty EO relation tables without confirmed Bubble source

Status: pending by design.

Keep this pending for a later explicit review. The core product, chemistry, action-system, and color-label migrations are now implemented, but these tables should not be populated or removed automatically.

Current empty tables:

- `essential_oil_aroma_notes`
- `essential_oil_chakra_association`
- `essential_oil_child_safety`
- `essential_oil_pet_safety`
- `essential_oil_energetic_emotional_properties`

Current rule:

- Do not delete or populate these tables yet.
- Do not block the main migration on them.
- Reevaluate only when safety, chakra, aroma-note, pet/child, or emotional semantics become an explicit migration scope.

### 8. Migrate Bubble `receitas-queixa-foco`

Status: implemented on 2026-04-26; all application-method gaps were closed manually from the full recipe context.

This Bubble type was present in `types.html` as `receitas-queixa-foco`, but it was not included in the first EO/chemistry relational migration plan and was not covered by the legacy n8n flow.

Current Bubble live findings:

- Bubble `receitas-queixa-foco`: 2254 rows.
- rows with `queixa-foco`: 2250.
- `queixa-foco` refs mapped to Supabase `eo_health_concerns`: 2250/2250.
- rows with `oleos-singulares`: 1903.
- `oleos-singulares` refs: 6217.
- `oleos-singulares` refs mapped to Supabase `essential_oils`: 6217/6217.
- rows with `receita-completa-gpt4`: 2253.
- rows reviewed by Daiane: 657.

Important distinction:

- Supabase has user recipe tables such as `user_saved_recipes`, `user_recipe_metadata`, `user_recipe_formulation`, `user_recipe_instructions`, and `user_saved_recipe_oils`.
- Those tables currently have 41 recipe rows and do not appear to be a migration of Bubble `receitas-queixa-foco`.
- Bubble `receitas-queixa-foco` appears to be curated/generated recipe content linked to health concerns and oils, not user-saved recipe data.

Implemented model:

- `eo_health_concern_recipes`
- `eo_health_concern_recipe_oils`
- `eo_health_concern_recipe_instructions`
- `eo_health_concern_recipe_application_methods`

Implementation result:

- `eo_health_concern_recipes`: 2254 rows.
- recipes with `health_concern_id`: 2250.
- recipes without `health_concern_id`: 4.
- `eo_health_concern_recipe_oils`: 6217 rows.
- `eo_health_concern_recipe_instructions`: 5428 rows.
- `eo_health_concern_recipe_application_methods`: 2742 rows.

Application method parse result:

- `mapped`: 2742 rows / 2254 recipes.
- `empty`: 0 rows / 0 recipes.
- `ambiguous`: 0 rows / 0 recipes.
- `unmapped`: 0 rows / 0 recipes.

Mapped application methods:

- `Aromatic`: 741 recipe-method rows.
- `Topical`: 1805 recipe-method rows.
- `Internal`: 97 recipe-method rows.

Parsing rule:

- map only explicit method terms such as `Aromático`, `Inalação`, `Difusão`, `Tópico`, `Topicamente`, `Massagem`, `Roll-on`, `Compressa`, `Ingestão`, `Via oral`, and `Cápsula`.
- do not map macro/context-only words such as `Aromaterapia`, `Ambiente`, `Pele`, `Local`, `Banho`, `Boca`, `Garganta`, or `Sublingual`.
- no remaining recipe application-method gaps.

Bubble fetch optimization:

- `scripts/migrate-health-concern-recipes.mjs` caches Bubble API responses under `.bubble-cache/`.
- reruns use the local cache by default.
- set `BUBBLE_FORCE_FETCH=1` only when a fresh Bubble read is required.

## Recommended next steps

1. Leave empty EO relation tables pending for later review.
