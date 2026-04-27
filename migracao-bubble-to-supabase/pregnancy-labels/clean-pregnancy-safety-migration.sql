\set ON_ERROR_STOP on

BEGIN;

UPDATE public.eo_pregnancy_nursing_statuses
SET
  code = CASE status_description
    WHEN 'pregnancy-safe-3months' THEN 'pregnancy_safe_all_trimesters'
    WHEN 'pregnancy-safe-100' THEN 'pregnancy_safe_after_first_trimester_raw'
    WHEN 'pregnancy-safe-50' THEN 'pregnancy_professional_guidance'
    WHEN 'pregnancy-hora-do-parto' THEN 'pregnancy_labor_delivery'
    WHEN 'pregnancy-lactante' THEN 'lactation_guidance'
    ELSE code
  END,
  name = CASE status_description
    WHEN 'pregnancy-safe-3months' THEN 'Safe all trimesters'
    WHEN 'pregnancy-safe-100' THEN 'Safe after first trimester raw tag'
    WHEN 'pregnancy-safe-50' THEN 'Professional guidance'
    WHEN 'pregnancy-hora-do-parto' THEN 'Labor/delivery'
    WHEN 'pregnancy-lactante' THEN 'Lactation guidance'
    ELSE name
  END,
  description = CASE status_description
    WHEN 'pregnancy-safe-3months' THEN 'Oil is marked safe from the first trimester onward.'
    WHEN 'pregnancy-safe-100' THEN 'Legacy Bubble raw tag used by the second-to-third-trimester filter; app logic must exclude oils that also have pregnancy-safe-3months.'
    WHEN 'pregnancy-safe-50' THEN 'Oil is marked for use only with professional guidance.'
    WHEN 'pregnancy-hora-do-parto' THEN 'Oil is marked for labor or delivery context.'
    WHEN 'pregnancy-lactante' THEN 'Oil is marked for lactation-related guidance.'
    ELSE description
  END,
  usage_guidance = CASE status_description
    WHEN 'pregnancy-safe-3months' THEN 'Use as the all-trimesters pregnancy safety category.'
    WHEN 'pregnancy-safe-100' THEN 'Use as safe after first trimester only when the oil does not also have pregnancy-safe-3months.'
    WHEN 'pregnancy-safe-50' THEN 'Use as a professional-guidance flag/category depending on the oil safety profile.'
    WHEN 'pregnancy-hora-do-parto' THEN 'Use as an additive labor/delivery flag, not as a trimester safety category.'
    WHEN 'pregnancy-lactante' THEN 'Use as an additive lactation flag when populated.'
    ELSE usage_guidance
  END,
  updated_at = now()
WHERE status_description IN (
  'pregnancy-safe-3months',
  'pregnancy-safe-100',
  'pregnancy-safe-50',
  'pregnancy-hora-do-parto',
  'pregnancy-lactante'
);

CREATE OR REPLACE VIEW public.v_oil_pregnancy_safety_tags AS
SELECT
  o.id AS essential_oil_id,
  o.bubble_uid AS oil_bubble_uid,
  o.name_english AS oil_name_english,
  o.name_portuguese AS oil_name_portuguese,
  pns.id AS pregnancy_nursing_status_id,
  pns.code AS pregnancy_tag_code,
  pns.name AS pregnancy_tag_name,
  pns.status_description AS legacy_bubble_tag,
  pns.description AS pregnancy_tag_description,
  pns.usage_guidance AS pregnancy_tag_usage_guidance,
  eps.created_at AS linked_at
FROM public.essential_oils o
JOIN public.essential_oil_pregnancy_nursing_safety eps
  ON eps.essential_oil_id = o.id
JOIN public.eo_pregnancy_nursing_statuses pns
  ON pns.id = eps.pregnancy_nursing_status_id;

