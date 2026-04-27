# Pregnancy label cheat sheet

Generated: 2026-04-26 UTC
Updated: 2026-04-27 UTC

This note validates the old Bubble pregnancy filter tags against the migrated Postgres data.

## Source files checked

- `pregnancy-labels/1-ao-3-trimestre.html`
- `pregnancy-labels/2-ao-3-trimestre.html`
- `pregnancy-labels/prescricao-medica.html`
- `pregnancy-labels/clean-pregnancy-safety-migration.sql`
- `eo_pregnancy_nursing_statuses`
- `essential_oil_pregnancy_nursing_safety`

## Implemented Postgres model

The clean app-facing model is now implemented in Postgres.

The legacy Bubble tag remains in `eo_pregnancy_nursing_statuses.status_description`. Clean app names live in `code` and `name`.

| Legacy Bubble tag | Clean code | Clean name |
| --- | --- | --- |
| `pregnancy-safe-3months` | `pregnancy_safe_all_trimesters` | Safe all trimesters |
| `pregnancy-safe-100` | `pregnancy_safe_after_first_trimester_raw` | Safe after first trimester raw tag |
| `pregnancy-safe-50` | `pregnancy_professional_guidance` | Professional guidance |
| `pregnancy-hora-do-parto` | `pregnancy_labor_delivery` | Labor/delivery |
| `pregnancy-lactante` | `lactation_guidance` | Lactation guidance |

Use these views for app code:

- `v_oil_pregnancy_safety_tags`: one row per oil per clean pregnancy tag.
- `v_oil_pregnancy_safety_profile`: one row per oil with final category and additive flags.

Final profile categories:

| Category code | Count | Meaning |
| --- | ---: | --- |
| `pregnancy_safe_all_trimesters` | 16 | Has `pregnancy-safe-3months`. |
| `pregnancy_safe_after_first_trimester` | 21 | Has `pregnancy-safe-100` and does not have `pregnancy-safe-3months`. This matches the Bubble `preg-100` pipeline step. |
| `pregnancy_professional_guidance` | 11 | Has `pregnancy-safe-50` and no stronger trimester-safe category. |
| `pregnancy_no_guidance` | 72 | No trimester/professional pregnancy guidance. Labor-only oils remain here with a labor flag. |

Additive flags:

| Flag | Count | Meaning |
| --- | ---: | --- |
| `has_professional_guidance` | 12 | Includes Helichrysum, which is also safe after first trimester. |
| `has_labor_delivery_guidance` | 8 | Labor/delivery context. |
| `has_lactation_guidance` | 0 | No oils currently use the legacy lactation tag. |

## Important interpretation

There are two separate Bubble behaviors to keep distinct:

1. Click workflows update the selected filter chips in `Shape A's filtros`.
2. The filter pipeline updates `Shape A's oilList` by intersecting the current oil list with searches for each active chip.

For example:

- `1-ao-3-trimestre.html` does: add `pregnancy-safe-3months`, remove `pregnancy-safe-100`, remove `pregnancy-safe-50`.
- `2-ao-3-trimestre.html` does: add `pregnancy-safe-100`, remove `pregnancy-safe-50`, remove `pregnancy-safe-3months`.
- `prescricao-medica.html` does: add `pregnancy-safe-50`, remove `pregnancy-safe-100`, remove `pregnancy-safe-3months`.

Those `minus item` steps clear competing filter chips from `Shape A's filtros`. They are not directly subtracting oils from the result set. However, the later sequential filter pipeline can still exclude oils through search constraints and intersections.

Operationally:

1. The clicked button leaves one pregnancy filter tag active on `Shape A`.
2. The filter pipeline runs in step order.
3. Removing another pregnancy tag from `Shape A` only prevents that other tag from staying selected in the UI.
4. Each active filter step sets `oilList = Shape A's oilList intersect Search for oil_specifics`.
5. Therefore, if multiple pregnancy chips are active at the same time, the steps combine as intersections, not as a replacement.

## Validated live tag counts

Current migrated status rows:

| Tag | Oil count |
| --- | ---: |
| `pregnancy-safe-100` | 37 |
| `pregnancy-safe-3months` | 16 |
| `pregnancy-safe-50` | 12 |
| `pregnancy-hora-do-parto` | 8 |
| `pregnancy-lactante` | 0 |

Important overlap:

- Every oil with `pregnancy-safe-3months` also has `pregnancy-safe-100`.
- Therefore, do not model the click workflow's `minus item` actions as SQL anti-joins or `not exists` exclusions.
- The `pregnancy-safe-100` filter pipeline step itself does exclude `pregnancy-safe-3months`.
- The practical meaning of `pregnancy-safe-3months` is the specific "safe from the first trimester" marker. It can overlap with `pregnancy-safe-100`.

## Bubble click behavior

