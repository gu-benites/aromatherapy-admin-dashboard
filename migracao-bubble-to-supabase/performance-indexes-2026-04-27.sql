-- Performance indexes for the admin/dashboard tRPC API.
-- Run outside an explicit transaction because CREATE INDEX CONCURRENTLY cannot run in a transaction block.
-- These indexes target existing-data tables and current API query paths only.

-- Dashboard recipe-completeness checks use "exists where recipe_id = ...".
-- Existing recipe/application-method indexes were partial/composite and did not cover every recipe_id lookup.
create index concurrently if not exists eo_hc_recipe_application_methods_recipe_idx
  on public.eo_health_concern_recipe_application_methods (recipe_id);

-- Health knowledge screens filter/list oils by therapeutic property.
-- The primary key is (essential_oil_id, property_id), so reverse lookups need this order.
create index concurrently if not exists essential_oil_therapeutic_properties_property_idx
  on public.essential_oil_therapeutic_properties (property_id, essential_oil_id);

-- Oil list/editor screens can filter oils by application method.
-- The primary key is (essential_oil_id, application_method_id), so reverse lookups need this order.
create index concurrently if not exists essential_oil_application_methods_method_idx
  on public.essential_oil_application_methods (application_method_id, essential_oil_id);

-- Future safety faceting can list oils by pregnancy/nursing status.
-- The primary key is (essential_oil_id, pregnancy_nursing_status_id).
create index concurrently if not exists essential_oil_pregnancy_nursing_safety_status_idx
  on public.essential_oil_pregnancy_nursing_safety (pregnancy_nursing_status_id, essential_oil_id);

-- Oil detail report counts match report rows by lower(oil_name).
create index concurrently if not exists essential_oil_reports_lower_oil_name_idx
  on public.essential_oil_reports (lower(oil_name));

analyze public.eo_health_concern_recipe_application_methods;
analyze public.essential_oil_therapeutic_properties;
analyze public.essential_oil_application_methods;
analyze public.essential_oil_pregnancy_nursing_safety;
analyze public.essential_oil_reports;
