import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { getCachedJson, makeVersionedCacheKey } from '@/server/cache/redis';

export const dashboardRouter = createTRPCRouter({
  summary: protectedProcedure.query(async ({ ctx }) => {
    const result = await getCachedJson({
      key: await makeVersionedCacheKey('dashboard', 'summary'),
      ttlSeconds: 60,
      load: async () => {
        const [
          counts,
          recipeCompleteness,
          oilCoverage,
          healthConcernCoverage,
          chemistrySourceTypes,
          productCoverage
        ] = await Promise.all([
          ctx.db`
            select
              (select count(*)::int from public.essential_oils) as essential_oils,
              (select count(*)::int from public.chemical_compounds) as chemical_compounds,
              (select count(*)::int from public.eo_products) as products,
              (select count(*)::int from public.eo_health_concern_recipes) as recipes,
              (select count(*)::int from public.eo_health_concerns) as health_concerns,
              (select count(*)::int from public.eo_action_systems) as action_systems,
              (select count(*)::int from public.eo_therapeutic_properties) as therapeutic_properties
          `,
          ctx.db`
            select
              count(*)::int as total_recipes,
              count(*) filter (where reviewed_by_daiane)::int as reviewed,
              count(*) filter (where health_concern_id is null)::int as without_health_concern,
              count(*) filter (where not exists (
                select 1 from public.eo_health_concern_recipe_oils ro where ro.recipe_id = r.id
              ))::int as without_oils,
              count(*) filter (where not exists (
                select 1 from public.eo_health_concern_recipe_instructions ri where ri.recipe_id = r.id
              ))::int as without_instructions,
              count(*) filter (where not exists (
                select 1 from public.eo_health_concern_recipe_application_methods rm where rm.recipe_id = r.id
              ))::int as without_application_methods
            from public.eo_health_concern_recipes r
          `,
          ctx.db`
            select
              count(*)::int as total_oils,
              count(*) filter (where exists (
                select 1 from public.essential_oil_chemical_compounds x where x.essential_oil_id = eo.id
              ))::int as with_compounds,
              count(*) filter (where exists (
                select 1 from public.essential_oil_health_concern x where x.essential_oil_id = eo.id
              ))::int as with_health_concerns,
              count(*) filter (where exists (
                select 1 from public.essential_oil_therapeutic_properties x where x.essential_oil_id = eo.id
              ))::int as with_direct_properties,
              count(*) filter (where exists (
                select 1 from public.v_essential_oil_derived_therapeutic_properties x where x.essential_oil_id = eo.id
              ))::int as with_derived_properties,
              count(*) filter (where exists (
                select 1 from public.eo_product_oils x where x.essential_oil_id = eo.id
              ))::int as used_in_products,
              count(*) filter (where exists (
                select 1 from public.eo_health_concern_recipe_oils x where x.essential_oil_id = eo.id
              ))::int as used_in_recipes
            from public.essential_oils eo
          `,
          ctx.db`
            select
              count(*)::int as total_concerns,
              count(*) filter (where exists (
                select 1 from public.essential_oil_health_concern x where x.health_concern_id = hc.id
              ))::int as with_oils,
              count(*) filter (where exists (
                select 1 from public.eo_health_concern_recipes r where r.health_concern_id = hc.id
              ))::int as with_recipes,
              count(*) filter (where exists (
                select 1 from public.health_concern_action_systems x where x.health_concern_id = hc.id
              ))::int as with_action_systems
            from public.eo_health_concerns hc
          `,
          ctx.db`
            select source_type::text as source_type, count(*)::int as count
            from public.essential_oil_chemical_compounds
            group by source_type
            order by count desc, source_type
          `,
          ctx.db`
            select
              count(*)::int as total_products,
              count(*) filter (where exists (
                select 1 from public.v_eo_product_oils_resolved resolved where resolved.product_id = product.id
              ))::int as with_resolved_oils,
              count(*) filter (where not exists (
                select 1 from public.v_eo_product_oils_resolved resolved where resolved.product_id = product.id
              ))::int as without_resolved_oils
            from public.eo_products product
          `
        ]);

        return {
          counts: counts[0],
          recipeCompleteness: recipeCompleteness[0],
          oilCoverage: oilCoverage[0],
          healthConcernCoverage: healthConcernCoverage[0],
          chemistrySourceTypes,
          productCoverage: productCoverage[0]
        };
      }
    });

    return {
      ...result.data,
      cache: result.cache
    };
  })
});
