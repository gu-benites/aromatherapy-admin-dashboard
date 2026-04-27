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

WITH normalized AS (
  SELECT
    rm.id,
    rm.recipe_id,
    rm.source_text,
    lower(translate(coalesce(r.full_recipe_text, ''), 'áàãâäéèêëíìîïóòõôöúùûüçÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) AS txt
  FROM public.eo_health_concern_recipe_application_methods rm
  JOIN public.eo_health_concern_recipes r ON r.id = rm.recipe_id
  WHERE rm.parse_status IN ('ambiguous', 'unmapped')
),
method_candidates AS (
  SELECT
    id,
    recipe_id,
    source_text,
    CASE
      WHEN txt LIKE '%aromaterapia%' THEN ARRAY[]::text[]
      ELSE ARRAY_REMOVE(ARRAY[
        CASE
          WHEN txt ~ 'difusor|difusao|inale|inalar|inalacao|respire profundamente|leve as maos ao nariz|leve as maos em direcao ao nariz|inspirando o aroma|ao redor do ambiente|no ambiente|spray nasal|nariz antes de dormir|respire lenta e profundamente'
          THEN 'Aromatic'
        END,
        CASE
          WHEN txt ~ 'aplique topicamente|aplicacao topica|topicamente|topico|topica|massageie|massageando|pele|couro cabeludo|abdomen|pulsos|nuca|temporas|peito|pescoco|axilas|sola dos pes|dentes|gengivas|boca|garganta|area afetada|regiao afetada|regiao abdominal|regiao lombar|regiao do peito|regiao do pescoço|regiao dos olhos|regiao dos mamilos|regiao interna da orelha|regiao externa da orelha|regiao ao redor dos olhos|regiao atrás das orelhas|regiao do pulso|regiao do nariz|regiao do abdomen|regiao do estomago|pescoço|têmporas|têmpora|testa|pulsos|pesco|costas|ombro|orelha|ouvidos|garganta|dentes|bochecho|bochechar|cusp(a|ir)|nao engolir|evite ingerir'
          THEN 'Topical'
        END,
        CASE
          WHEN txt ~ 'ingestao|ingesta|uso interno|via oral|oral|capsula|capsulas|tome|ingerir|beba|copo d agua|copo de agua|adicione .* em uma capsula|tomar 1 gota|tomar 1-2 gotas|tomar em capsulas|uso interno'
          THEN 'Internal'
        END
      ], NULL)
    END AS methods
  FROM normalized
),
expanded AS (
  SELECT
    mc.id,
    mc.recipe_id,
    mc.source_text,
    unnest(mc.methods) AS method_name
  FROM method_candidates mc
)
INSERT INTO public.eo_health_concern_recipe_application_methods (
  recipe_id,
  application_method_id,
  source_text,
  parse_status
)
SELECT
  e.recipe_id,
  am.id,
  e.source_text,
  'mapped'
FROM expanded e
JOIN public.eo_application_methods am ON am.name = e.method_name
WHERE NOT EXISTS (
  SELECT 1
  FROM public.eo_health_concern_recipe_application_methods existing
  WHERE existing.recipe_id = e.recipe_id
    AND existing.application_method_id = am.id
);

UPDATE public.eo_health_concern_recipe_application_methods rm
SET parse_status = 'mapped'
WHERE rm.parse_status IN ('ambiguous', 'unmapped')
  AND EXISTS (
    SELECT 1
    FROM public.eo_health_concern_recipe_application_methods mapped
    WHERE mapped.recipe_id = rm.recipe_id
      AND mapped.application_method_id IS NOT NULL
      AND mapped.parse_status = 'mapped'
  )
  AND rm.application_method_id IS NULL;

COMMIT;

SELECT parse_status, count(*) AS rows, count(distinct recipe_id) AS recipes, count(distinct source_text) AS distinct_source_texts
FROM public.eo_health_concern_recipe_application_methods
GROUP BY parse_status
ORDER BY parse_status;

SELECT am.name AS application_method, count(*) AS recipes
FROM public.eo_health_concern_recipe_application_methods rm
JOIN public.eo_application_methods am ON am.id = rm.application_method_id
GROUP BY am.name
ORDER BY am.name;
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
