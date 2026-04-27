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

function jsonRowsToCsv(rows) {
  return rows
    .map((row) => {
      const json = JSON.stringify(row);
      return `"${json.replace(/"/g, '""')}"`;
    })
    .join('\n') + '\n';
}

const [functionalGroups, carbonStructures, compounds, properties] = await Promise.all([
  fetchBubbleType('quimica_grupo_funcional'),
  fetchBubbleType('quimica_estrutura_carbono'),
  fetchBubbleType('composto_quimico'),
  fetchBubbleType('propriedade_quimica'),
]);

const tempDir = mkdtempSync(join(tmpdir(), 'bubble-chemistry-taxonomy-'));
const files = {
  functionalGroups: join(tempDir, 'quimica_grupo_funcional.csv'),
  carbonStructures: join(tempDir, 'quimica_estrutura_carbono.csv'),
  compounds: join(tempDir, 'composto_quimico.csv'),
  properties: join(tempDir, 'propriedade_quimica.csv'),
};

writeFileSync(files.functionalGroups, jsonRowsToCsv(functionalGroups));
writeFileSync(files.carbonStructures, jsonRowsToCsv(carbonStructures));
writeFileSync(files.compounds, jsonRowsToCsv(compounds));
writeFileSync(files.properties, jsonRowsToCsv(properties));

