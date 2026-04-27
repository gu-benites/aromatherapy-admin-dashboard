import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const envText = readFileSync(new URL('../bubble/env.md', import.meta.url), 'utf8');
const databaseUrl = envText.match(/DATABASE_URL=(postgresql:\/\/\S+)/)?.[1];
const bubbleApiKey = envText.match(/^key:\s*(\S+)/m)?.[1];

if (!databaseUrl) throw new Error('DATABASE_URL not found in bubble/env.md');
if (!bubbleApiKey) throw new Error('Bubble API key not found in bubble/env.md');

async function fetchBubbleType(type) {
  const cacheDir = new URL('../.bubble-cache/', import.meta.url);
  const cacheFile = new URL(`${type}.json`, cacheDir);

  if (process.env.BUBBLE_FORCE_FETCH !== '1' && existsSync(cacheFile)) {
    return JSON.parse(readFileSync(cacheFile, 'utf8'));
  }

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

    if (!payload.response.remaining) break;
    cursor += payload.response.count;
  }

  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(results, null, 2));

  return results;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[®.™]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanInstructionLine(line) {
  return line
    .replace(/^\s*[-*]\s*/, '')
    .replace(/^\s*\d+[.)]\s*/, '')
    .trim();
}

function splitInstructionLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(cleanInstructionLine)
    .filter(Boolean);
}

