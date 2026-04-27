import { z } from 'zod';
import { assertLocalMutationEnabled } from '@/server/api/mutation-guards';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';

const cleanupInput = z.object({
  prefix: z.string().trim().min(8).max(120).default('CODEX_DELETE_ME_TRPC_'),
  includeLegacyCodexLavender: z.boolean().default(false)
});

type CountRow = {
  count: string;
};

async function deleteCount<T>(rows: T[]) {
  return rows.length;
}

export const testDataRouter = createTRPCRouter({
  cleanup: protectedProcedure.input(cleanupInput).mutation(async ({ ctx, input }) => {
    assertLocalMutationEnabled();

    const prefixPattern = `${input.prefix}%`;
    const oilPattern = input.includeLegacyCodexLavender
      ? 'Codex API Test Lavender %'
      : prefixPattern;

    return ctx.db.begin(async (tx) => {
      const fakeRecipes = tx<{ id: string }[]>`
        select id::text
        from public.eo_health_concern_recipes
        where bubble_uid like ${prefixPattern}
      `;
      const fakeOils = tx<{ id: string }[]>`
        select id::text
        from public.essential_oils
        where name_english like ${prefixPattern}
          or (${input.includeLegacyCodexLavender} and name_english like ${oilPattern})
      `;
      const fakeCompounds = tx<{ id: string }[]>`
        select id::text
        from public.chemical_compounds
        where name like ${prefixPattern}
      `;
      const fakeProperties = tx<{ id: string }[]>`
        select id::text
        from public.eo_therapeutic_properties
        where property_name like ${prefixPattern}
      `;
      const fakeHealthConcerns = tx<{ id: string }[]>`
        select id::text
        from public.eo_health_concerns
        where benefit_name like ${prefixPattern}
      `;
      const fakeApplicationMethods = tx<{ id: string }[]>`
        select id::text
        from public.eo_application_methods
        where name like ${prefixPattern}
      `;
      const fakeProducts = tx<{ id: string }[]>`
        select id::text
        from public.eo_products
        where bubble_uid like ${prefixPattern}
          or name_english like ${prefixPattern}
      `;

      const [
        recipeIds,
        oilIds,
        compoundIds,
        propertyIds,
        healthConcernIds,
        applicationMethodIds,
        productIds
      ] = await Promise.all([
        fakeRecipes,
        fakeOils,
        fakeCompounds,
        fakeProperties,
        fakeHealthConcerns,
        fakeApplicationMethods,
        fakeProducts
      ]);

      const recipeIdList = recipeIds.map((row) => row.id);
      const oilIdList = oilIds.map((row) => row.id);
      const compoundIdList = compoundIds.map((row) => row.id);
      const propertyIdList = propertyIds.map((row) => row.id);
      const healthConcernIdList = healthConcernIds.map((row) => row.id);
      const applicationMethodIdList = applicationMethodIds.map((row) => row.id);
      const productIdList = productIds.map((row) => row.id);

      const deletedRecipeApplicationMethods = await tx`
        delete from public.eo_health_concern_recipe_application_methods
        where
          ${recipeIdList.length > 0} and recipe_id = any(${recipeIdList}::uuid[])
          or ${applicationMethodIdList.length > 0} and application_method_id = any(${applicationMethodIdList}::uuid[])
        returning id
      `;

      const deletedRecipeInstructions = await tx`
        delete from public.eo_health_concern_recipe_instructions
        where ${recipeIdList.length > 0} and recipe_id = any(${recipeIdList}::uuid[])
        returning id
      `;

      const deletedRecipeOils = await tx`
        delete from public.eo_health_concern_recipe_oils
        where
          ${recipeIdList.length > 0} and recipe_id = any(${recipeIdList}::uuid[])
          or ${oilIdList.length > 0} and essential_oil_id = any(${oilIdList}::uuid[])
        returning recipe_id
      `;

      const deletedProductOils = await tx`
        delete from public.eo_product_oils
        where
          ${productIdList.length > 0} and product_id = any(${productIdList}::uuid[])
          or ${oilIdList.length > 0} and essential_oil_id = any(${oilIdList}::uuid[])
        returning product_id
      `;

      const deletedProductTypeAssignments = await tx`
        delete from public.eo_product_type_assignments
        where ${productIdList.length > 0} and product_id = any(${productIdList}::uuid[])
        returning product_id
      `;

      const deletedRecipes = await tx`
        delete from public.eo_health_concern_recipes
        where ${recipeIdList.length > 0} and id = any(${recipeIdList}::uuid[])
        returning id
      `;

      const deletedCompoundProperties = await tx`
        delete from public.chemical_compound_therapeutic_properties
        where
          ${compoundIdList.length > 0} and chemical_compound_id = any(${compoundIdList}::uuid[])
          or ${propertyIdList.length > 0} and therapeutic_property_id = any(${propertyIdList}::uuid[])
        returning chemical_compound_id
      `;

      const deletedOilCompounds = await tx`
        delete from public.essential_oil_chemical_compounds
        where
          ${oilIdList.length > 0} and essential_oil_id = any(${oilIdList}::uuid[])
          or ${compoundIdList.length > 0} and chemical_compound_id = any(${compoundIdList}::uuid[])
          or bubble_id like ${prefixPattern}
        returning essential_oil_id
      `;

      const deletedOilProperties = await tx`
        delete from public.essential_oil_therapeutic_properties
        where
          ${oilIdList.length > 0} and essential_oil_id = any(${oilIdList}::uuid[])
          or ${propertyIdList.length > 0} and property_id = any(${propertyIdList}::uuid[])
        returning essential_oil_id
      `;

      const deletedOilHealthConcerns = await tx`
        delete from public.essential_oil_health_concern
        where
          ${oilIdList.length > 0} and essential_oil_id = any(${oilIdList}::uuid[])
          or ${healthConcernIdList.length > 0} and health_concern_id = any(${healthConcernIdList}::uuid[])
        returning essential_oil_id
      `;

      const deletedOilApplicationMethods = await tx`
        delete from public.essential_oil_application_methods
        where
          ${oilIdList.length > 0} and essential_oil_id = any(${oilIdList}::uuid[])
          or ${applicationMethodIdList.length > 0} and application_method_id = any(${applicationMethodIdList}::uuid[])
        returning essential_oil_id
      `;

      const deletedOilPregnancyStatuses = await tx`
        delete from public.essential_oil_pregnancy_nursing_safety
        where ${oilIdList.length > 0} and essential_oil_id = any(${oilIdList}::uuid[])
        returning essential_oil_id
      `;

      const deletedOilChildSafety = await tx`
        delete from public.essential_oil_child_safety
        where ${oilIdList.length > 0} and essential_oil_id = any(${oilIdList}::uuid[])
        returning essential_oil_id
      `;

      const deletedOilPetSafety = await tx`
        delete from public.essential_oil_pet_safety
        where ${oilIdList.length > 0} and essential_oil_id = any(${oilIdList}::uuid[])
        returning essential_oil_id
      `;

      const deletedOilActionSystems = await tx`
        delete from public.essential_oil_action_systems
        where ${oilIdList.length > 0} and essential_oil_id = any(${oilIdList}::uuid[])
        returning essential_oil_id
      `;

      const deletedCompounds = await tx`
        delete from public.chemical_compounds
        where ${compoundIdList.length > 0} and id = any(${compoundIdList}::uuid[])
        returning id
      `;

      const deletedProperties = await tx`
        delete from public.eo_therapeutic_properties
        where ${propertyIdList.length > 0} and id = any(${propertyIdList}::uuid[])
        returning id
      `;

      const deletedHealthConcerns = await tx`
        delete from public.eo_health_concerns
        where ${healthConcernIdList.length > 0} and id = any(${healthConcernIdList}::uuid[])
        returning id
      `;

      const deletedApplicationMethods = await tx`
        delete from public.eo_application_methods
        where ${applicationMethodIdList.length > 0} and id = any(${applicationMethodIdList}::uuid[])
        returning id
      `;

      const deletedProducts = await tx`
        delete from public.eo_products
        where ${productIdList.length > 0} and id = any(${productIdList}::uuid[])
        returning id
      `;

      const deletedOils = await tx`
        delete from public.essential_oils
        where ${oilIdList.length > 0} and id = any(${oilIdList}::uuid[])
        returning id
      `;

      return {
        deleted: {
          recipeApplicationMethods: await deleteCount(deletedRecipeApplicationMethods),
          recipeInstructions: await deleteCount(deletedRecipeInstructions),
          recipeOils: await deleteCount(deletedRecipeOils),
          productOils: await deleteCount(deletedProductOils),
          productTypeAssignments: await deleteCount(deletedProductTypeAssignments),
          recipes: await deleteCount(deletedRecipes),
          compoundTherapeuticProperties: await deleteCount(deletedCompoundProperties),
          oilCompounds: await deleteCount(deletedOilCompounds),
          oilTherapeuticProperties: await deleteCount(deletedOilProperties),
          oilHealthConcerns: await deleteCount(deletedOilHealthConcerns),
          oilApplicationMethods: await deleteCount(deletedOilApplicationMethods),
          oilPregnancyStatuses: await deleteCount(deletedOilPregnancyStatuses),
          oilChildSafety: await deleteCount(deletedOilChildSafety),
          oilPetSafety: await deleteCount(deletedOilPetSafety),
          oilActionSystems: await deleteCount(deletedOilActionSystems),
          compounds: await deleteCount(deletedCompounds),
          therapeuticProperties: await deleteCount(deletedProperties),
          healthConcerns: await deleteCount(deletedHealthConcerns),
          applicationMethods: await deleteCount(deletedApplicationMethods),
          products: await deleteCount(deletedProducts),
          oils: await deleteCount(deletedOils)
        }
      };
    });
  }),

  countByPrefix: protectedProcedure.input(cleanupInput).query(async ({ ctx, input }) => {
    const prefixPattern = `${input.prefix}%`;
    const oilPattern = input.includeLegacyCodexLavender
      ? 'Codex API Test Lavender %'
      : prefixPattern;

    const [oils] = await ctx.db<CountRow[]>`
      select count(*)::text as count
      from public.essential_oils
      where name_english like ${prefixPattern}
        or (${input.includeLegacyCodexLavender} and name_english like ${oilPattern})
    `;
    const [healthConcerns] = await ctx.db<CountRow[]>`
      select count(*)::text as count
      from public.eo_health_concerns
      where benefit_name like ${prefixPattern}
    `;
    const [therapeuticProperties] = await ctx.db<CountRow[]>`
      select count(*)::text as count
      from public.eo_therapeutic_properties
      where property_name like ${prefixPattern}
    `;
    const [compounds] = await ctx.db<CountRow[]>`
      select count(*)::text as count
      from public.chemical_compounds
      where name like ${prefixPattern}
    `;
    const [recipes] = await ctx.db<CountRow[]>`
      select count(*)::text as count
      from public.eo_health_concern_recipes
      where bubble_uid like ${prefixPattern}
    `;
    const [applicationMethods] = await ctx.db<CountRow[]>`
      select count(*)::text as count
      from public.eo_application_methods
      where name like ${prefixPattern}
    `;
    const [products] = await ctx.db<CountRow[]>`
      select count(*)::text as count
      from public.eo_products
      where bubble_uid like ${prefixPattern}
        or name_english like ${prefixPattern}
    `;

    return {
      oils: Number(oils?.count ?? 0),
      healthConcerns: Number(healthConcerns?.count ?? 0),
      therapeuticProperties: Number(therapeuticProperties?.count ?? 0),
      compounds: Number(compounds?.count ?? 0),
      recipes: Number(recipes?.count ?? 0),
      applicationMethods: Number(applicationMethods?.count ?? 0),
      products: Number(products?.count ?? 0)
    };
  })
});
