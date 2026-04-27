-- Draft migration for unifying action systems and body parts.
-- Generated: 2026-04-26
--
-- This file is intentionally a draft and has not been executed.
-- Review before applying to Supabase.
--
-- Goals:
-- 1. Represent body parts as eo_action_systems with action_type = 'body_part'.
-- 2. Preserve current eo_body_part UUIDs where possible.
-- 3. Preserve how-to-use -> body-part relationships in a new action-system bridge.
-- 4. Keep compatibility views for old consumers.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'eo_action_system_type'
  ) THEN
    CREATE TYPE eo_action_system_type AS ENUM (
      'body_system',
      'body_part',
      'functional_area',
      'therapeutic_goal',
      'life_stage',
      'use_context',
      'unknown'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS eo_action_systems (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bubble_uid text UNIQUE,
  name text NOT NULL,
  name_portuguese text,
  action_type eo_action_system_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Preserve old eo_body_part IDs as action-system IDs.
-- This keeps existing identity stable and makes compatibility simpler.
INSERT INTO eo_action_systems (
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
  'body_part'::eo_action_system_type AS action_type,
  created_at,
  now()
FROM eo_body_part
ON CONFLICT (id) DO UPDATE
SET
  bubble_uid = EXCLUDED.bubble_uid,
  name = EXCLUDED.name,
  name_portuguese = EXCLUDED.name_portuguese,
  action_type = EXCLUDED.action_type,
  updated_at = now();

CREATE TABLE IF NOT EXISTS essential_oil_how_to_use_action_systems (
  how_to_use_id uuid NOT NULL REFERENCES eo_how_to_use(id) ON DELETE CASCADE,
  action_system_id uuid NOT NULL REFERENCES eo_action_systems(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (how_to_use_id, action_system_id)
);

-- Migrate the existing how-to-use body-part bridge.
INSERT INTO essential_oil_how_to_use_action_systems (
  how_to_use_id,
  action_system_id,
  created_at
)
SELECT
  how_to_use_id,
  body_part_id AS action_system_id,
  created_at
FROM essential_oil_how_to_use_body_part
ON CONFLICT (how_to_use_id, action_system_id) DO NOTHING;

-- Compatibility view for read-only consumers that still expect eo_body_part-like shape.
-- Do not create this as eo_body_part while the original table exists.
CREATE OR REPLACE VIEW v_eo_body_part AS
SELECT
  id,
  created_at,
  name AS name_english,
  name_portuguese,
  bubble_uid
FROM eo_action_systems
WHERE action_type = 'body_part';

-- Compatibility view for read-only consumers of the old bridge.
CREATE OR REPLACE VIEW v_essential_oil_how_to_use_body_part AS
SELECT
  how_to_use_id,
  action_system_id AS body_part_id,
  created_at
FROM essential_oil_how_to_use_action_systems eas
JOIN eo_action_systems s
  ON s.id = eas.action_system_id
WHERE s.action_type = 'body_part';

COMMIT;