CREATE OR REPLACE VIEW public.v_oil_pregnancy_safety_profile AS
WITH flags AS (
  SELECT
    o.id AS essential_oil_id,
    o.bubble_uid AS oil_bubble_uid,
    o.name_english AS oil_name_english,
    o.name_portuguese AS oil_name_portuguese,
    COALESCE(bool_or(pns.status_description = 'pregnancy-safe-3months'), false) AS has_safe_all_trimesters_tag,
    COALESCE(bool_or(pns.status_description = 'pregnancy-safe-100'), false) AS has_safe_after_first_trimester_raw_tag,
    COALESCE(bool_or(pns.status_description = 'pregnancy-safe-50'), false) AS has_professional_guidance,
    COALESCE(bool_or(pns.status_description = 'pregnancy-hora-do-parto'), false) AS has_labor_delivery_guidance,
    COALESCE(bool_or(pns.status_description = 'pregnancy-lactante'), false) AS has_lactation_guidance,
    COALESCE(
      array_agg(DISTINCT pns.status_description ORDER BY pns.status_description)
        FILTER (WHERE pns.status_description IS NOT NULL),
      '{}'::text[]
    ) AS legacy_pregnancy_tags,
    COALESCE(
      array_agg(DISTINCT pns.code ORDER BY pns.code)
        FILTER (WHERE pns.code IS NOT NULL),
      '{}'::text[]
    ) AS pregnancy_tag_codes
  FROM public.essential_oils o
  LEFT JOIN public.essential_oil_pregnancy_nursing_safety eps
    ON eps.essential_oil_id = o.id
  LEFT JOIN public.eo_pregnancy_nursing_statuses pns
    ON pns.id = eps.pregnancy_nursing_status_id
  GROUP BY o.id, o.bubble_uid, o.name_english, o.name_portuguese
),
classified AS (
  SELECT
    *,
    has_safe_all_trimesters_tag AS matches_safe_all_trimesters_filter,
    (has_safe_after_first_trimester_raw_tag AND NOT has_safe_all_trimesters_tag) AS matches_safe_after_first_trimester_filter,
    has_professional_guidance AS matches_professional_guidance_filter
  FROM flags
)
SELECT
  essential_oil_id,
  oil_bubble_uid,
  oil_name_english,
  oil_name_portuguese,
  CASE
    WHEN matches_safe_all_trimesters_filter THEN 'pregnancy_safe_all_trimesters'
    WHEN matches_safe_after_first_trimester_filter THEN 'pregnancy_safe_after_first_trimester'
    WHEN has_professional_guidance THEN 'pregnancy_professional_guidance'
    ELSE 'pregnancy_no_guidance'
  END AS pregnancy_safety_category_code,
  CASE
    WHEN matches_safe_all_trimesters_filter THEN 'Safe all trimesters'
    WHEN matches_safe_after_first_trimester_filter THEN 'Safe after first trimester'
    WHEN has_professional_guidance THEN 'Professional guidance'
    ELSE 'No pregnancy guidance'
  END AS pregnancy_safety_category_name,
  matches_safe_all_trimesters_filter,
  matches_safe_after_first_trimester_filter,
  matches_professional_guidance_filter,
  has_safe_all_trimesters_tag,
  has_safe_after_first_trimester_raw_tag,
  has_professional_guidance,
  has_labor_delivery_guidance,
  has_lactation_guidance,
  legacy_pregnancy_tags,
  pregnancy_tag_codes
FROM classified;

COMMENT ON VIEW public.v_oil_pregnancy_safety_tags IS
  'Clean pregnancy safety tag names for each oil while preserving legacy Bubble pregnancy filter tags.';

COMMENT ON VIEW public.v_oil_pregnancy_safety_profile IS
  'One-row-per-oil pregnancy safety profile. The safe-after-first-trimester category matches Bubble pipeline logic: pregnancy-safe-100 AND NOT pregnancy-safe-3months.';

GRANT SELECT ON TABLE public.v_oil_pregnancy_safety_tags TO anon, authenticated, service_role;
GRANT SELECT ON TABLE public.v_oil_pregnancy_safety_profile TO anon, authenticated, service_role;

COMMIT;
