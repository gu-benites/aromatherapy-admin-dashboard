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

const [colorLabels, oils] = await Promise.all([
  fetchBubbleType('color_label'),
  fetchBubbleType('oil_specific'),
]);

const tempDir = mkdtempSync(join(tmpdir(), 'bubble-color-labels-'));
const colorLabelsFile = join(tempDir, 'color_label.csv');
const oilsFile = join(tempDir, 'oil_specific.csv');
const colorLabelsFileForPsql = colorLabelsFile.replace(/'/g, "''");
const oilsFileForPsql = oilsFile.replace(/'/g, "''");

writeFileSync(colorLabelsFile, jsonRowsToCsv(colorLabels));
writeFileSync(oilsFile, jsonRowsToCsv(oils));

const sql = String.raw`
\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS public.eo_color_labels (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bubble_uid text NOT NULL UNIQUE,
  name_english text NOT NULL,
  name_portuguese text,
  color_hex text,
  bubble_created_at timestamptz,
  bubble_modified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eo_color_labels_color_hex_format
    CHECK (color_hex IS NULL OR color_hex ~ '^#[0-9A-Fa-f]{6}$')
);

ALTER TABLE public.essential_oils
  ADD COLUMN IF NOT EXISTS color_label_id uuid REFERENCES public.eo_color_labels(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.eo_products
  ADD COLUMN IF NOT EXISTS color_label_id uuid REFERENCES public.eo_color_labels(id) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS essential_oils_color_label_id_idx
  ON public.essential_oils(color_label_id);

CREATE INDEX IF NOT EXISTS eo_products_color_label_id_idx
  ON public.eo_products(color_label_id);

CREATE TEMP TABLE tmp_color_labels (data jsonb NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE tmp_oils (data jsonb NOT NULL) ON COMMIT DROP;

\copy tmp_color_labels(data) FROM '${colorLabelsFileForPsql}' WITH (FORMAT csv)
\copy tmp_oils(data) FROM '${oilsFileForPsql}' WITH (FORMAT csv)

INSERT INTO public.eo_color_labels (
  bubble_uid,
  name_english,
  name_portuguese,
  color_hex,
  bubble_created_at,
  bubble_modified_at,
  updated_at
)
SELECT
  data->>'_id',
  COALESCE(NULLIF(data->>'color-name-english', ''), NULLIF(data->>'color-name-portuguese', ''), data->>'_id'),
  NULLIF(data->>'color-name-portuguese', ''),
  NULLIF(data->>'hex-color', ''),
  NULLIF(data->>'Created Date', '')::timestamptz,
  NULLIF(data->>'Modified Date', '')::timestamptz,
  now()
FROM tmp_color_labels
WHERE data ? '_id'
ON CONFLICT (bubble_uid) DO UPDATE
SET name_english = EXCLUDED.name_english,
    name_portuguese = EXCLUDED.name_portuguese,
    color_hex = EXCLUDED.color_hex,
    bubble_created_at = EXCLUDED.bubble_created_at,
    bubble_modified_at = EXCLUDED.bubble_modified_at,
    updated_at = now();

WITH oil_colors AS (
  SELECT
    eo.id AS essential_oil_id,
    cl.id AS color_label_id
  FROM tmp_oils t
  JOIN public.essential_oils eo ON eo.bubble_uid = t.data->>'_id'
  JOIN public.eo_color_labels cl ON cl.bubble_uid = t.data->>'color-label'
)
UPDATE public.essential_oils eo
SET color_label_id = oc.color_label_id,
    updated_at = now()
FROM oil_colors oc
WHERE eo.id = oc.essential_oil_id
  AND eo.color_label_id IS DISTINCT FROM oc.color_label_id;

UPDATE public.eo_products p
SET color_label_id = cl.id,
    updated_at = now()
FROM public.eo_color_labels cl
WHERE p.color_label_bubble_uid = cl.bubble_uid
  AND p.color_label_id IS DISTINCT FROM cl.id;

ALTER TABLE public.eo_color_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_can_view ON public.eo_color_labels;
DROP POLICY IF EXISTS admin_can_manage ON public.eo_color_labels;
CREATE POLICY anon_can_view ON public.eo_color_labels FOR SELECT USING (true);
CREATE POLICY admin_can_manage ON public.eo_color_labels
  FOR ALL USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

GRANT ALL ON TABLE public.eo_color_labels TO anon, authenticated, service_role;

SELECT 'eo_color_labels' AS item, count(*) AS rows FROM public.eo_color_labels
UNION ALL
SELECT 'essential_oils_with_color_label', count(*) FROM public.essential_oils WHERE color_label_id IS NOT NULL
UNION ALL
SELECT 'eo_products_with_color_label', count(*) FROM public.eo_products WHERE color_label_id IS NOT NULL;

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
