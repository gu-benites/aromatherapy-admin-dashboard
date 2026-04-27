import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const envText = await import('node:fs').then((fs) =>
  fs.readFileSync(new URL('../bubble/env.md', import.meta.url), 'utf8'),
);

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

const products = await fetchBubbleType('oil_product');

const tempDir = mkdtempSync(join(tmpdir(), 'bubble-products-'));
const productsFile = join(tempDir, 'oil_product.ndjson');
const productsFileForPsql = productsFile.replace(/'/g, "''");

writeFileSync(productsFile, products.map((product) => JSON.stringify(product)).join('\n') + '\n');

const sql = String.raw`
\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS public.eo_product_types (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL UNIQUE,
  slug text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.eo_products (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bubble_uid text NOT NULL UNIQUE,
  main_product_bubble_uid text,
  main_product_id uuid REFERENCES public.eo_products(id) ON UPDATE CASCADE ON DELETE SET NULL,
  primary_product_type_id uuid REFERENCES public.eo_product_types(id) ON UPDATE CASCADE ON DELETE SET NULL,
  name_english text NOT NULL,
  name_portuguese text,
  image_url text,
  product_number text,
  anvisa_processo text,
  official_url text,
  country_code text,
  unit_measure_bubble_uid text,
  is_main_product boolean,
  pv numeric,
  regular_price numeric,
  member_price numeric,
  point_to_exchange numeric,
  price_per_point numeric,
  price_per_pv numeric,
  price_per_drop numeric,
  quantity numeric,
  bottle_size_unit text,
  color_label_bubble_uid text,
  bubble_created_at timestamptz,
  bubble_modified_at timestamptz,
  bubble_raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eo_products_main_product_id_idx ON public.eo_products(main_product_id);
CREATE INDEX IF NOT EXISTS eo_products_primary_product_type_id_idx ON public.eo_products(primary_product_type_id);
CREATE INDEX IF NOT EXISTS eo_products_main_product_bubble_uid_idx ON public.eo_products(main_product_bubble_uid);
CREATE INDEX IF NOT EXISTS eo_products_product_number_idx ON public.eo_products(product_number);
CREATE INDEX IF NOT EXISTS eo_products_color_label_bubble_uid_idx ON public.eo_products(color_label_bubble_uid);

CREATE TABLE IF NOT EXISTS public.eo_product_type_assignments (
  product_id uuid NOT NULL REFERENCES public.eo_products(id) ON UPDATE CASCADE ON DELETE CASCADE,
  product_type_id uuid NOT NULL REFERENCES public.eo_product_types(id) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, product_type_id)
);

CREATE INDEX IF NOT EXISTS eo_product_type_assignments_type_idx
  ON public.eo_product_type_assignments(product_type_id);

CREATE TABLE IF NOT EXISTS public.eo_product_oils (
  product_id uuid NOT NULL REFERENCES public.eo_products(id) ON UPDATE CASCADE ON DELETE CASCADE,
  essential_oil_id uuid NOT NULL REFERENCES public.essential_oils(id) ON UPDATE CASCADE ON DELETE CASCADE,
  component_bubble_uid text NOT NULL,
  component_position integer,
  source_field text NOT NULL DEFAULT 'oil_product.singular_oils_inside',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, essential_oil_id)
);

CREATE INDEX IF NOT EXISTS eo_product_oils_essential_oil_idx
  ON public.eo_product_oils(essential_oil_id);

CREATE TEMP TABLE tmp_bubble_oil_products (
  data jsonb NOT NULL
) ON COMMIT DROP;

\copy tmp_bubble_oil_products(data) FROM '${productsFileForPsql}'

WITH categories AS (
  SELECT DISTINCT trim(category.value) AS name
  FROM tmp_bubble_oil_products t
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Category') = 'array' THEN t.data->'Category'
      ELSE '[]'::jsonb
    END
  ) AS category(value)
  WHERE nullif(trim(category.value), '') IS NOT NULL
)
INSERT INTO public.eo_product_types (name, slug, updated_at)
SELECT
  name,
  lower(regexp_replace(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')) AS slug,
  now()
FROM categories
ON CONFLICT (name) DO UPDATE
SET slug = EXCLUDED.slug,
    updated_at = now();

INSERT INTO public.eo_products (
  bubble_uid,
  main_product_bubble_uid,
  name_english,
  name_portuguese,
  image_url,
  product_number,
  anvisa_processo,
  official_url,
  country_code,
  unit_measure_bubble_uid,
  is_main_product,
  pv,
  regular_price,
  member_price,
  point_to_exchange,
  price_per_point,
  price_per_pv,
  price_per_drop,
  quantity,
  bottle_size_unit,
  color_label_bubble_uid,
  bubble_created_at,
  bubble_modified_at,
  bubble_raw,
  updated_at
)
SELECT
  data->>'_id' AS bubble_uid,
  data->>'main_product' AS main_product_bubble_uid,
  COALESCE(NULLIF(data->>'name_in_english', ''), NULLIF(data->>'name_in_portuguese', ''), data->>'_id') AS name_english,
  NULLIF(data->>'name_in_portuguese', '') AS name_portuguese,
  CASE
    WHEN data->>'img' LIKE '//%' THEN 'https:' || (data->>'img')
    ELSE NULLIF(data->>'img', '')
  END AS image_url,
  NULLIF(data->>'product_number', '') AS product_number,
  NULLIF(data->>'anvisa_processo', '') AS anvisa_processo,
  NULLIF(data->>'url_oficial', '') AS official_url,
  NULLIF(data->>'country_code', '') AS country_code,
  NULLIF(data->>'Unidade Medida', '') AS unit_measure_bubble_uid,
  NULLIF(data->>'Is_main_product', '')::boolean AS is_main_product,
  NULLIF(data->>'PV', '')::numeric AS pv,
  NULLIF(data->>'regular_price', '')::numeric AS regular_price,
  NULLIF(data->>'member_price', '')::numeric AS member_price,
  NULLIF(data->>'point_to_exchange', '')::numeric AS point_to_exchange,
  NULLIF(data->>'price_per_point', '')::numeric AS price_per_point,
  NULLIF(data->>'price_per_PV', '')::numeric AS price_per_pv,
  NULLIF(data->>'price_per_drop', '')::numeric AS price_per_drop,
  NULLIF(data->>'Quantidade', '')::numeric AS quantity,
  NULLIF(data->>'bottle_size_unit', '') AS bottle_size_unit,
  NULLIF(data->>'color-label', '') AS color_label_bubble_uid,
  NULLIF(data->>'Created Date', '')::timestamptz AS bubble_created_at,
  NULLIF(data->>'Modified Date', '')::timestamptz AS bubble_modified_at,
  data AS bubble_raw,
  now()
FROM tmp_bubble_oil_products
WHERE data ? '_id'
ON CONFLICT (bubble_uid) DO UPDATE
SET main_product_bubble_uid = EXCLUDED.main_product_bubble_uid,
    name_english = EXCLUDED.name_english,
    name_portuguese = EXCLUDED.name_portuguese,
    image_url = EXCLUDED.image_url,
    product_number = EXCLUDED.product_number,
    anvisa_processo = EXCLUDED.anvisa_processo,
    official_url = EXCLUDED.official_url,
    country_code = EXCLUDED.country_code,
    unit_measure_bubble_uid = EXCLUDED.unit_measure_bubble_uid,
    is_main_product = EXCLUDED.is_main_product,
    pv = EXCLUDED.pv,
    regular_price = EXCLUDED.regular_price,
    member_price = EXCLUDED.member_price,
    point_to_exchange = EXCLUDED.point_to_exchange,
    price_per_point = EXCLUDED.price_per_point,
    price_per_pv = EXCLUDED.price_per_pv,
    price_per_drop = EXCLUDED.price_per_drop,
    quantity = EXCLUDED.quantity,
    bottle_size_unit = EXCLUDED.bottle_size_unit,
    color_label_bubble_uid = EXCLUDED.color_label_bubble_uid,
    bubble_created_at = EXCLUDED.bubble_created_at,
    bubble_modified_at = EXCLUDED.bubble_modified_at,
    bubble_raw = EXCLUDED.bubble_raw,
    updated_at = now();

WITH first_categories AS (
  SELECT
    p.id AS product_id,
    pt.id AS product_type_id
  FROM tmp_bubble_oil_products t
  JOIN public.eo_products p ON p.bubble_uid = t.data->>'_id'
  CROSS JOIN LATERAL (
    SELECT category.value
    FROM jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(t.data->'Category') = 'array' THEN t.data->'Category'
        ELSE '[]'::jsonb
      END
    ) WITH ORDINALITY AS category(value, ordinality)
    WHERE nullif(trim(category.value), '') IS NOT NULL
    ORDER BY category.ordinality
    LIMIT 1
  ) first_category
  JOIN public.eo_product_types pt ON pt.name = trim(first_category.value)
)
UPDATE public.eo_products p
SET primary_product_type_id = fc.product_type_id,
    updated_at = now()
FROM first_categories fc
WHERE p.id = fc.product_id
  AND p.primary_product_type_id IS DISTINCT FROM fc.product_type_id;

UPDATE public.eo_products p
SET main_product_id = parent.id,
    updated_at = now()
FROM public.eo_products parent
WHERE p.main_product_bubble_uid = parent.bubble_uid
  AND p.main_product_id IS DISTINCT FROM parent.id;

UPDATE public.eo_products p
SET main_product_id = NULL,
    updated_at = now()
WHERE p.main_product_bubble_uid IS NULL
  AND p.main_product_id IS NOT NULL;

DELETE FROM public.eo_product_type_assignments pta
USING public.eo_products p
JOIN tmp_bubble_oil_products t ON t.data->>'_id' = p.bubble_uid
WHERE pta.product_id = p.id;

WITH categories AS (
  SELECT
    p.id AS product_id,
    trim(category.value) AS type_name
  FROM tmp_bubble_oil_products t
  JOIN public.eo_products p ON p.bubble_uid = t.data->>'_id'
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'Category') = 'array' THEN t.data->'Category'
      ELSE '[]'::jsonb
    END
  ) AS category(value)
  WHERE nullif(trim(category.value), '') IS NOT NULL
)
INSERT INTO public.eo_product_type_assignments (product_id, product_type_id)
SELECT c.product_id, pt.id
FROM categories c
JOIN public.eo_product_types pt ON pt.name = c.type_name
ON CONFLICT DO NOTHING;

DELETE FROM public.eo_product_oils epo
USING public.eo_products p
JOIN tmp_bubble_oil_products t ON t.data->>'_id' = p.bubble_uid
WHERE epo.product_id = p.id;

WITH direct_components AS (
  SELECT
    p.id AS product_id,
    component.value AS component_bubble_uid,
    component.ordinality::integer AS component_position
  FROM tmp_bubble_oil_products t
  JOIN public.eo_products p ON p.bubble_uid = t.data->>'_id'
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(t.data->'singular_oils_inside') = 'array' THEN t.data->'singular_oils_inside'
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS component(value, ordinality)
),
mapped_components AS (
  SELECT
    dc.product_id,
    eo.id AS essential_oil_id,
    min(dc.component_bubble_uid) AS component_bubble_uid,
    min(dc.component_position) AS component_position
  FROM direct_components dc
  JOIN public.essential_oils eo ON eo.bubble_uid = dc.component_bubble_uid
  GROUP BY dc.product_id, eo.id
)
INSERT INTO public.eo_product_oils (
  product_id,
  essential_oil_id,
  component_bubble_uid,
  component_position
)
SELECT
  product_id,
  essential_oil_id,
  component_bubble_uid,
  component_position
FROM mapped_components
ON CONFLICT (product_id, essential_oil_id) DO UPDATE
SET component_bubble_uid = EXCLUDED.component_bubble_uid,
    component_position = EXCLUDED.component_position;

WITH products_without_direct_components AS (
  SELECT p.*
  FROM public.eo_products p
  JOIN tmp_bubble_oil_products t ON t.data->>'_id' = p.bubble_uid
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.eo_product_oils epo
    WHERE epo.product_id = p.id
  )
),
exact_name_matches AS (
  SELECT
    p.id AS product_id,
    eo.id AS essential_oil_id,
    eo.bubble_uid AS component_bubble_uid
  FROM products_without_direct_components p
  JOIN public.essential_oils eo
    ON lower(regexp_replace(regexp_replace(p.name_english, '[®™]', '', 'g'), '[^a-zA-Z0-9]+', '', 'g'))
     = lower(regexp_replace(regexp_replace(eo.name_english, '[®™]', '', 'g'), '[^a-zA-Z0-9]+', '', 'g'))
)
INSERT INTO public.eo_product_oils (
  product_id,
  essential_oil_id,
  component_bubble_uid,
  component_position,
  source_field
)
SELECT
  product_id,
  essential_oil_id,
  component_bubble_uid,
  1 AS component_position,
  'inferred_from_exact_product_name' AS source_field
FROM exact_name_matches
ON CONFLICT (product_id, essential_oil_id) DO UPDATE
SET component_bubble_uid = EXCLUDED.component_bubble_uid,
    component_position = EXCLUDED.component_position,
    source_field = EXCLUDED.source_field;

CREATE OR REPLACE VIEW public.v_eo_product_oils_resolved AS
WITH direct_oils AS (
  SELECT
    epo.product_id,
    epo.essential_oil_id,
    epo.component_bubble_uid,
    epo.component_position,
    'direct'::text AS resolution_source
  FROM public.eo_product_oils epo
),
main_product_oils AS (
  SELECT
    p.id AS product_id,
    mpo.essential_oil_id,
    mpo.component_bubble_uid,
    mpo.component_position,
    'main_product'::text AS resolution_source
  FROM public.eo_products p
  JOIN public.eo_products parent ON parent.id = p.main_product_id
  JOIN public.eo_product_oils mpo ON mpo.product_id = parent.id
  WHERE p.id <> parent.id
    AND NOT EXISTS (
      SELECT 1
      FROM public.eo_product_oils direct
      WHERE direct.product_id = p.id
    )
)
SELECT * FROM direct_oils
UNION
SELECT * FROM main_product_oils;

ALTER TABLE public.eo_product_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eo_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eo_product_type_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eo_product_oils ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_can_view ON public.eo_product_types;
DROP POLICY IF EXISTS admin_can_manage ON public.eo_product_types;
CREATE POLICY anon_can_view ON public.eo_product_types FOR SELECT USING (true);
CREATE POLICY admin_can_manage ON public.eo_product_types
  FOR ALL USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

DROP POLICY IF EXISTS anon_can_view ON public.eo_products;
DROP POLICY IF EXISTS admin_can_manage ON public.eo_products;
CREATE POLICY anon_can_view ON public.eo_products FOR SELECT USING (true);
CREATE POLICY admin_can_manage ON public.eo_products
  FOR ALL USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

DROP POLICY IF EXISTS anon_can_view ON public.eo_product_type_assignments;
DROP POLICY IF EXISTS admin_can_manage ON public.eo_product_type_assignments;
CREATE POLICY anon_can_view ON public.eo_product_type_assignments FOR SELECT USING (true);
CREATE POLICY admin_can_manage ON public.eo_product_type_assignments
  FOR ALL USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

DROP POLICY IF EXISTS anon_can_view ON public.eo_product_oils;
DROP POLICY IF EXISTS admin_can_manage ON public.eo_product_oils;
CREATE POLICY anon_can_view ON public.eo_product_oils FOR SELECT USING (true);
CREATE POLICY admin_can_manage ON public.eo_product_oils
  FOR ALL USING (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));

GRANT ALL ON TABLE public.eo_product_types TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.eo_products TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.eo_product_type_assignments TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.eo_product_oils TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.v_eo_product_oils_resolved TO anon, authenticated, service_role;

COMMIT;

SELECT 'eo_products' AS table_name, count(*) AS rows FROM public.eo_products
UNION ALL
SELECT 'eo_product_types', count(*) FROM public.eo_product_types
UNION ALL
SELECT 'eo_product_type_assignments', count(*) FROM public.eo_product_type_assignments
UNION ALL
SELECT 'eo_product_oils', count(*) FROM public.eo_product_oils
UNION ALL
SELECT 'v_eo_product_oils_resolved', count(*) FROM public.v_eo_product_oils_resolved;
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

  const sourceComponentRefs = products.reduce(
    (total, product) =>
      total + (Array.isArray(product.singular_oils_inside) ? product.singular_oils_inside.length : 0),
    0,
  );

  const dbValidation = execFileSync(
    'psql',
    [
      databaseUrl,
      '-P',
      'pager=off',
      '-c',
      String.raw`
SELECT
  (SELECT count(*) FROM public.eo_products) AS supabase_products,
  (SELECT count(*) FROM public.eo_products WHERE primary_product_type_id IS NOT NULL) AS products_with_primary_type,
  (SELECT count(*) FROM public.eo_product_oils) AS supabase_product_oils,
  (SELECT count(*) FROM public.v_eo_product_oils_resolved) AS resolved_product_oils;
`,
    ],
    { encoding: 'utf8' },
  );

  process.stdout.write(`Bubble products fetched: ${products.length}\n`);
  process.stdout.write(`Bubble component refs fetched: ${sourceComponentRefs}\n`);
  process.stdout.write(dbValidation);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
