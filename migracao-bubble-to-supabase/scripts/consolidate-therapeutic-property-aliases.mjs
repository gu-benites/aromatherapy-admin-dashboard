import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const envText = readFileSync(new URL('../bubble/env.md', import.meta.url), 'utf8');
const databaseUrl = envText.match(/DATABASE_URL=(postgresql:\/\/\S+)/)?.[1];

if (!databaseUrl) {
  throw new Error('DATABASE_URL not found in bubble/env.md');
}

const sql = String.raw`
\set ON_ERROR_STOP on

BEGIN;

WITH mapping(alias_name, canonical_name) AS (
  VALUES
    ('Anticancer_Antitumoral', 'Anticancer'),
    ('Antimicrobial_Antimicrobiano', 'Antimicrobial'),
    ('Aphrodisiac_Anafrodisíaco', 'Aphrodisiac'),
    ('Detoxifying_Desintoxicante', 'Detoxifying'),
    ('Expectorant_Mucolítico', 'Expectorant')
),
ids AS (
  SELECT
    m.alias_name,
    m.canonical_name,
    a.id AS alias_id,
    c.id AS canonical_id
  FROM mapping m
  JOIN public.eo_therapeutic_properties a ON a.property_name = m.alias_name
  JOIN public.eo_therapeutic_properties c ON c.property_name = m.canonical_name
),
oil_delete AS (
  DELETE FROM public.essential_oil_therapeutic_properties e
  USING ids i
  WHERE e.property_id = i.alias_id
    AND EXISTS (
      SELECT 1
      FROM public.essential_oil_therapeutic_properties c
      WHERE c.essential_oil_id = e.essential_oil_id
        AND c.property_id = i.canonical_id
    )
  RETURNING 1
),
oil_update AS (
  UPDATE public.essential_oil_therapeutic_properties e
  SET property_id = i.canonical_id
  FROM ids i
  WHERE e.property_id = i.alias_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.essential_oil_therapeutic_properties c
      WHERE c.essential_oil_id = e.essential_oil_id
        AND c.property_id = i.canonical_id
    )
  RETURNING 1
),
compound_delete AS (
  DELETE FROM public.chemical_compound_therapeutic_properties c
  USING ids i
  WHERE c.therapeutic_property_id = i.alias_id
    AND EXISTS (
      SELECT 1
      FROM public.chemical_compound_therapeutic_properties x
      WHERE x.chemical_compound_id = c.chemical_compound_id
        AND x.therapeutic_property_id = i.canonical_id
    )
  RETURNING 1
),
compound_update AS (
  UPDATE public.chemical_compound_therapeutic_properties c
  SET therapeutic_property_id = i.canonical_id
  FROM ids i
  WHERE c.therapeutic_property_id = i.alias_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.chemical_compound_therapeutic_properties x
      WHERE x.chemical_compound_id = c.chemical_compound_id
        AND x.therapeutic_property_id = i.canonical_id
    )
  RETURNING 1
),
fg_delete AS (
  DELETE FROM public.eo_therapeutic_property_functional_groups f
  USING ids i
  WHERE f.property_id = i.alias_id
    AND EXISTS (
      SELECT 1
      FROM public.eo_therapeutic_property_functional_groups x
      WHERE x.functional_group_id = f.functional_group_id
        AND x.property_id = i.canonical_id
    )
  RETURNING 1
),
fg_update AS (
  UPDATE public.eo_therapeutic_property_functional_groups f
  SET property_id = i.canonical_id
  FROM ids i
  WHERE f.property_id = i.alias_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.eo_therapeutic_property_functional_groups x
      WHERE x.functional_group_id = f.functional_group_id
        AND x.property_id = i.canonical_id
    )
  RETURNING 1
),
cs_delete AS (
  DELETE FROM public.eo_therapeutic_property_carbon_structures s
  USING ids i
  WHERE s.property_id = i.alias_id
    AND EXISTS (
      SELECT 1
      FROM public.eo_therapeutic_property_carbon_structures x
      WHERE x.carbon_structure_id = s.carbon_structure_id
        AND x.property_id = i.canonical_id
    )
  RETURNING 1
),
cs_update AS (
  UPDATE public.eo_therapeutic_property_carbon_structures s
  SET property_id = i.canonical_id
  FROM ids i
  WHERE s.property_id = i.alias_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.eo_therapeutic_property_carbon_structures x
      WHERE x.carbon_structure_id = s.carbon_structure_id
        AND x.property_id = i.canonical_id
    )
  RETURNING 1
),
parent_delete AS (
  DELETE FROM public.eo_therapeutic_properties p
  USING ids i
  WHERE p.id = i.alias_id
    AND NOT EXISTS (SELECT 1 FROM public.essential_oil_therapeutic_properties e WHERE e.property_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM public.chemical_compound_therapeutic_properties c WHERE c.therapeutic_property_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM public.eo_therapeutic_property_functional_groups f WHERE f.property_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM public.eo_therapeutic_property_carbon_structures s WHERE s.property_id = p.id)
  RETURNING 1
)
SELECT
  (SELECT count(*) FROM oil_delete) AS oil_delete_rows,
  (SELECT count(*) FROM oil_update) AS oil_update_rows,
  (SELECT count(*) FROM compound_delete) AS compound_delete_rows,
  (SELECT count(*) FROM compound_update) AS compound_update_rows,
  (SELECT count(*) FROM fg_delete) AS fg_delete_rows,
  (SELECT count(*) FROM fg_update) AS fg_update_rows,
  (SELECT count(*) FROM cs_delete) AS cs_delete_rows,
  (SELECT count(*) FROM cs_update) AS cs_update_rows,
  (SELECT count(*) FROM parent_delete) AS parent_delete_rows;

COMMIT;

select property_name, property_name_portuguese, id
from public.eo_therapeutic_properties
where property_name in (
  'Anticancer_Antitumoral',
  'Antimicrobial_Antimicrobiano',
  'Aphrodisiac_Anafrodisíaco',
  'Detoxifying_Desintoxicante',
  'Expectorant_Mucolítico'
)
order by property_name;
`;

const result = spawnSync('psql', [databaseUrl, '-P', 'pager=off'], {
  input: sql,
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
});

if (result.status !== 0) {
  process.stderr.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

process.stdout.write(result.stdout);