const fgFile = files.functionalGroups.replace(/'/g, "''");
const csFile = files.carbonStructures.replace(/'/g, "''");
const compoundsFile = files.compounds.replace(/'/g, "''");
const propertiesFile = files.properties.replace(/'/g, "''");

const sql = String.raw`
\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS public.chemical_functional_groups (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bubble_uid text UNIQUE,
  name_english text NOT NULL UNIQUE,
  name_portuguese text,
  bubble_created_at timestamptz,
  bubble_modified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chemical_carbon_structures (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bubble_uid text UNIQUE,
  name_english text NOT NULL UNIQUE,
  name_portuguese text,
  bubble_created_at timestamptz,
  bubble_modified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chemical_compound_functional_groups (
  chemical_compound_id uuid NOT NULL REFERENCES public.chemical_compounds(id) ON UPDATE CASCADE ON DELETE CASCADE,
  functional_group_id uuid NOT NULL REFERENCES public.chemical_functional_groups(id) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chemical_compound_id, functional_group_id)
);

CREATE INDEX IF NOT EXISTS chemical_compound_functional_groups_group_idx
  ON public.chemical_compound_functional_groups(functional_group_id);

CREATE TABLE IF NOT EXISTS public.chemical_compound_carbon_structures (
  chemical_compound_id uuid NOT NULL REFERENCES public.chemical_compounds(id) ON UPDATE CASCADE ON DELETE CASCADE,
  carbon_structure_id uuid NOT NULL REFERENCES public.chemical_carbon_structures(id) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chemical_compound_id, carbon_structure_id)
);

CREATE INDEX IF NOT EXISTS chemical_compound_carbon_structures_structure_idx
  ON public.chemical_compound_carbon_structures(carbon_structure_id);

CREATE TABLE IF NOT EXISTS public.chemical_functional_group_carbon_structures (
  functional_group_id uuid NOT NULL REFERENCES public.chemical_functional_groups(id) ON UPDATE CASCADE ON DELETE CASCADE,
  carbon_structure_id uuid NOT NULL REFERENCES public.chemical_carbon_structures(id) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (functional_group_id, carbon_structure_id)
);

CREATE INDEX IF NOT EXISTS chemical_functional_group_carbon_structures_structure_idx
  ON public.chemical_functional_group_carbon_structures(carbon_structure_id);

CREATE TABLE IF NOT EXISTS public.eo_therapeutic_property_functional_groups (
  property_id uuid NOT NULL REFERENCES public.eo_therapeutic_properties(id) ON UPDATE CASCADE ON DELETE CASCADE,
  functional_group_id uuid NOT NULL REFERENCES public.chemical_functional_groups(id) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, functional_group_id)
);

CREATE INDEX IF NOT EXISTS eo_therapeutic_property_functional_groups_group_idx
  ON public.eo_therapeutic_property_functional_groups(functional_group_id);

CREATE TABLE IF NOT EXISTS public.eo_therapeutic_property_carbon_structures (
  property_id uuid NOT NULL REFERENCES public.eo_therapeutic_properties(id) ON UPDATE CASCADE ON DELETE CASCADE,
  carbon_structure_id uuid NOT NULL REFERENCES public.chemical_carbon_structures(id) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, carbon_structure_id)
);

CREATE INDEX IF NOT EXISTS eo_therapeutic_property_carbon_structures_structure_idx
  ON public.eo_therapeutic_property_carbon_structures(carbon_structure_id);

CREATE TEMP TABLE tmp_functional_groups (data jsonb NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE tmp_carbon_structures (data jsonb NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE tmp_compounds (data jsonb NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE tmp_properties (data jsonb NOT NULL) ON COMMIT DROP;

\copy tmp_functional_groups(data) FROM '${fgFile}' WITH (FORMAT csv)
\copy tmp_carbon_structures(data) FROM '${csFile}' WITH (FORMAT csv)
\copy tmp_compounds(data) FROM '${compoundsFile}' WITH (FORMAT csv)
\copy tmp_properties(data) FROM '${propertiesFile}' WITH (FORMAT csv)

INSERT INTO public.chemical_functional_groups (
  bubble_uid,
  name_english,
  name_portuguese,
  bubble_created_at,
  bubble_modified_at,
  updated_at
)
SELECT
  data->>'_id',
  COALESCE(NULLIF(data->>'Nome ingles', ''), data->>'_id'),
  NULLIF(data->>'Nome portugues', ''),
  NULLIF(data->>'Created Date', '')::timestamptz,
  NULLIF(data->>'Modified Date', '')::timestamptz,
  now()
FROM tmp_functional_groups
ON CONFLICT (bubble_uid) DO UPDATE
SET name_english = EXCLUDED.name_english,
    name_portuguese = EXCLUDED.name_portuguese,
    bubble_created_at = EXCLUDED.bubble_created_at,
    bubble_modified_at = EXCLUDED.bubble_modified_at,
    updated_at = now();

INSERT INTO public.chemical_carbon_structures (
  bubble_uid,
  name_english,
  name_portuguese,
  bubble_created_at,
  bubble_modified_at,
  updated_at
)
SELECT
  data->>'_id',
  COALESCE(NULLIF(data->>'Nome ingles', ''), data->>'_id'),
  NULLIF(data->>'Nome portugues', ''),
  NULLIF(data->>'Created Date', '')::timestamptz,
  NULLIF(data->>'Modified Date', '')::timestamptz,
  now()
FROM tmp_carbon_structures
ON CONFLICT (bubble_uid) DO UPDATE
SET name_english = EXCLUDED.name_english,
    name_portuguese = EXCLUDED.name_portuguese,
    bubble_created_at = EXCLUDED.bubble_created_at,
    bubble_modified_at = EXCLUDED.bubble_modified_at,
    updated_at = now();

DELETE FROM public.chemical_compound_functional_groups;
DELETE FROM public.chemical_compound_carbon_structures;
DELETE FROM public.chemical_functional_group_carbon_structures;
DELETE FROM public.eo_therapeutic_property_functional_groups;
DELETE FROM public.eo_therapeutic_property_carbon_structures;

WITH compound_side AS (
  SELECT DISTINCT data->>'_id' AS compound_bubble_uid, fg.value AS functional_group_bubble_uid
  FROM tmp_compounds t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Grupo Funcional') = 'array' THEN t.data->'Grupo Funcional'
      WHEN t.data ? 'Grupo Funcional' AND t.data->'Grupo Funcional' <> 'null'::jsonb THEN jsonb_build_array(t.data->'Grupo Funcional')
      ELSE '[]'::jsonb
    END
  ) fg(value)
),
group_side AS (
  SELECT DISTINCT compound.value AS compound_bubble_uid, data->>'_id' AS functional_group_bubble_uid
  FROM tmp_functional_groups t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Composto Químico') = 'array' THEN t.data->'Composto Químico'
      ELSE '[]'::jsonb
    END
  ) compound(value)
),
mapped AS (
  SELECT cc.id AS chemical_compound_id, fg.id AS functional_group_id
  FROM (SELECT * FROM compound_side UNION SELECT * FROM group_side) pairs
  JOIN public.chemical_compounds cc ON cc.bubble_uid = pairs.compound_bubble_uid
  JOIN public.chemical_functional_groups fg ON fg.bubble_uid = pairs.functional_group_bubble_uid
)
INSERT INTO public.chemical_compound_functional_groups (chemical_compound_id, functional_group_id)
SELECT chemical_compound_id, functional_group_id FROM mapped
ON CONFLICT DO NOTHING;

WITH compound_side AS (
  SELECT DISTINCT data->>'_id' AS compound_bubble_uid, cs.value AS carbon_structure_bubble_uid
  FROM tmp_compounds t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Estrutura Carbono') = 'array' THEN t.data->'Estrutura Carbono'
      WHEN t.data ? 'Estrutura Carbono' AND t.data->'Estrutura Carbono' <> 'null'::jsonb THEN jsonb_build_array(t.data->'Estrutura Carbono')
      ELSE '[]'::jsonb
    END
  ) cs(value)
),
structure_side AS (
  SELECT DISTINCT compound.value AS compound_bubble_uid, data->>'_id' AS carbon_structure_bubble_uid
  FROM tmp_carbon_structures t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Composto Químico') = 'array' THEN t.data->'Composto Químico'
      ELSE '[]'::jsonb
    END
  ) compound(value)
),
mapped AS (
  SELECT cc.id AS chemical_compound_id, cs.id AS carbon_structure_id
  FROM (SELECT * FROM compound_side UNION SELECT * FROM structure_side) pairs
  JOIN public.chemical_compounds cc ON cc.bubble_uid = pairs.compound_bubble_uid
  JOIN public.chemical_carbon_structures cs ON cs.bubble_uid = pairs.carbon_structure_bubble_uid
)
INSERT INTO public.chemical_compound_carbon_structures (chemical_compound_id, carbon_structure_id)
SELECT chemical_compound_id, carbon_structure_id FROM mapped
ON CONFLICT DO NOTHING;

WITH group_side AS (
  SELECT DISTINCT data->>'_id' AS functional_group_bubble_uid, cs.value AS carbon_structure_bubble_uid
  FROM tmp_functional_groups t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Estrutura de Carbono') = 'array' THEN t.data->'Estrutura de Carbono'
      ELSE '[]'::jsonb
    END
  ) cs(value)
),
structure_side AS (
  SELECT DISTINCT fg.value AS functional_group_bubble_uid, data->>'_id' AS carbon_structure_bubble_uid
  FROM tmp_carbon_structures t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Grupo Funcional Químico') = 'array' THEN t.data->'Grupo Funcional Químico'
      ELSE '[]'::jsonb
    END
  ) fg(value)
),
mapped AS (
  SELECT fg.id AS functional_group_id, cs.id AS carbon_structure_id
  FROM (SELECT * FROM group_side UNION SELECT * FROM structure_side) pairs
  JOIN public.chemical_functional_groups fg ON fg.bubble_uid = pairs.functional_group_bubble_uid
  JOIN public.chemical_carbon_structures cs ON cs.bubble_uid = pairs.carbon_structure_bubble_uid
)
INSERT INTO public.chemical_functional_group_carbon_structures (functional_group_id, carbon_structure_id)
SELECT functional_group_id, carbon_structure_id FROM mapped
ON CONFLICT DO NOTHING;

WITH property_side AS (
  SELECT DISTINCT data->>'_id' AS property_bubble_uid, fg.value AS functional_group_bubble_uid
  FROM tmp_properties t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Grupo Funcional') = 'array' THEN t.data->'Grupo Funcional'
      WHEN t.data ? 'Grupo Funcional' AND t.data->'Grupo Funcional' <> 'null'::jsonb THEN jsonb_build_array(t.data->'Grupo Funcional')
      ELSE '[]'::jsonb
    END
  ) fg(value)
),
group_side AS (
  SELECT DISTINCT prop.value AS property_bubble_uid, data->>'_id' AS functional_group_bubble_uid
  FROM tmp_functional_groups t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Propriedades') = 'array' THEN t.data->'Propriedades'
      ELSE '[]'::jsonb
    END
  ) prop(value)
),
mapped AS (
  SELECT tp.id AS property_id, fg.id AS functional_group_id
  FROM (SELECT * FROM property_side UNION SELECT * FROM group_side) pairs
  JOIN public.eo_therapeutic_properties tp ON tp.bubble_uid = pairs.property_bubble_uid
  JOIN public.chemical_functional_groups fg ON fg.bubble_uid = pairs.functional_group_bubble_uid
)
INSERT INTO public.eo_therapeutic_property_functional_groups (property_id, functional_group_id)
SELECT property_id, functional_group_id FROM mapped
ON CONFLICT DO NOTHING;

WITH property_side AS (
  SELECT DISTINCT data->>'_id' AS property_bubble_uid, cs.value AS carbon_structure_bubble_uid
  FROM tmp_properties t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Estrutura Carbono') = 'array' THEN t.data->'Estrutura Carbono'
      WHEN t.data ? 'Estrutura Carbono' AND t.data->'Estrutura Carbono' <> 'null'::jsonb THEN jsonb_build_array(t.data->'Estrutura Carbono')
      ELSE '[]'::jsonb
    END
  ) cs(value)
),
structure_side AS (
  SELECT DISTINCT prop.value AS property_bubble_uid, data->>'_id' AS carbon_structure_bubble_uid
  FROM tmp_carbon_structures t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Propriedades Quimicas') = 'array' THEN t.data->'Propriedades Quimicas'
      ELSE '[]'::jsonb
    END
  ) prop(value)
),
mapped AS (
  SELECT tp.id AS property_id, cs.id AS carbon_structure_id
  FROM (SELECT * FROM property_side UNION SELECT * FROM structure_side) pairs
  JOIN public.eo_therapeutic_properties tp ON tp.bubble_uid = pairs.property_bubble_uid
  JOIN public.chemical_carbon_structures cs ON cs.bubble_uid = pairs.carbon_structure_bubble_uid
)
INSERT INTO public.eo_therapeutic_property_carbon_structures (property_id, carbon_structure_id)
SELECT property_id, carbon_structure_id FROM mapped
ON CONFLICT DO NOTHING;

ALTER TABLE public.chemical_functional_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chemical_carbon_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chemical_compound_functional_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chemical_compound_carbon_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chemical_functional_group_carbon_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eo_therapeutic_property_functional_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eo_therapeutic_property_carbon_structures ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'chemical_functional_groups',
    'chemical_carbon_structures',
    'chemical_compound_functional_groups',
    'chemical_compound_carbon_structures',
    'chemical_functional_group_carbon_structures',
    'eo_therapeutic_property_functional_groups',
    'eo_therapeutic_property_carbon_structures'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS anon_can_view ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS admin_can_manage ON public.%I', table_name);
    EXECUTE format('CREATE POLICY anon_can_view ON public.%I FOR SELECT USING (true)', table_name);
    EXECUTE format(
      'CREATE POLICY admin_can_manage ON public.%I FOR ALL USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = %L)) WITH CHECK (auth.uid() IN (SELECT id FROM public.profiles WHERE role = %L))',
      table_name,
      'admin',
      'admin'
    );
    EXECUTE format('GRANT ALL ON TABLE public.%I TO anon, authenticated, service_role', table_name);
  END LOOP;
END
$$;

SELECT 'chemical_functional_groups' AS table_name, count(*) AS rows FROM public.chemical_functional_groups
UNION ALL
SELECT 'chemical_carbon_structures', count(*) FROM public.chemical_carbon_structures
UNION ALL
SELECT 'chemical_compound_functional_groups', count(*) FROM public.chemical_compound_functional_groups
UNION ALL
SELECT 'chemical_compound_carbon_structures', count(*) FROM public.chemical_compound_carbon_structures
UNION ALL
SELECT 'chemical_functional_group_carbon_structures', count(*) FROM public.chemical_functional_group_carbon_structures
UNION ALL
SELECT 'eo_therapeutic_property_functional_groups', count(*) FROM public.eo_therapeutic_property_functional_groups
UNION ALL
SELECT 'eo_therapeutic_property_carbon_structures', count(*) FROM public.eo_therapeutic_property_carbon_structures;

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