Use this table when recreating the original selected-chip behavior.

| Bubble button / app filter | Active tag after click | Other pregnancy chips removed |
| --- | --- | --- |
| 1st to 3rd trimester / whole pregnancy | `pregnancy-safe-3months` | `pregnancy-safe-100`, `pregnancy-safe-50` |
| 2nd to 3rd trimester | `pregnancy-safe-100` | `pregnancy-safe-50`, `pregnancy-safe-3months` |
| Medical prescription / professional guidance | `pregnancy-safe-50` | `pregnancy-safe-100`, `pregnancy-safe-3months` |

The add/remove expressions make these pregnancy chips mutually exclusive in normal UI use. They do not make the underlying oil tags mutually exclusive.

## Bubble filter pipeline behavior

Use this table when recreating the actual oil filtering pipeline shown in the workflow screenshots.

| Pipeline step | Only when | Search constraint | Effect on `oilList` | Current count when used alone |
| --- | --- | --- | --- | ---: |
| Filter by `preg-100` | `Shape A's filtros contains pregnancy-safe-100` | `filters-category contains pregnancy-safe-100` and `filters-category doesn't contain pregnancy-safe-3months` | Intersects current `oilList` with oils safe from 2nd-to-3rd trimester only | 21 |
| Filter by `preg-50` | `Shape A's filtros contains pregnancy-safe-50` | `filters-category contains pregnancy-safe-50` | Intersects current `oilList` with oils tagged professional guidance | 12 |
| Filter by `preg-3-months` | `Shape A's filtros contains pregnancy-safe-3months` | `filters-category contains pregnancy-safe-3months` | Intersects current `oilList` with oils safe from 1st trimester onward | 16 |

Important: the `preg-100` pipeline step is not simply "has `pregnancy-safe-100`". It explicitly excludes `pregnancy-safe-3months`.

This explains why duplicated tags exist:

- `pregnancy-safe-3months` oils also carry `pregnancy-safe-100` because they are pregnancy-safe in the broader sense.
- The `preg-100` filter step excludes `pregnancy-safe-3months` so the "2nd to 3rd trimester" result does not show the first-trimester-safe oils.
- The duplicate tags preserve the broader semantic relationship while the filter step creates the exclusive UI category.

If multiple pregnancy chips are active at the same time, the pipeline intersects them in step order. Examples:

| Active chips | Pipeline result |
| --- | --- |
| `pregnancy-safe-100` only | oils with `pregnancy-safe-100` and not `pregnancy-safe-3months` |
| `pregnancy-safe-50` only | oils with `pregnancy-safe-50` |
| `pregnancy-safe-3months` only | oils with `pregnancy-safe-3months` |
| `pregnancy-safe-100` + `pregnancy-safe-3months` | empty, because step `preg-100` first removes `pregnancy-safe-3months` oils, then step `preg-3-months` intersects with them |
| `pregnancy-safe-100` + `pregnancy-safe-50` | only oils matching both the exclusive `preg-100` step and `pregnancy-safe-50`; currently this isolates Helichrysum |
| `pregnancy-safe-50` + `pregnancy-safe-3months` | empty with current data |

## App categories and additional flags

Use `v_oil_pregnancy_safety_profile` for cleaner labels in app code, curriculum, cards, and analytics. Trimester safety categories are made exclusive there; labor/delivery is an additional flag because it overlaps other pregnancy tags.

| App label | Postgres rule | Count | Meaning |
| --- | --- | ---: | --- |
| Safe during the whole pregnancy / 1st to 3rd trimester | has `pregnancy-safe-3months` | 16 | Safe starting in the first trimester and continuing through pregnancy. These oils also carry `pregnancy-safe-100`, so do not subtract `pregnancy-safe-100`. |
| Safe from 2nd to 3rd trimester | has `pregnancy-safe-100` and does not have `pregnancy-safe-3months` | 21 | Matches the Bubble `preg-100` pipeline step. Helichrysum also has the professional-guidance flag. |
| Only with doctor prescription / professional guidance | has `pregnancy-safe-50` and does not have `pregnancy-safe-100` and does not have `pregnancy-safe-3months` | 11 | Caution category. Helichrysum has both `pregnancy-safe-50` and `pregnancy-safe-100`, so it is categorized as safe after first trimester with a professional-guidance flag. |
| Labor / delivery flag | has `pregnancy-hora-do-parto` | 8 | Separate special-use tag. It overlaps other pregnancy tags and should not be merged into trimester safety. |
| Lactation | has `pregnancy-lactante` | 0 | No migrated oils currently use this tag. Do not build a user-facing query around it yet. |
| No pregnancy guidance | no trimester/professional pregnancy category | 72 | Treat as "no trimester pregnancy guidance", not as safe. Labor-only oils remain here with a labor flag. |

## Oil lists by validated category

