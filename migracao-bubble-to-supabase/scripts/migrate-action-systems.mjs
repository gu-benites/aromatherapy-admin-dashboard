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

const [actionSystems, oils, healthConcerns] = await Promise.all([
  fetchBubbleType('sistemas_atuacao'),
  fetchBubbleType('oil_specific'),
  fetchBubbleType('queixa-foco'),
]);

const tempDir = mkdtempSync(join(tmpdir(), 'bubble-action-systems-'));
const files = {
  actionSystems: join(tempDir, 'sistemas_atuacao.csv'),
  oils: join(tempDir, 'oil_specific.csv'),
  healthConcerns: join(tempDir, 'queixa_foco.csv'),
};

writeFileSync(files.actionSystems, jsonRowsToCsv(actionSystems));
writeFileSync(files.oils, jsonRowsToCsv(oils));
writeFileSync(files.healthConcerns, jsonRowsToCsv(healthConcerns));

const systemsFile = files.actionSystems.replace(/'/g, "''");
const oilsFile = files.oils.replace(/'/g, "''");
const healthFile = files.healthConcerns.replace(/'/g, "''");

const sql = String.raw`
\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  CREATE TYPE public.eo_action_system_type AS ENUM (
    'body_system',
    'body_part',
    'functional_area',
    'therapeutic_goal',
    'life_stage',
    'use_context',
    'unknown'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS public.eo_action_systems (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bubble_uid text UNIQUE,
  name text NOT NULL,
  name_portuguese text,
  action_type public.eo_action_system_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eo_action_systems_action_type_idx
  ON public.eo_action_systems(action_type);

CREATE TABLE IF NOT EXISTS public.essential_oil_action_systems (
  essential_oil_id uuid NOT NULL REFERENCES public.essential_oils(id) ON UPDATE CASCADE ON DELETE CASCADE,
  action_system_id uuid NOT NULL REFERENCES public.eo_action_systems(id) ON UPDATE CASCADE ON DELETE CASCADE,
  source_field text NOT NULL DEFAULT 'oil_specific.Sistemas e Atuações',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (essential_oil_id, action_system_id)
);

CREATE INDEX IF NOT EXISTS essential_oil_action_systems_action_system_idx
  ON public.essential_oil_action_systems(action_system_id);

CREATE TABLE IF NOT EXISTS public.health_concern_action_systems (
  health_concern_id uuid NOT NULL REFERENCES public.eo_health_concerns(id) ON UPDATE CASCADE ON DELETE CASCADE,
  action_system_id uuid NOT NULL REFERENCES public.eo_action_systems(id) ON UPDATE CASCADE ON DELETE CASCADE,
  source_field text NOT NULL DEFAULT 'queixa-foco.Sistema ou Area',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (health_concern_id, action_system_id)
);

CREATE INDEX IF NOT EXISTS health_concern_action_systems_action_system_idx
  ON public.health_concern_action_systems(action_system_id);

CREATE TABLE IF NOT EXISTS public.essential_oil_how_to_use_action_systems (
  how_to_use_id uuid NOT NULL REFERENCES public.eo_how_to_use(id) ON UPDATE CASCADE ON DELETE CASCADE,
  action_system_id uuid NOT NULL REFERENCES public.eo_action_systems(id) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (how_to_use_id, action_system_id)
);

CREATE INDEX IF NOT EXISTS essential_oil_how_to_use_action_systems_action_system_idx
  ON public.essential_oil_how_to_use_action_systems(action_system_id);

CREATE TEMP TABLE tmp_action_systems (data jsonb NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE tmp_oils (data jsonb NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE tmp_health_concerns (data jsonb NOT NULL) ON COMMIT DROP;

\copy tmp_action_systems(data) FROM '${systemsFile}' WITH (FORMAT csv)
\copy tmp_oils(data) FROM '${oilsFile}' WITH (FORMAT csv)
\copy tmp_health_concerns(data) FROM '${healthFile}' WITH (FORMAT csv)

CREATE TEMP TABLE tmp_action_system_classification (
  bubble_uid text PRIMARY KEY,
  action_type public.eo_action_system_type NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_action_system_classification (bubble_uid, action_type) VALUES
  ('1644190883550x431660440934585660', 'body_part'),
  ('1644190906705x956848488418318000', 'body_system'),
  ('1644190919486x103956009670037820', 'therapeutic_goal'),
  ('1644191102681x281703973917883040', 'functional_area'),
  ('1644191122823x283179430047155300', 'functional_area'),
  ('1644191133577x904954570468365700', 'body_system'),
  ('1644191148246x797474231730272400', 'body_system'),
  ('1644191158613x311766922860492440', 'body_system'),
  ('1644191165964x533393861419488900', 'therapeutic_goal'),
  ('1644191173523x376985387763006960', 'therapeutic_goal'),
  ('1644191181897x155167351560694400', 'therapeutic_goal'),
  ('1644191198938x147345719111863230', 'body_system'),
  ('1644191209863x194866332853699260', 'body_part'),
  ('1644191217894x710804577701750000', 'body_system'),
  ('1644191224475x301753179009303740', 'body_system'),
  ('1644191232979x730988531606034600', 'therapeutic_goal'),
  ('1644191240326x418693949502850560', 'use_context'),
  ('1644191248940x138693978434498500', 'body_system'),
  ('1644191254714x973217451417198100', 'therapeutic_goal'),
  ('1644191260573x325264196919198100', 'therapeutic_goal'),
  ('1644191267998x300355984270867400', 'body_part'),
  ('1644191275641x583550080158461000', 'body_system'),
  ('1644191284813x818656016607189000', 'therapeutic_goal'),
  ('1644191291957x793519701772800000', 'therapeutic_goal'),
  ('1644191306820x925940631382071800', 'therapeutic_goal'),
  ('1644191318325x729205492829220000', 'therapeutic_goal'),
  ('1644191331406x370799823555158600', 'body_system'),
  ('1644191336909x480396901505182500', 'therapeutic_goal'),
  ('1644191345489x177644298112801020', 'therapeutic_goal'),
  ('1644191353809x858037304841802200', 'functional_area'),
  ('1644191366524x539107261012554050', 'functional_area'),
  ('1644191372400x805655033859140600', 'life_stage'),
  ('1644191381283x658661979680339100', 'life_stage'),
  ('1644191390471x881521370076801000', 'life_stage'),
  ('1644191401728x683921191901723600', 'functional_area'),
  ('1644191407650x326151428456312060', 'use_context'),
  ('1644191418483x891587544177111000', 'life_stage'),
  ('1644191426077x904961890597786100', 'use_context'),
  ('1644264608102x147364202788657920', 'therapeutic_goal');

INSERT INTO public.eo_action_systems (
  bubble_uid,
  name,
  name_portuguese,
  action_type,
  updated_at
)
SELECT
  s.data->>'_id',
  COALESCE(NULLIF(s.data->>'Nome Sistema Atuacao', ''), s.data->>'_id'),
  NULLIF(s.data->>'Nome Sistema Atuacao', ''),
  c.action_type,
  now()
FROM tmp_action_systems s
JOIN tmp_action_system_classification c ON c.bubble_uid = s.data->>'_id'
ON CONFLICT (bubble_uid) DO UPDATE
SET name = EXCLUDED.name,
    name_portuguese = EXCLUDED.name_portuguese,
    action_type = EXCLUDED.action_type,
    updated_at = now();

INSERT INTO public.eo_action_systems (
  id,
  bubble_uid,
  name,
  name_portuguese,
  action_type,
  created_at,
  updated_at
)
SELECT
  id,
  bubble_uid,
  COALESCE(NULLIF(name_english, ''), NULLIF(name_portuguese, ''), bubble_uid, id::text) AS name,
  name_portuguese,
  'body_part'::public.eo_action_system_type,
  created_at,
  now()
FROM public.eo_body_part
ON CONFLICT (id) DO UPDATE
SET bubble_uid = EXCLUDED.bubble_uid,
    name = EXCLUDED.name,
    name_portuguese = EXCLUDED.name_portuguese,
    action_type = EXCLUDED.action_type,
    updated_at = now();

DELETE FROM public.essential_oil_action_systems;
DELETE FROM public.health_concern_action_systems;
DELETE FROM public.essential_oil_how_to_use_action_systems;

WITH oil_system_refs AS (
  SELECT DISTINCT
    t.data->>'_id' AS oil_bubble_uid,
    system_ref.value AS action_system_bubble_uid
  FROM tmp_oils t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Sistemas e Atuações') = 'array' THEN t.data->'Sistemas e Atuações'
      ELSE '[]'::jsonb
    END
  ) system_ref(value)
),
mapped AS (
  SELECT eo.id AS essential_oil_id, eas.id AS action_system_id
  FROM oil_system_refs refs
  JOIN public.essential_oils eo ON eo.bubble_uid = refs.oil_bubble_uid
  JOIN public.eo_action_systems eas ON eas.bubble_uid = refs.action_system_bubble_uid
)
INSERT INTO public.essential_oil_action_systems (essential_oil_id, action_system_id)
SELECT essential_oil_id, action_system_id FROM mapped
ON CONFLICT DO NOTHING;

WITH health_system_refs AS (
  SELECT DISTINCT
    t.data->>'_id' AS health_concern_bubble_uid,
    system_ref.value AS action_system_bubble_uid
  FROM tmp_health_concerns t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Sistema ou Area') = 'array' THEN t.data->'Sistema ou Area'
      WHEN t.data ? 'Sistema ou Area' AND t.data->'Sistema ou Area' <> 'null'::jsonb THEN jsonb_build_array(t.data->'Sistema ou Area')
      ELSE '[]'::jsonb
    END
  ) system_ref(value)
),
mapped AS (
  SELECT hc.id AS health_concern_id, eas.id AS action_system_id
  FROM health_system_refs refs
  JOIN public.eo_health_concerns hc ON hc.bubble_id = refs.health_concern_bubble_uid
  JOIN public.eo_action_systems eas ON eas.bubble_uid = refs.action_system_bubble_uid
)
INSERT INTO public.health_concern_action_systems (health_concern_id, action_system_id)
SELECT health_concern_id, action_system_id FROM mapped
ON CONFLICT DO NOTHING;

INSERT INTO public.essential_oil_how_to_use_action_systems (
  how_to_use_id,
  action_system_id,
  created_at
)
SELECT
  how_to_use_id,
  body_part_id AS action_system_id,
  created_at
FROM public.essential_oil_how_to_use_body_part
ON CONFLICT (how_to_use_id, action_system_id) DO NOTHING;

CREATE OR REPLACE VIEW public.v_eo_body_part AS
SELECT
  id,
  created_at,
  name AS name_english,
  name_portuguese,
  bubble_uid
FROM public.eo_action_systems
WHERE action_type = 'body_part';

CREATE OR REPLACE VIEW public.v_essential_oil_how_to_use_body_part AS
SELECT
  eas.how_to_use_id,
  eas.action_system_id AS body_part_id,
  eas.created_at
FROM public.essential_oil_how_to_use_action_systems eas
JOIN public.eo_action_systems s ON s.id = eas.action_system_id
WHERE s.action_type = 'body_part';

ALTER TABLE public.eo_action_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.essential_oil_action_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_concern_action_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.essential_oil_how_to_use_action_systems ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  rel_name text;
BEGIN
  FOREACH rel_name IN ARRAY ARRAY[
    'eo_action_systems',
    'essential_oil_action_systems',
    'health_concern_action_systems',
    'essential_oil_how_to_use_action_systems'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS anon_can_view ON public.%I', rel_name);
    EXECUTE format('DROP POLICY IF EXISTS admin_can_manage ON public.%I', rel_name);
    EXECUTE format('CREATE POLICY anon_can_view ON public.%I FOR SELECT USING (true)', rel_name);
    EXECUTE format(
      'CREATE POLICY admin_can_manage ON public.%I FOR ALL USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = %L)) WITH CHECK (auth.uid() IN (SELECT id FROM public.profiles WHERE role = %L))',
      rel_name,
      'admin',
      'admin'
    );
    EXECUTE format('GRANT ALL ON TABLE public.%I TO anon, authenticated, service_role', rel_name);
  END LOOP;
END
$$;

GRANT ALL ON TABLE public.v_eo_body_part TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.v_essential_oil_how_to_use_body_part TO anon, authenticated, service_role;

SELECT 'eo_action_systems' AS table_name, count(*) AS rows FROM public.eo_action_systems
UNION ALL
SELECT 'essential_oil_action_systems', count(*) FROM public.essential_oil_action_systems
UNION ALL
SELECT 'health_concern_action_systems', count(*) FROM public.health_concern_action_systems
UNION ALL
SELECT 'essential_oil_how_to_use_action_systems', count(*) FROM public.essential_oil_how_to_use_action_systems
UNION ALL
SELECT 'v_eo_body_part', count(*) FROM public.v_eo_body_part
UNION ALL
SELECT 'v_essential_oil_how_to_use_body_part', count(*) FROM public.v_essential_oil_how_to_use_body_part;

SELECT action_type, count(*) AS action_systems
FROM public.eo_action_systems
GROUP BY action_type
ORDER BY action_type;

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
