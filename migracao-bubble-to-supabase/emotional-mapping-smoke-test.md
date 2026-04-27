# Emotional mapping smoke test

Generated: 2026-04-26 UTC

## Goal

Dry-run a relational mapping for emotional data that was extracted outside Bubble and currently lives in Supabase as semi-structured text/metadata.

No database writes were performed.

## Source table

Supabase table:

```text
essential_oil_emotional
```

Current rows:

```text
295
```

Useful metadata fields found:

- `body_part_or_symptom`
- `emotional_root`
- `underlying_emotions`
- `reflective_questions`
- `source`
- `blobType`
- `loc`
- `namespace`

## Extraction result

From `essential_oil_emotional.metadata`:

| Metric | Count |
| --- | ---: |
| rows with `body_part_or_symptom` | 225 |
| rows with `emotional_root` | 225 |
| rows with `underlying_emotions` | 225 |
| raw emotion mentions | 826 |
| distinct normalized emotions | 200 |
| distinct emotional roots | 219 |
| distinct body/symptom labels | 221 |

## Top extracted emotions

| Emotion | Mentions | Example contexts |
| --- | ---: | --- |
| Fear | 35 | Laryngitis, Menopause, Narcolepsy |
| Bitterness | 31 | Laryngitis, Jaw, Nasal Congestion |
| Anger | 27 | Jaw, Pancreas, Kidney Stones |
| Helplessness | 23 | Bone Marrow, Body Odor, Bones |
| Anxiety | 20 | Jaw, Nervousness, Shoulders |
| Insecurity | 20 | Bone Marrow, Menopause, Narcolepsy |
| Rejection | 18 | Left Side of the Body, Nose, Ears |
| Imprisonment | 18 | Skin, Neck, Hips |
| Indecision | 17 | Nose, Skeletal System, Hips |
| Sadness | 17 | Nose, Ears, Kidney Stones |

## Match against existing Supabase entities

The smoke test normalized `body_part_or_symptom` and attempted exact normalized matches against:

- `eo_health_concerns`
- existing `eo_body_part`

Important: `eo_body_part` is an existing Supabase table from the earlier schema. In the approved target model, body parts should be migrated into `eo_action_systems` with `action_type = 'body_part'`. The match against `eo_body_part` below is only a current-state coverage check, not a final modeling recommendation.

Results:

| Target | Exact normalized matches |
| --- | ---: |
| `eo_health_concerns` | 46 |
| existing `eo_body_part` | 24 |
| unmatched | 155 |

Example health-concern matches:

- `Laryngitis` -> `eo_health_concerns.Laryngitis`
- `Menopause (difficulties)` -> `eo_health_concerns.Menopause`
- `Narcolepsy` -> `eo_health_concerns.Narcolepsy`
- `Body Odor` -> `eo_health_concerns.Body Odor`
- `Athlete's Foot` -> `eo_health_concerns.Athlete's Foot`

Example current body-part matches:

- `Nose` -> `eo_body_part.Nose`
- `Buttocks` -> `eo_body_part.Buttocks`
- `Eyes` -> `eo_body_part.Eyes`
- `Calf` -> `eo_body_part.Calf`
- `Skin` -> `eo_body_part.Skin`

In the target model these should resolve to:

```text
eo_action_systems.action_type = 'body_part'
```

Example unmatched labels:

- `Left Side of the Body`
- `Jaw`
- `Bone Marrow`
- `Nearsightedness (See Eyes)`
- `Nasal Congestion (See Congestion)`
- `Nerves`
- `Nervousness`
- `Shoulders`
- `Tense Shoulders`
- `Skeletal System`

The unmatched set is expected because many labels are broader concepts, aliases, symptoms, body systems, or "See ..." references rather than direct table names.

## Proposed relational model

### Core emotion vocabulary

```text
emotions
- id
- name
- normalized_name
- created_at
```

### Emotional root concepts

```text
emotional_roots
- id
- description
- normalized_description
- created_at
```

### Source records

Keep `essential_oil_emotional` as the raw/source table.

Add relational bridges derived from it:

```text
emotional_record_emotions
- emotional_record_id
- emotion_id
```

```text
emotional_record_roots
- emotional_record_id
- emotional_root_id
```

### Link emotional records to existing domain entities

Because `body_part_or_symptom` can refer to health concerns, body parts, symptoms, or broader systems, use explicit nullable links rather than forcing one target type.

```text
emotional_record_health_concerns
- emotional_record_id
- health_concern_id
- match_method
```

```text
emotional_record_action_systems
- emotional_record_id
- action_system_id
- match_method
```

No separate `emotional_record_body_parts` table should be created. Body parts belong in `eo_action_systems` with:

```text
action_type = 'body_part'
```

This avoids duplicate conceptual models.

## Body part unification decision

Decision: migrate the concept currently stored in `eo_body_part` into `eo_action_systems`.

Current Supabase state:

- `eo_body_part` exists and has 57 rows.
- `essential_oil_how_to_use_body_part` already links `eo_how_to_use` to `eo_body_part`.

Target model:

```text
eo_action_systems
- id
- bubble_uid
- name
- name_portuguese
- action_type
- created_at
- updated_at
```

Where body parts are represented as:

```text
action_type = 'body_part'
```

Compatibility strategy:

1. Insert current `eo_body_part` rows into `eo_action_systems` with `action_type = 'body_part'`.
2. Create a bridge from old body-part IDs to new action-system IDs, or preserve the old UUIDs when possible.
3. Migrate `essential_oil_how_to_use_body_part` to an action-system equivalent, for example:

```text
essential_oil_how_to_use_action_systems
- how_to_use_id
- action_system_id
- created_at
```

4. Keep a compatibility view for old consumers that still expect `eo_body_part`.

Example compatibility view:

```sql
CREATE VIEW v_eo_body_part AS
SELECT
  id,
  created_at,
  name AS name_english,
  NULL::text AS name_portuguese,
  bubble_uid
FROM eo_action_systems
WHERE action_type = 'body_part';
```

If Portuguese names from `eo_body_part.name_portuguese` must be preserved, add `name_portuguese` to `eo_action_systems` or use a localized-name table before replacing the table with a view.

## Smoke-test conclusion

This data can be relationalized.

The strongest immediate value is to normalize:

1. distinct emotions from `metadata.underlying_emotions`;
2. emotional roots from `metadata.emotional_root`;
3. links from emotional records to `eo_health_concerns` and `eo_action_systems` where exact normalized matches are available;
4. a manual review queue for unmatched `body_part_or_symptom` labels.

Recommended next step:

Create a review CSV/markdown table for the 155 unmatched labels and classify each into one of:

- existing `eo_health_concerns`
- `eo_action_systems` with `action_type = 'body_part'`
- `eo_action_systems` with another `action_type`
- new alias
- ignore