### Safe during the whole pregnancy / 1st to 3rd trimester

Bubble filter rule:

```sql
has pregnancy-safe-3months
```

Current oils:

- Basil
- Bergamot
- Black Spruce
- Cardamom
- Copaiba
- Fractionated Coconut Oil
- Ginger
- Lavender
- Lemon
- Lime
- Patchouli
- Petitgrain
- Roman Chamomile
- Tea Tree
- Wild Orange
- Ylang Ylang

### Safe from 2nd to 3rd trimester

Bubble pipeline rule:

```sql
has pregnancy-safe-100
and does not have pregnancy-safe-3months
```

Current oils when using the Bubble pipeline:

- Breu Branco
- Cananga
- Cedarwood
- Cypress
- Frankincense
- Geranium
- Grapefruit
- Green Mandarin
- Helichrysum
- Juniper Berry
- Laurel Leaf
- Lemon Eucalyptus
- Neroli
- Ravintsara
- Rose
- Sandalwood
- Siberian Fir
- Tangerine
- Tulsi (Holy Basil)
- Vetiver
- Yuzu

### Only with doctor prescription / professional guidance

Bubble filter rule:

```sql
has pregnancy-safe-50
```

Current oils when using Bubble-equivalent filtering:

- Blue Tansy
- Cassia
- Celery Seed
- Cinnamon Bark
- Clary Sage
- Clove
- Helichrysum
- Oregano
- Peppermint
- Rosemary
- Spearmint
- Wintergreen

Clean profile category rule:

```sql
has pregnancy-safe-50
and does not have pregnancy-safe-100
and does not have pregnancy-safe-3months
```

Current oils in the clean profile category:

- Blue Tansy
- Cassia
- Celery Seed
- Cinnamon Bark
- Clary Sage
- Clove
- Oregano
- Peppermint
- Rosemary
- Spearmint
- Wintergreen

Important overlap:

- Helichrysum has both `pregnancy-safe-50` and `pregnancy-safe-100`. The clean profile categorizes it as `pregnancy_safe_after_first_trimester` and also exposes `has_professional_guidance = true`.

### Labor / delivery flag

Rule:

```sql
has pregnancy-hora-do-parto
```

Current oils:

- Clary Sage
- Geranium
- Jasmine
- Lavender
- Marjoram
- Palmarosa
- Rose
- Ylang Ylang

## SQL reference for the Bubble filter pipeline

Use these shapes when reproducing the pregnancy filter steps.

For `pregnancy-safe-3months` and `pregnancy-safe-50`, the step is a simple tag match:

```sql
select
  o.id,
  o.name_english
from essential_oils o
join essential_oil_pregnancy_nursing_safety eps
  on eps.essential_oil_id = o.id
join eo_pregnancy_nursing_statuses pns
  on pns.id = eps.pregnancy_nursing_status_id
where pns.status_description = :active_pregnancy_tag
order by o.name_english;
```

Examples:

- `:active_pregnancy_tag = 'pregnancy-safe-3months'`
- `:active_pregnancy_tag = 'pregnancy-safe-50'`
- `:active_pregnancy_tag = 'pregnancy-hora-do-parto'`

For `pregnancy-safe-100`, match the Bubble step's explicit exclusion:

```sql
select
  o.id,
  o.name_english
from essential_oils o
where exists (
  select 1
  from essential_oil_pregnancy_nursing_safety eps
  join eo_pregnancy_nursing_statuses pns
    on pns.id = eps.pregnancy_nursing_status_id
  where eps.essential_oil_id = o.id
    and pns.status_description = 'pregnancy-safe-100'
)
and not exists (
  select 1
  from essential_oil_pregnancy_nursing_safety eps
  join eo_pregnancy_nursing_statuses pns
    on pns.id = eps.pregnancy_nursing_status_id
  where eps.essential_oil_id = o.id
    and pns.status_description = 'pregnancy-safe-3months'
)
order by o.name_english;
```

## SQL reference for clean app-facing categories

Use the profile view directly:

```sql
select
  oil_name_english,
  pregnancy_safety_category_code,
  pregnancy_safety_category_name,
  has_professional_guidance,
  has_labor_delivery_guidance,
  has_lactation_guidance,
  legacy_pregnancy_tags
from v_oil_pregnancy_safety_profile
order by pregnancy_safety_category_code, oil_name_english;
```

The view applies these rules:

1. `pregnancy-safe-3months` -> `pregnancy_safe_all_trimesters`.
2. `pregnancy-safe-100` without `pregnancy-safe-3months` -> `pregnancy_safe_after_first_trimester`.
3. `pregnancy-safe-50` without a stronger trimester category -> `pregnancy_professional_guidance`.
4. `pregnancy-hora-do-parto` -> `has_labor_delivery_guidance`.
5. `pregnancy-lactante` -> `has_lactation_guidance`.
