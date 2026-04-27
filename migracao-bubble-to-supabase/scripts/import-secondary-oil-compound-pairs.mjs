import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const envText = readFileSync(new URL('../bubble/env.md', import.meta.url), 'utf8');
const databaseUrl = envText.match(/DATABASE_URL=(postgresql:\/\/\S+)/)?.[1];
const bubbleApiKey = envText.match(/^key:\s*(\S+)/m)?.[1];

if (!databaseUrl) {
  throw new Error('DATABASE_URL not found in bubble/env.md');
}

if (!bubbleApiKey) {
  throw new Error('Bubble API key not found in bubble/env.md');
}

async function fetchBubbleType(type) {
  const results = [];
  let cursor = 0;

  while (true) {
    const url = new URL(`https://rotinanatural.bubbleapps.io/api/1.1/obj/${type}`);
    url.searchParams.set('limit', '100');
    url.searchParams.set('cursor', String(cursor));

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${bubbleApiKey}` },
    });

    if (!response.ok) {
      throw new Error(`${type} fetch failed: ${response.status} ${await response.text()}`);
    }

    const payload = await response.json();
    results.push(...payload.response.results);

    if (!payload.response.remaining) {
      break;
    }

    cursor += payload.response.count;
  }

  return results;
}

const oilSpecificRows = await fetchBubbleType('oil_specific');

const tempDir = mkdtempSync(join(tmpdir(), 'bubble-oil-compounds-'));
const oilSpecificFile = join(tempDir, 'oil_specific.ndjson');
const oilSpecificFileForPsql = oilSpecificFile.replace(/'/g, "''");

writeFileSync(oilSpecificFile, oilSpecificRows.map((row) => JSON.stringify(row)).join('\n') + '\n');

const sql = String.raw`
\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  CREATE TYPE public.chemical_compound_source_type AS ENUM (
    'official_doterra',
    'secondary',
    'chromatography',
    'manual',
    'unknown'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE public.essential_oil_chemical_compounds
  ADD COLUMN IF NOT EXISTS source_type public.chemical_compound_source_type,
  ADD COLUMN IF NOT EXISTS source_reference text;

UPDATE public.essential_oil_chemical_compounds
SET source_type = 'official_doterra',
    source_reference = COALESCE(source_reference, 'Bubble composto_quimico_range')
WHERE source_type IS NULL;

ALTER TABLE public.essential_oil_chemical_compounds
  ALTER COLUMN source_type SET DEFAULT 'unknown',
  ALTER COLUMN source_type SET NOT NULL;

CREATE TEMP TABLE tmp_bubble_oil_specific (
  data jsonb NOT NULL
) ON COMMIT DROP;

\copy tmp_bubble_oil_specific(data) FROM '${oilSpecificFileForPsql}'

WITH direct_pairs AS (
  SELECT DISTINCT
    data->>'_id' AS oil_bubble_uid,
    compound.value AS compound_bubble_uid
  FROM tmp_bubble_oil_specific t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Composto Químico') = 'array' THEN t.data->'Composto Químico'
      ELSE '[]'::jsonb
    END
  ) AS compound(value)
),
mapped_pairs AS (
  SELECT
    eo.id AS essential_oil_id,
    cc.id AS chemical_compound_id
  FROM direct_pairs dp
  JOIN public.essential_oils eo ON eo.bubble_uid = dp.oil_bubble_uid
  JOIN public.chemical_compounds cc ON cc.bubble_uid = dp.compound_bubble_uid
)
INSERT INTO public.essential_oil_chemical_compounds (
  essential_oil_id,
  chemical_compound_id,
  source_type,
  source_reference
)
SELECT
  essential_oil_id,
  chemical_compound_id,
  'secondary'::public.chemical_compound_source_type AS source_type,
  'Bubble oil_specific.Composto Químico' AS source_reference
FROM mapped_pairs
ON CONFLICT (essential_oil_id, chemical_compound_id) DO UPDATE
SET source_type = CASE
      WHEN public.essential_oil_chemical_compounds.source_type = 'official_doterra'
        THEN public.essential_oil_chemical_compounds.source_type
      ELSE EXCLUDED.source_type
    END,
    source_reference = CASE
      WHEN public.essential_oil_chemical_compounds.source_type = 'official_doterra'
        THEN public.essential_oil_chemical_compounds.source_reference
      ELSE EXCLUDED.source_reference
    END;

WITH direct_pairs AS (
  SELECT DISTINCT
    data->>'_id' AS oil_bubble_uid,
    compound.value AS compound_bubble_uid
  FROM tmp_bubble_oil_specific t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Composto Químico') = 'array' THEN t.data->'Composto Químico'
      ELSE '[]'::jsonb
    END
  ) AS compound(value)
),
mapped_pairs AS (
  SELECT
    eo.id AS essential_oil_id,
    cc.id AS chemical_compound_id
  FROM direct_pairs dp
  JOIN public.essential_oils eo ON eo.bubble_uid = dp.oil_bubble_uid
  JOIN public.chemical_compounds cc ON cc.bubble_uid = dp.compound_bubble_uid
),
missing_after AS (
  SELECT mp.*
  FROM mapped_pairs mp
  LEFT JOIN public.essential_oil_chemical_compounds eocc
    ON eocc.essential_oil_id = mp.essential_oil_id
   AND eocc.chemical_compound_id = mp.chemical_compound_id
  WHERE eocc.essential_oil_id IS NULL
)
SELECT
  (SELECT count(*) FROM direct_pairs) AS bubble_direct_pairs,
  (SELECT count(*) FROM mapped_pairs) AS mapped_direct_pairs,
  (SELECT count(*) FROM missing_after) AS missing_after_import,
  (SELECT count(*) FROM public.essential_oil_chemical_compounds) AS total_supabase_pairs;

SELECT source_type, count(*) AS pairs
FROM public.essential_oil_chemical_compounds
GROUP BY source_type
ORDER BY source_type;

COMMIT;
`;

try {
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
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
