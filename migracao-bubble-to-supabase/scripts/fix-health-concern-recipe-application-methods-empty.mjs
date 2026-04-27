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

WITH input(recipe_id, source_text, method_name, method_order) AS (
  VALUES
    ('1859eb2e-4c9c-4e5e-b0dd-c6578f9ec0f3', 'Aplicar topicamente na área afetada', 'Topical', 1),
    ('af2bb854-303f-4a42-a731-555d9d07f106', 'Massagem', 'Topical', 1),
    ('4c89163f-35af-4fdf-8961-bf815eb610e0', 'Aplicar topicamente', 'Topical', 1),
    ('3d077925-c73d-4838-bd57-787be86ed4fb', 'Inalação', 'Aromatic', 1),
    ('3d077925-c73d-4838-bd57-787be86ed4fb', 'Compressas', 'Topical', 2),
    ('705ff48b-70c4-474b-ab93-479531d69ef8', 'Massagem', 'Topical', 1),
    ('4a3af931-dbb0-4da8-a810-419fb081b206', 'Aplicar topicamente', 'Topical', 1),
    ('bbcddf6b-5613-4d22-9e27-46554e15eb8c', 'Massagem', 'Topical', 1),
    ('9e1ffb73-41ae-4501-87ee-f935c542a20f', 'Aplicação tópica', 'Topical', 1),
    ('776e2cce-1421-427b-8357-f3e92f86fadf', 'Massagem', 'Topical', 1),
    ('4e8c82d3-e677-441d-b819-482b5ebccc20', 'Massagem terapêutica', 'Topical', 1),
    ('d954091d-8e5b-4a9c-862c-0237b3a103e3', 'Aplicação tópica', 'Topical', 1),
    ('5118b7fe-430c-440f-8176-6e0bf8684115', 'Massagem', 'Topical', 1),
    ('f6d3dace-35c6-444b-adf2-78f26f912064', 'Respire profundamente', 'Aromatic', 1),
    ('f6d3dace-35c6-444b-adf2-78f26f912064', 'Pulso', 'Topical', 2),
    ('d37288f2-c880-4ba4-833b-fc6230c9de04', 'Inalação', 'Aromatic', 1),
    ('9247c428-4789-4926-a08f-78eca46d5afc', 'Aplicação Tópica', 'Topical', 1),
    ('e9b42274-73e4-4da7-a26d-301550e91a32', 'Aplicação Tópica', 'Topical', 1),
    ('68a665e7-9048-478d-a23b-79b412c7c5b0', 'Aplicar topicamente na área afetada', 'Topical', 1),
    ('24e4f416-5928-419c-9a1f-71a9a43f323c', 'Aplicar topicamente na região lombar e abdominal', 'Topical', 1),
    ('f2179129-51fc-4b9c-8ef8-a32a243961d8', 'Aplicar topicamente na área afetada', 'Topical', 1),
    ('f4137e9b-fcb4-4c19-84d6-39ab027a2474', 'Massagem', 'Topical', 1),
    ('256c2918-8bd0-4f1c-ad0a-83b807b5f477', 'Aplicação tópica', 'Topical', 1),
    ('8bd189fa-7009-490a-9ac2-6ba6f0e4e3b2', 'Aplicação Tópica', 'Topical', 1),
    ('afecb772-d3ff-4d9c-a2df-703086c86b19', 'Aplicar topicamente na região afetada', 'Topical', 1),
    ('9f3fa0b7-cc9d-401a-8b49-b8f4dbb5326c', 'Aplicação Tópica', 'Topical', 1),
    ('0fe4735f-34e9-4054-88f2-79168901366b', 'Palmas das mãos e inale profundamente', 'Aromatic', 1),
    ('0fe4735f-34e9-4054-88f2-79168901366b', 'Têmporas, pulso, peito e nuca', 'Topical', 2),
    ('e7d8120e-1486-4502-873d-e6ab09e1af4b', 'Difusor ou inalação direta', 'Aromatic', 1),
    ('e7d8120e-1486-4502-873d-e6ab09e1af4b', 'Abdômen, costas e pulsos', 'Topical', 2)
),
ranked AS (
  SELECT
    i.recipe_id::uuid AS recipe_id,
    i.source_text,
    i.method_name,
    i.method_order,
    row_number() OVER (PARTITION BY i.recipe_id ORDER BY i.method_order, i.method_name) AS rn
  FROM input i
),
method_ids AS (
  SELECT
    r.recipe_id,
    r.source_text,
    r.method_name,
    am.id AS application_method_id,
    r.rn
  FROM ranked r
  JOIN public.eo_application_methods am ON am.name = r.method_name
),
first_methods AS (
  SELECT *
  FROM method_ids
  WHERE rn = 1
),
updated_empty AS (
  UPDATE public.eo_health_concern_recipe_application_methods rm
  SET
    application_method_id = fm.application_method_id,
    source_text = fm.source_text,
    parse_status = 'mapped'
  FROM first_methods fm
  WHERE rm.recipe_id = fm.recipe_id
    AND rm.recipe_id = fm.recipe_id::uuid
    AND rm.parse_status = 'empty'
    AND rm.application_method_id IS NULL
  RETURNING rm.recipe_id
),
remaining_methods AS (
  SELECT *
  FROM method_ids
  WHERE rn > 1
)
INSERT INTO public.eo_health_concern_recipe_application_methods (
  recipe_id,
  application_method_id,
  source_text,
  parse_status
)
SELECT
  r.recipe_id,
  r.application_method_id,
  r.source_text,
  'mapped'
FROM remaining_methods r
WHERE NOT EXISTS (
  SELECT 1
  FROM public.eo_health_concern_recipe_application_methods existing
  WHERE existing.recipe_id = r.recipe_id
    AND existing.application_method_id = r.application_method_id
);

COMMIT;

select parse_status, count(*) as rows, count(distinct recipe_id) as recipes, count(distinct source_text) as distinct_source_texts
from public.eo_health_concern_recipe_application_methods
group by parse_status
order by parse_status;

select am.name as application_method, count(*) as rows
from public.eo_health_concern_recipe_application_methods rm
join public.eo_application_methods am on am.id = rm.application_method_id
group by am.name
order by am.name;
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
