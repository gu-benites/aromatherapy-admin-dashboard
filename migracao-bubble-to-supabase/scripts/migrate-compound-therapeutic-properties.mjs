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

const [compounds, properties] = await Promise.all([
  fetchBubbleType('composto_quimico'),
  fetchBubbleType('propriedade_quimica'),
]);

const tempDir = mkdtempSync(join(tmpdir(), 'bubble-compound-properties-'));
const compoundsFile = join(tempDir, 'composto_quimico.ndjson');
const propertiesFile = join(tempDir, 'propriedade_quimica.ndjson');
const compoundsFileForPsql = compoundsFile.replace(/'/g, "''");
const propertiesFileForPsql = propertiesFile.replace(/'/g, "''");

function jsonRowsToCsv(rows) {
  return rows
    .map((row) => {
      const json = JSON.stringify(row);
      return `"${json.replace(/"/g, '""')}"`;
    })
    .join('\n') + '\n';
}

writeFileSync(compoundsFile, jsonRowsToCsv(compounds));
writeFileSync(propertiesFile, jsonRowsToCsv(properties));

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

CREATE TABLE IF NOT EXISTS public.chemical_compound_therapeutic_properties (
  chemical_compound_id uuid NOT NULL REFERENCES public.chemical_compounds(id) ON UPDATE CASCADE ON DELETE CASCADE,
  therapeutic_property_id uuid NOT NULL REFERENCES public.eo_therapeutic_properties(id) ON UPDATE CASCADE ON DELETE CASCADE,
  source_type public.chemical_compound_source_type NOT NULL DEFAULT 'secondary',
  source_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chemical_compound_id, therapeutic_property_id)
);

CREATE INDEX IF NOT EXISTS chemical_compound_therapeutic_properties_property_idx
  ON public.chemical_compound_therapeutic_properties(therapeutic_property_id);

CREATE TEMP TABLE tmp_bubble_compounds (
  data jsonb NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE tmp_bubble_properties (
  data jsonb NOT NULL
) ON COMMIT DROP;

\copy tmp_bubble_compounds(data) FROM '${compoundsFileForPsql}' WITH (FORMAT csv)
\copy tmp_bubble_properties(data) FROM '${propertiesFileForPsql}' WITH (FORMAT csv)

WITH compound_side AS (
  SELECT DISTINCT
    data->>'_id' AS compound_bubble_uid,
    property.value AS property_bubble_uid,
    'composto_quimico.Propriedade Funcional'::text AS source_reference
  FROM tmp_bubble_compounds t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Propriedade Funcional') = 'array' THEN t.data->'Propriedade Funcional'
      ELSE '[]'::jsonb
    END
  ) AS property(value)
),
property_side AS (
  SELECT DISTINCT
    compound.value AS compound_bubble_uid,
    data->>'_id' AS property_bubble_uid,
    'propriedade_quimica.Composto Químico'::text AS source_reference
  FROM tmp_bubble_properties t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Composto Químico') = 'array' THEN t.data->'Composto Químico'
      ELSE '[]'::jsonb
    END
  ) AS compound(value)
),
union_pairs AS (
  SELECT compound_bubble_uid, property_bubble_uid, source_reference FROM compound_side
  UNION
  SELECT compound_bubble_uid, property_bubble_uid, source_reference FROM property_side
),
mapped_pairs AS (
  SELECT
    cc.id AS chemical_compound_id,
    tp.id AS therapeutic_property_id,
    string_agg(DISTINCT up.source_reference, '; ' ORDER BY up.source_reference) AS source_reference
  FROM union_pairs up
  JOIN public.chemical_compounds cc ON cc.bubble_uid = up.compound_bubble_uid
  JOIN public.eo_therapeutic_properties tp ON tp.bubble_uid = up.property_bubble_uid
  GROUP BY cc.id, tp.id
)
INSERT INTO public.chemical_compound_therapeutic_properties (
  chemical_compound_id,
  therapeutic_property_id,
  source_type,
  source_reference,
  updated_at
)
SELECT
  chemical_compound_id,
  therapeutic_property_id,
  'secondary'::public.chemical_compound_source_type,
  source_reference,
  now()