function parseDrops(line) {
  const match = String(line || '').match(/(\d+)\s*gotas?/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function ingredientLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(cleanInstructionLine)
    .filter(Boolean)
    .filter((line) => /gota/i.test(line));
}

function extractTitle(fullRecipeText) {
  const firstLine = String(fullRecipeText || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean);

  if (!firstLine) return null;
  return firstLine.replace(/^Receita\s*:\s*/i, '').replace(/^Nome da Receita\s*:\s*/i, '').trim();
}

function extractMethodSection(fullRecipeText) {
  const text = String(fullRecipeText || '');
  const match = text.match(/m[ée]todo de aplica[cç][aã]o\s*:?\s*\n?([^\n#]+)/i);
  return match?.[1]?.trim() || '';
}

const explicitMethodPatterns = [
  {
    methodName: 'Aromatic',
    patterns: [
      /\baromatic[oa]\b/,
      /\binala[cç][aã]o\b/,
      /\binalar\b/,
      /\binalatoria\b/,
      /\bdifus[aã]o\b/,
      /\bdifusor\b/,
    ],
  },
  {
    methodName: 'Topical',
    patterns: [
      /\btopico\b/,
      /\btopica\b/,
      /\btopicamente\b/,
      /\btopical\b/,
      /\baplicacao topica\b/,
      /\buso topico\b/,
      /\bmassagem\b/,
      /\broll\s*-?\s*on\b/,
      /\bcompressa\b/,
      /\bcompressa topica\b/,
    ],
  },
  {
    methodName: 'Internal',
    patterns: [
      /\bingestao\b/,
      /\bingesta\b/,
      /\binterno\b/,
      /\buso interno\b/,
      /\bvia oral\b/,
      /\boral\b/,
      /\bcapsula\b/,
      /\bcapsulas\b/,
    ],
  },
];

const ambiguousPatterns = [
  /\bambiente\b/,
  /\bpele\b/,
  /\blocal\b/,
  /\bbanho\b/,
  /\bboca\b/,
  /\bgarganta\b/,
  /\bsublingual\b/,
];

function parseApplicationMethods(recipe) {
  const directText = String(recipe['modo-uso'] || '').trim();
  const sectionText = directText || extractMethodSection(recipe['receita-completa-gpt4']);
  const sourceText = sectionText.trim();

  if (!sourceText) {
    return [{ methodName: null, sourceText: null, parseStatus: 'empty' }];
  }

  const normalized = normalizeText(sourceText);
  const compact = normalized.replace(/[^a-z0-9]+/g, '');
  const methods = explicitMethodPatterns
    .filter((entry) => entry.patterns.some((pattern) => pattern.test(normalized)))
    .map((entry) => entry.methodName);

  if (compact.includes('topicoaromatico')) {
    methods.push('Topical', 'Aromatic');
  }

  const uniqueMethods = [...new Set(methods)];

  if (uniqueMethods.length > 0) {
    return uniqueMethods.map((methodName) => ({
      methodName,
      sourceText,
      parseStatus: 'mapped',
    }));
  }

  const ambiguous = ambiguousPatterns.some((pattern) => pattern.test(normalized));
  return [{
    methodName: null,
    sourceText,
    parseStatus: ambiguous ? 'ambiguous' : 'unmapped',
  }];
}

function jsonRowsToCsv(rows) {
  return rows.map((row) => `"${JSON.stringify(row).replace(/"/g, '""')}"`).join('\n') + '\n';
}

const recipes = await fetchBubbleType('receitas-queixa-foco');

const recipeRows = [];
const oilRows = [];
const instructionRows = [];
const methodRows = [];

for (const recipe of recipes) {
  const bubbleUid = recipe._id;
  const fullRecipeText = recipe['receita-completa-gpt4'] || null;
  const recipeTitle = extractTitle(fullRecipeText);

  recipeRows.push({
    bubble_uid: bubbleUid,
    health_concern_bubble_id: recipe['queixa-foco'] || null,
    recipe_title: recipeTitle,
    full_recipe_text: fullRecipeText,
    explanation: recipe.explicacao || null,
    application_method_text: recipe['modo-uso'] || extractMethodSection(fullRecipeText) || null,
    carrier_oil_text: recipe['oleo-carreador'] || null,
    bottle_size_text: recipe['tamanho-frasco'] || null,
    cap_type_text: recipe['tipo-tampa'] || null,
    preparation_instructions_text: recipe['instrucoes-preparo'] || null,
    usage_protocol_text: recipe['protocolo-uso'] || null,
    oil_drops_text: recipe['gotas-oleos'] || null,
    target_audience_text: recipe['paraQuem?'] || null,
    reviewed_by_daiane: recipe['reviewed-by-daiane'] === true,
    sent_to_pinecone: recipe.sentToPinecone === true,
    requested_by_bubble_uid: recipe.solicitadoPor || null,
    created_by_bubble_uid: recipe['Created By'] || null,
    bubble_created_at: recipe['Created Date'] || null,
    bubble_modified_at: recipe['Modified Date'] || null,
  });

  const oils = Array.isArray(recipe['oleos-singulares']) ? recipe['oleos-singulares'] : [];
  const lines = ingredientLines(recipe['gotas-oleos']);
  oils.forEach((oilBubbleUid, index) => {
    const rawLine = lines.length === oils.length ? lines[index] : null;
    oilRows.push({
      recipe_bubble_uid: bubbleUid,
      oil_bubble_uid: oilBubbleUid,
      oil_order: index + 1,
      drops_count: rawLine ? parseDrops(rawLine) : null,
      raw_oil_line: rawLine,
    });
  });

  for (const [instructionType, text] of [
    ['preparation', recipe['instrucoes-preparo']],
    ['usage_protocol', recipe['protocolo-uso']],
  ]) {
    splitInstructionLines(text).forEach((instructionText, index) => {
      instructionRows.push({
        recipe_bubble_uid: bubbleUid,
        instruction_type: instructionType,
        step_order: index + 1,
        instruction_text: instructionText,
      });
    });
  }

  for (const method of parseApplicationMethods(recipe)) {
    methodRows.push({
      recipe_bubble_uid: bubbleUid,
      method_name: method.methodName,
      source_text: method.sourceText,
      parse_status: method.parseStatus,
    });
  }
}

const tempDir = mkdtempSync(join(tmpdir(), 'bubble-health-recipes-'));
const files = {
  recipes: join(tempDir, 'recipes.csv'),
  oils: join(tempDir, 'recipe_oils.csv'),
  instructions: join(tempDir, 'recipe_instructions.csv'),
  methods: join(tempDir, 'recipe_methods.csv'),
};

writeFileSync(files.recipes, jsonRowsToCsv(recipeRows));
writeFileSync(files.oils, jsonRowsToCsv(oilRows));
writeFileSync(files.instructions, jsonRowsToCsv(instructionRows));
writeFileSync(files.methods, jsonRowsToCsv(methodRows));

const psqlFile = (path) => path.replace(/'/g, "''");

const sql = String.raw`
\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  CREATE TYPE public.eo_health_concern_recipe_instruction_type AS ENUM (
    'preparation',
    'usage_protocol'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE public.eo_health_concern_recipe_application_method_parse_status AS ENUM (
    'mapped',
    'empty',
    'ambiguous',
    'unmapped'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS public.eo_health_concern_recipes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bubble_uid text NOT NULL UNIQUE,
  health_concern_id uuid REFERENCES public.eo_health_concerns(id) ON UPDATE CASCADE ON DELETE SET NULL,
  recipe_title text,
  full_recipe_text text,
  explanation text,
  application_method_text text,
  carrier_oil_text text,
  bottle_size_text text,
  cap_type_text text,
  preparation_instructions_text text,
  usage_protocol_text text,
  oil_drops_text text,
  target_audience_text text,
  reviewed_by_daiane boolean NOT NULL DEFAULT false,
  sent_to_pinecone boolean NOT NULL DEFAULT false,
  requested_by_bubble_uid text,
  created_by_bubble_uid text,
  bubble_created_at timestamptz,
  bubble_modified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eo_health_concern_recipes_health_concern_idx
  ON public.eo_health_concern_recipes(health_concern_id);
CREATE INDEX IF NOT EXISTS eo_health_concern_recipes_reviewed_idx
  ON public.eo_health_concern_recipes(reviewed_by_daiane);

CREATE TABLE IF NOT EXISTS public.eo_health_concern_recipe_oils (
  recipe_id uuid NOT NULL REFERENCES public.eo_health_concern_recipes(id) ON UPDATE CASCADE ON DELETE CASCADE,
  essential_oil_id uuid NOT NULL REFERENCES public.essential_oils(id) ON UPDATE CASCADE ON DELETE CASCADE,
  oil_order integer,
  drops_count integer,
  raw_oil_line text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recipe_id, essential_oil_id)
);

CREATE INDEX IF NOT EXISTS eo_health_concern_recipe_oils_oil_idx
  ON public.eo_health_concern_recipe_oils(essential_oil_id);

CREATE TABLE IF NOT EXISTS public.eo_health_concern_recipe_instructions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id uuid NOT NULL REFERENCES public.eo_health_concern_recipes(id) ON UPDATE CASCADE ON DELETE CASCADE,
  instruction_type public.eo_health_concern_recipe_instruction_type NOT NULL,
  step_order integer NOT NULL,
  instruction_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, instruction_type, step_order)
);

CREATE INDEX IF NOT EXISTS eo_health_concern_recipe_instructions_recipe_idx
  ON public.eo_health_concern_recipe_instructions(recipe_id);

CREATE TABLE IF NOT EXISTS public.eo_health_concern_recipe_application_methods (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipe_id uuid NOT NULL REFERENCES public.eo_health_concern_recipes(id) ON UPDATE CASCADE ON DELETE CASCADE,
  application_method_id uuid REFERENCES public.eo_application_methods(id) ON UPDATE CASCADE ON DELETE CASCADE,
  source_text text,
  parse_status public.eo_health_concern_recipe_application_method_parse_status NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS eo_hc_recipe_application_methods_mapped_unique
  ON public.eo_health_concern_recipe_application_methods(recipe_id, application_method_id)
  WHERE application_method_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS eo_hc_recipe_application_methods_unmapped_unique
  ON public.eo_health_concern_recipe_application_methods(recipe_id, parse_status)
  WHERE application_method_id IS NULL;

CREATE INDEX IF NOT EXISTS eo_hc_recipe_application_methods_method_idx
  ON public.eo_health_concern_recipe_application_methods(application_method_id);
CREATE INDEX IF NOT EXISTS eo_hc_recipe_application_methods_parse_status_idx
  ON public.eo_health_concern_recipe_application_methods(parse_status);

CREATE TEMP TABLE tmp_recipes (data jsonb NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE tmp_recipe_oils (data jsonb NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE tmp_recipe_instructions (data jsonb NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE tmp_recipe_methods (data jsonb NOT NULL) ON COMMIT DROP;

\copy tmp_recipes(data) FROM '${psqlFile(files.recipes)}' WITH (FORMAT csv)
\copy tmp_recipe_oils(data) FROM '${psqlFile(files.oils)}' WITH (FORMAT csv)
\copy tmp_recipe_instructions(data) FROM '${psqlFile(files.instructions)}' WITH (FORMAT csv)
\copy tmp_recipe_methods(data) FROM '${psqlFile(files.methods)}' WITH (FORMAT csv)

INSERT INTO public.eo_health_concern_recipes (
  bubble_uid,
  health_concern_id,
  recipe_title,
  full_recipe_text,
  explanation,
  application_method_text,
  carrier_oil_text,
  bottle_size_text,
  cap_type_text,
  preparation_instructions_text,
  usage_protocol_text,
  oil_drops_text,
  target_audience_text,
  reviewed_by_daiane,
  sent_to_pinecone,
  requested_by_bubble_uid,
  created_by_bubble_uid,
  bubble_created_at,
  bubble_modified_at,
  updated_at
)
SELECT
  r.data->>'bubble_uid',
  hc.id,
  NULLIF(r.data->>'recipe_title', ''),
  NULLIF(r.data->>'full_recipe_text', ''),
  NULLIF(r.data->>'explanation', ''),
  NULLIF(r.data->>'application_method_text', ''),
  NULLIF(r.data->>'carrier_oil_text', ''),
  NULLIF(r.data->>'bottle_size_text', ''),
  NULLIF(r.data->>'cap_type_text', ''),
  NULLIF(r.data->>'preparation_instructions_text', ''),
  NULLIF(r.data->>'usage_protocol_text', ''),
  NULLIF(r.data->>'oil_drops_text', ''),
  NULLIF(r.data->>'target_audience_text', ''),
  COALESCE((r.data->>'reviewed_by_daiane')::boolean, false),
  COALESCE((r.data->>'sent_to_pinecone')::boolean, false),
  NULLIF(r.data->>'requested_by_bubble_uid', ''),
  NULLIF(r.data->>'created_by_bubble_uid', ''),
  NULLIF(r.data->>'bubble_created_at', '')::timestamptz,
  NULLIF(r.data->>'bubble_modified_at', '')::timestamptz,
  now()
FROM tmp_recipes r
LEFT JOIN public.eo_health_concerns hc ON hc.bubble_id = r.data->>'health_concern_bubble_id'
ON CONFLICT (bubble_uid) DO UPDATE
SET health_concern_id = EXCLUDED.health_concern_id,
    recipe_title = EXCLUDED.recipe_title,
    full_recipe_text = EXCLUDED.full_recipe_text,
    explanation = EXCLUDED.explanation,
    application_method_text = EXCLUDED.application_method_text,
    carrier_oil_text = EXCLUDED.carrier_oil_text,
    bottle_size_text = EXCLUDED.bottle_size_text,
    cap_type_text = EXCLUDED.cap_type_text,
    preparation_instructions_text = EXCLUDED.preparation_instructions_text,
    usage_protocol_text = EXCLUDED.usage_protocol_text,
    oil_drops_text = EXCLUDED.oil_drops_text,
    target_audience_text = EXCLUDED.target_audience_text,
    reviewed_by_daiane = EXCLUDED.reviewed_by_daiane,
    sent_to_pinecone = EXCLUDED.sent_to_pinecone,
    requested_by_bubble_uid = EXCLUDED.requested_by_bubble_uid,
    created_by_bubble_uid = EXCLUDED.created_by_bubble_uid,
    bubble_created_at = EXCLUDED.bubble_created_at,
    bubble_modified_at = EXCLUDED.bubble_modified_at,
    updated_at = now();

DELETE FROM public.eo_health_concern_recipe_oils;

WITH mapped_oils AS (
  SELECT DISTINCT ON (recipe.id, eo.id)
    recipe.id AS recipe_id,
    eo.id AS essential_oil_id,
    NULLIF(o.data->>'oil_order', '')::integer AS oil_order,
    NULLIF(o.data->>'drops_count', '')::integer AS drops_count,
    NULLIF(o.data->>'raw_oil_line', '') AS raw_oil_line
  FROM tmp_recipe_oils o
  JOIN public.eo_health_concern_recipes recipe ON recipe.bubble_uid = o.data->>'recipe_bubble_uid'
  JOIN public.essential_oils eo ON eo.bubble_uid = o.data->>'oil_bubble_uid'
  ORDER BY recipe.id, eo.id, NULLIF(o.data->>'oil_order', '')::integer
)
INSERT INTO public.eo_health_concern_recipe_oils (
  recipe_id,
  essential_oil_id,
  oil_order,
  drops_count,
  raw_oil_line
)
SELECT recipe_id, essential_oil_id, oil_order, drops_count, raw_oil_line
FROM mapped_oils
ON CONFLICT (recipe_id, essential_oil_id) DO UPDATE
SET oil_order = EXCLUDED.oil_order,
    drops_count = EXCLUDED.drops_count,
    raw_oil_line = EXCLUDED.raw_oil_line;

DELETE FROM public.eo_health_concern_recipe_instructions;

INSERT INTO public.eo_health_concern_recipe_instructions (
  recipe_id,
  instruction_type,
  step_order,
  instruction_text
)
SELECT
  recipe.id,
  (i.data->>'instruction_type')::public.eo_health_concern_recipe_instruction_type,
  NULLIF(i.data->>'step_order', '')::integer,
  i.data->>'instruction_text'
FROM tmp_recipe_instructions i
JOIN public.eo_health_concern_recipes recipe ON recipe.bubble_uid = i.data->>'recipe_bubble_uid'
WHERE NULLIF(i.data->>'instruction_text', '') IS NOT NULL
ON CONFLICT (recipe_id, instruction_type, step_order) DO UPDATE
SET instruction_text = EXCLUDED.instruction_text;

DELETE FROM public.eo_health_concern_recipe_application_methods;

INSERT INTO public.eo_health_concern_recipe_application_methods (
  recipe_id,
  application_method_id,
  source_text,
  parse_status
)
SELECT
  recipe.id,
  am.id,
  NULLIF(m.data->>'source_text', ''),
  (m.data->>'parse_status')::public.eo_health_concern_recipe_application_method_parse_status
FROM tmp_recipe_methods m
JOIN public.eo_health_concern_recipes recipe ON recipe.bubble_uid = m.data->>'recipe_bubble_uid'
LEFT JOIN public.eo_application_methods am ON am.name = m.data->>'method_name'
ON CONFLICT DO NOTHING;

ALTER TABLE public.eo_health_concern_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eo_health_concern_recipe_oils ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eo_health_concern_recipe_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eo_health_concern_recipe_application_methods ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  rel_name text;
BEGIN
  FOREACH rel_name IN ARRAY ARRAY[
    'eo_health_concern_recipes',
    'eo_health_concern_recipe_oils',
    'eo_health_concern_recipe_instructions',
    'eo_health_concern_recipe_application_methods'
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

SELECT 'eo_health_concern_recipes' AS item, count(*) AS rows FROM public.eo_health_concern_recipes
UNION ALL
SELECT 'recipes_with_health_concern', count(*) FROM public.eo_health_concern_recipes WHERE health_concern_id IS NOT NULL
UNION ALL
SELECT 'eo_health_concern_recipe_oils', count(*) FROM public.eo_health_concern_recipe_oils
UNION ALL
SELECT 'eo_health_concern_recipe_instructions', count(*) FROM public.eo_health_concern_recipe_instructions
UNION ALL
SELECT 'eo_health_concern_recipe_application_methods', count(*) FROM public.eo_health_concern_recipe_application_methods;

SELECT parse_status, count(*) AS rows
FROM public.eo_health_concern_recipe_application_methods
GROUP BY parse_status
ORDER BY parse_status;

SELECT am.name AS application_method, count(*) AS recipes
FROM public.eo_health_concern_recipe_application_methods rm
JOIN public.eo_application_methods am ON am.id = rm.application_method_id
GROUP BY am.name
ORDER BY am.name;

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