FROM mapped_pairs
ON CONFLICT (chemical_compound_id, therapeutic_property_id) DO UPDATE
SET source_type = EXCLUDED.source_type,
    source_reference = EXCLUDED.source_reference,
    updated_at = now();

CREATE OR REPLACE VIEW public.v_essential_oil_derived_therapeutic_properties AS
SELECT
  eocc.essential_oil_id,
  cctp.therapeutic_property_id AS property_id,
  array_agg(DISTINCT eocc.chemical_compound_id ORDER BY eocc.chemical_compound_id) AS chemical_compound_ids,
  count(DISTINCT eocc.chemical_compound_id) AS chemical_compound_count,
  bool_or(eocc.source_type = 'official_doterra') AS has_official_compound_evidence,
  array_agg(DISTINCT eocc.source_type ORDER BY eocc.source_type) AS compound_source_types
FROM public.essential_oil_chemical_compounds eocc
JOIN public.chemical_compound_therapeutic_properties cctp
  ON cctp.chemical_compound_id = eocc.chemical_compound_id
GROUP BY eocc.essential_oil_id, cctp.therapeutic_property_id;

ALTER TABLE public.chemical_compound_therapeutic_properties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_can_view ON public.chemical_compound_therapeutic_properties;
DROP POLICY IF EXISTS admin_can_manage ON public.chemical_compound_therapeutic_properties;
CREATE POLICY anon_can_view ON public.chemical_compound_therapeutic_properties FOR SELECT USING (true);
CREATE POLICY admin_can_manage ON public.chemical_compound_therapeutic_properties
  FOR ALL USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

GRANT ALL ON TABLE public.chemical_compound_therapeutic_properties TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.v_essential_oil_derived_therapeutic_properties TO anon, authenticated, service_role;

WITH compound_side AS (
  SELECT DISTINCT
    data->>'_id' AS compound_bubble_uid,
    property.value AS property_bubble_uid
  FROM tmp_bubble_compounds t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Propriedade Funcional') = 'array' THEN t.data->'Propriedade Funcional'
      ELSE '[]'::jsonb
    END
  ) AS property(value)
),
property_side AS (
  SELECT DISTINCT
    compound.value AS compound_bubble_uid,
    data->>'_id' AS property_bubble_uid
  FROM tmp_bubble_properties t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Composto Químico') = 'array' THEN t.data->'Composto Químico'
      ELSE '[]'::jsonb
    END
  ) AS compound(value)
),
union_pairs AS (
  SELECT * FROM compound_side
  UNION
  SELECT * FROM property_side
),
mapped_pairs AS (
  SELECT
    cc.id AS chemical_compound_id,
    tp.id AS therapeutic_property_id
  FROM union_pairs up
  JOIN public.chemical_compounds cc ON cc.bubble_uid = up.compound_bubble_uid
  JOIN public.eo_therapeutic_properties tp ON tp.bubble_uid = up.property_bubble_uid
),
missing_after AS (
  SELECT mp.*
  FROM mapped_pairs mp
  LEFT JOIN public.chemical_compound_therapeutic_properties cctp
    ON cctp.chemical_compound_id = mp.chemical_compound_id
   AND cctp.therapeutic_property_id = mp.therapeutic_property_id
  WHERE cctp.chemical_compound_id IS NULL
)
SELECT
  (SELECT count(*) FROM compound_side) AS compound_side_pairs,
  (SELECT count(*) FROM property_side) AS property_side_pairs,
  (SELECT count(*) FROM union_pairs) AS bubble_union_pairs,
  (SELECT count(*) FROM mapped_pairs) AS mapped_union_pairs,
  (SELECT count(*) FROM missing_after) AS missing_after_import,
  (SELECT count(*) FROM public.chemical_compound_therapeutic_properties) AS stored_pairs,
  (SELECT count(*) FROM public.v_essential_oil_derived_therapeutic_properties) AS derived_oil_property_pairs;

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
