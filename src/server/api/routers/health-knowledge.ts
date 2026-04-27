import { z } from 'zod';
import { adminProcedure, createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { bumpCacheDomainVersions } from '@/server/cache/redis';

const paginatedSearchInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).optional()
});

const actionSystemTypeSchema = z.enum([
  'body_system',
  'body_part',
  'functional_area',
  'therapeutic_goal',
  'life_stage',
  'use_context',
  'unknown'
]);

const concernsListInput = paginatedSearchInput.extend({
  actionSystemId: z.string().uuid().optional(),
  hasRecipes: z.boolean().optional(),
  hasOils: z.boolean().optional()
});

const actionSystemsListInput = paginatedSearchInput.extend({
  actionType: actionSystemTypeSchema.optional()
});

const howToUseListInput = paginatedSearchInput.extend({
  applicationMethodId: z.string().uuid().optional()
});

const therapeuticPropertiesListInput = paginatedSearchInput.extend({
  source: z.enum(['direct', 'derived', 'both']).default('both')
});

const actionSystemInput = z.object({
  name: z.string().trim().min(1).max(180),
  namePortuguese: z.string().trim().max(180).optional(),
  actionType: actionSystemTypeSchema,
  bubbleUid: z.string().trim().max(160).optional()
});

const updateActionSystemInput = actionSystemInput.partial().extend({
  id: z.string().uuid()
});

const actionSystemLinkInput = z.object({
  healthConcernId: z.string().uuid(),
  actionSystemId: z.string().uuid(),
  sourceField: z.string().trim().max(160).default('admin')
});

const howToUseInput = z.object({
  name: z.string().trim().min(1).max(180),
  applicationMethodId: z.string().uuid(),
  instructions: z.string().trim().min(1).max(3000),
  subInstructions: z.string().trim().max(3000).optional(),
  subCategory: z.string().trim().max(180).optional(),
  bubbleUid: z.string().trim().max(160).optional()
});

const updateHowToUseInput = howToUseInput.partial().extend({
  id: z.string().uuid()
});

const howToUseConcernInput = z.object({
  howToUseId: z.string().uuid(),
  healthConcernId: z.string().uuid()
});

type CountRow = {
  count: string;
};

function offset(page: number, pageSize: number) {
  return (page - 1) * pageSize;
}

async function bumpHealthKnowledgeCaches() {
  await bumpCacheDomainVersions(['healthKnowledge', 'oils', 'dashboard']);
}

export const healthKnowledgeRouter = createTRPCRouter({
  concernsList: protectedProcedure.input(concernsListInput).query(async ({ ctx, input }) => {
    const searchPattern = input.search ? `%${input.search}%` : null;

    const rows = await ctx.db`
      select
        concern.id::text,
        concern.benefit_name,
        concern.name_english,
        concern.name_portuguese,
        concern.description_portuguese,
        concern.body_system_portuguese,
        (select count(*)::int from public.essential_oil_health_concern x where x.health_concern_id = concern.id) as oil_count,
        (select count(*)::int from public.eo_health_concern_recipes x where x.health_concern_id = concern.id) as recipe_count,
        (select count(*)::int from public.health_concern_action_systems x where x.health_concern_id = concern.id) as action_system_count,
        (select count(*)::int from public.essential_oil_how_to_use_health_concern x where x.health_concern_id = concern.id) as how_to_use_count
      from public.eo_health_concerns concern
      where
        (
          ${searchPattern}::text is null
          or concern.benefit_name ilike ${searchPattern}
          or concern.name_english ilike ${searchPattern}
          or concern.name_portuguese ilike ${searchPattern}
        )
        and (${input.actionSystemId ?? null}::uuid is null or exists (
          select 1 from public.health_concern_action_systems link
          where link.health_concern_id = concern.id and link.action_system_id = ${input.actionSystemId ?? null}
        ))
        and (${input.hasRecipes ?? null}::boolean is null or (
          ${input.hasRecipes ?? null} = true and exists (
            select 1 from public.eo_health_concern_recipes recipe where recipe.health_concern_id = concern.id
          )
        ) or (
          ${input.hasRecipes ?? null} = false and not exists (
            select 1 from public.eo_health_concern_recipes recipe where recipe.health_concern_id = concern.id
          )
        ))
        and (${input.hasOils ?? null}::boolean is null or (
          ${input.hasOils ?? null} = true and exists (
            select 1 from public.essential_oil_health_concern oil_link where oil_link.health_concern_id = concern.id
          )
        ) or (
          ${input.hasOils ?? null} = false and not exists (
            select 1 from public.essential_oil_health_concern oil_link where oil_link.health_concern_id = concern.id
          )
        ))
      order by lower(concern.benefit_name)
      limit ${input.pageSize}
      offset ${offset(input.page, input.pageSize)}
    `;

    const [totalRow] = await ctx.db<CountRow[]>`
      select count(*)::text as count
      from public.eo_health_concerns concern
      where
        (
          ${searchPattern}::text is null
          or concern.benefit_name ilike ${searchPattern}
          or concern.name_english ilike ${searchPattern}
          or concern.name_portuguese ilike ${searchPattern}
        )
        and (${input.actionSystemId ?? null}::uuid is null or exists (
          select 1 from public.health_concern_action_systems link
          where link.health_concern_id = concern.id and link.action_system_id = ${input.actionSystemId ?? null}
        ))
    `;

    return {
      items: rows,
      page: input.page,
      pageSize: input.pageSize,
      total: Number(totalRow?.count ?? 0)
    };
  }),

  concernDetail: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [concern] = await ctx.db`
      select
        id::text,
        benefit_name,
        name_english,
        name_portuguese,
        description_portuguese,
        body_system_portuguese,
        therapeutic_properties_portuguese,
        bubble_id
      from public.eo_health_concerns
      where id = ${input.id}
      limit 1
    `;

      if (!concern) return null;

      const [oils, recipes, actionSystems, usage] = await Promise.all([
        ctx.db`
        select oil.id::text, oil.name_english, oil.name_portuguese
        from public.essential_oil_health_concern link
        join public.essential_oils oil on oil.id = link.essential_oil_id
        where link.health_concern_id = ${input.id}
        order by oil.name_english
      `,
        ctx.db`
        select id::text, recipe_title, reviewed_by_daiane
        from public.eo_health_concern_recipes
        where health_concern_id = ${input.id}
        order by recipe_title nulls last
        limit 100
      `,
        ctx.db`
        select action_system.id::text, action_system.name, action_system.name_portuguese,
          action_system.action_type::text
        from public.health_concern_action_systems link
        join public.eo_action_systems action_system on action_system.id = link.action_system_id
        where link.health_concern_id = ${input.id}
        order by action_system.action_type::text, action_system.name
      `,
        ctx.db`
        select how_to_use.id::text, how_to_use.name, method.name as application_method,
          how_to_use.instructions, how_to_use.sub_instructions, how_to_use.sub_category
        from public.essential_oil_how_to_use_health_concern link
        join public.eo_how_to_use how_to_use on how_to_use.id = link.how_to_use_id
        join public.eo_application_methods method on method.id = how_to_use.application_method_id
        where link.health_concern_id = ${input.id}
        order by method.position nulls last, how_to_use.name
      `
      ]);

      return { concern, oils, recipes, actionSystems, usage };
    }),

  concernUsage: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db`
      select *
      from public.v_oil_usage_recommendations
      where health_concern_id = ${input.id}
      order by application_order nulls last, oil_name_english, how_to_use_name
    `;
    }),

  actionSystemsList: protectedProcedure
    .input(actionSystemsListInput)
    .query(async ({ ctx, input }) => {
      const searchPattern = input.search ? `%${input.search}%` : null;

      const rows = await ctx.db`
      select
        action_system.id::text,
        action_system.name,
        action_system.name_portuguese,
        action_system.action_type::text,
        (select count(*)::int from public.essential_oil_action_systems x where x.action_system_id = action_system.id) as oil_count,
        (select count(*)::int from public.health_concern_action_systems x where x.action_system_id = action_system.id) as health_concern_count
      from public.eo_action_systems action_system
      where
        (${searchPattern}::text is null or action_system.name ilike ${searchPattern} or action_system.name_portuguese ilike ${searchPattern})
        and (${input.actionType ?? null}::text is null or action_system.action_type = ${input.actionType ?? null}::eo_action_system_type)
      order by action_system.action_type::text, action_system.name
      limit ${input.pageSize}
      offset ${offset(input.page, input.pageSize)}
    `;

      const [totalRow] = await ctx.db<CountRow[]>`
      select count(*)::text as count
      from public.eo_action_systems action_system
      where
        (${searchPattern}::text is null or action_system.name ilike ${searchPattern} or action_system.name_portuguese ilike ${searchPattern})
        and (${input.actionType ?? null}::text is null or action_system.action_type = ${input.actionType ?? null}::eo_action_system_type)
    `;

      return {
        items: rows,
        page: input.page,
        pageSize: input.pageSize,
        total: Number(totalRow?.count ?? 0)
      };
    }),

  actionSystemDetail: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [actionSystem] = await ctx.db`
      select id::text, name, name_portuguese, action_type::text, bubble_uid
      from public.eo_action_systems
      where id = ${input.id}
      limit 1
    `;

      if (!actionSystem) return null;

      const [oils, concerns] = await Promise.all([
        ctx.db`
        select oil.id::text, oil.name_english, oil.name_portuguese
        from public.essential_oil_action_systems link
        join public.essential_oils oil on oil.id = link.essential_oil_id
        where link.action_system_id = ${input.id}
        order by oil.name_english
      `,
        ctx.db`
        select concern.id::text, concern.benefit_name, concern.name_portuguese
        from public.health_concern_action_systems link
        join public.eo_health_concerns concern on concern.id = link.health_concern_id
        where link.action_system_id = ${input.id}
        order by concern.benefit_name
      `
      ]);

      return { actionSystem, oils, concerns };
    }),

  howToUseList: protectedProcedure.input(howToUseListInput).query(async ({ ctx, input }) => {
    const searchPattern = input.search ? `%${input.search}%` : null;

    return ctx.db`
      select
        how_to_use.id::text,
        how_to_use.name,
        method.name as application_method,
        how_to_use.sub_category,
        how_to_use.instructions,
        (select count(*)::int from public.essential_oil_how_to_use_health_concern x where x.how_to_use_id = how_to_use.id) as health_concern_count
      from public.eo_how_to_use how_to_use
      join public.eo_application_methods method on method.id = how_to_use.application_method_id
      where
        (${searchPattern}::text is null or how_to_use.name ilike ${searchPattern} or how_to_use.instructions ilike ${searchPattern})
        and (${input.applicationMethodId ?? null}::uuid is null or how_to_use.application_method_id = ${input.applicationMethodId ?? null})
      order by method.position nulls last, how_to_use.name
      limit ${input.pageSize}
      offset ${offset(input.page, input.pageSize)}
    `;
  }),

  therapeuticPropertiesList: protectedProcedure
    .input(therapeuticPropertiesListInput)
    .query(async ({ ctx, input }) => {
      const searchPattern = input.search ? `%${input.search}%` : null;

      return ctx.db`
        select
          property.id::text,
          property.property_name,
          property.property_name_portuguese,
          property.description,
          (select count(*)::int from public.essential_oil_therapeutic_properties direct where direct.property_id = property.id) as direct_oil_count,
          (select count(*)::int from public.v_essential_oil_derived_therapeutic_properties derived where derived.property_id = property.id) as derived_oil_count,
          (select count(*)::int from public.chemical_compound_therapeutic_properties compound_link where compound_link.therapeutic_property_id = property.id) as compound_count
        from public.eo_therapeutic_properties property
        where
          (${searchPattern}::text is null or property.property_name ilike ${searchPattern} or property.property_name_portuguese ilike ${searchPattern})
          and (
            ${input.source} = 'both'
            or (${input.source} = 'direct' and exists (
              select 1 from public.essential_oil_therapeutic_properties direct where direct.property_id = property.id
            ))
            or (${input.source} = 'derived' and exists (
              select 1 from public.v_essential_oil_derived_therapeutic_properties derived where derived.property_id = property.id
            ))
          )
        order by lower(property.property_name)
        limit ${input.pageSize}
        offset ${offset(input.page, input.pageSize)}
      `;
    }),

  therapeuticPropertyDetail: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [property] = await ctx.db`
        select id::text, property_name, property_name_portuguese, description, description_portuguese, bubble_uid
        from public.eo_therapeutic_properties
        where id = ${input.id}
        limit 1
      `;

      if (!property) return null;

      const [directOils, derivedOils, compounds] = await Promise.all([
        ctx.db`
          select oil.id::text, oil.name_english, oil.name_portuguese
          from public.essential_oil_therapeutic_properties link
          join public.essential_oils oil on oil.id = link.essential_oil_id
          where link.property_id = ${input.id}
          order by oil.name_english
        `,
        ctx.db`
          select derived.essential_oil_id::text, oil.name_english, oil.name_portuguese,
            derived.chemical_compound_count, derived.has_official_compound_evidence,
            derived.compound_source_types
          from public.v_essential_oil_derived_therapeutic_properties derived
          join public.essential_oils oil on oil.id = derived.essential_oil_id
          where derived.property_id = ${input.id}
          order by oil.name_english
        `,
        ctx.db`
          select compound.id::text, compound.name, link.source_type::text, link.source_reference
          from public.chemical_compound_therapeutic_properties link
          join public.chemical_compounds compound on compound.id = link.chemical_compound_id
          where link.therapeutic_property_id = ${input.id}
          order by compound.name
        `
      ]);

      return { property, directOils, derivedOils, compounds };
    }),

  facets: protectedProcedure.query(async ({ ctx }) => {
    const [actionSystems, actionSystemTypes, applicationMethods] = await Promise.all([
      ctx.db`
        select id::text, name, name_portuguese, action_type::text
        from public.eo_action_systems
        order by action_type::text, name
      `,
      ctx.db`
        select action_type::text, count(*)::int as count
        from public.eo_action_systems
        group by action_type
        order by action_type::text
      `,
      ctx.db`
        select id::text, name, description, position
        from public.eo_application_methods
        order by position nulls last, name
      `
    ]);

    return { actionSystems, actionSystemTypes, applicationMethods };
  }),

  createActionSystem: adminProcedure.input(actionSystemInput).mutation(async ({ ctx, input }) => {
    const [actionSystem] = await ctx.db`
      insert into public.eo_action_systems (name, name_portuguese, action_type, bubble_uid, updated_at)
      values (${input.name}, ${input.namePortuguese ?? null}, ${input.actionType}::eo_action_system_type, ${input.bubbleUid ?? null}, now())
      on conflict (bubble_uid) do update
      set name = excluded.name, name_portuguese = excluded.name_portuguese, action_type = excluded.action_type, updated_at = now()
      returning id::text, name, name_portuguese, action_type::text, bubble_uid
    `;

    await bumpHealthKnowledgeCaches();
    return actionSystem;
  }),

  updateActionSystem: adminProcedure
    .input(updateActionSystemInput)
    .mutation(async ({ ctx, input }) => {
      const [actionSystem] = await ctx.db`
      update public.eo_action_systems
      set
        name = coalesce(${input.name ?? null}, name),
        name_portuguese = coalesce(${input.namePortuguese ?? null}, name_portuguese),
        action_type = coalesce(${input.actionType ?? null}::eo_action_system_type, action_type),
        bubble_uid = coalesce(${input.bubbleUid ?? null}, bubble_uid),
        updated_at = now()
      where id = ${input.id}
      returning id::text, name, name_portuguese, action_type::text, bubble_uid
    `;

      await bumpHealthKnowledgeCaches();
      return actionSystem ?? null;
    }),

  linkConcernActionSystem: adminProcedure
    .input(actionSystemLinkInput)
    .mutation(async ({ ctx, input }) => {
      const [link] = await ctx.db`
      insert into public.health_concern_action_systems (health_concern_id, action_system_id, source_field)
      values (${input.healthConcernId}, ${input.actionSystemId}, ${input.sourceField})
      on conflict (health_concern_id, action_system_id) do update
      set source_field = excluded.source_field
      returning health_concern_id::text, action_system_id::text, source_field
    `;

      await bumpHealthKnowledgeCaches();
      return link;
    }),

  unlinkConcernActionSystem: adminProcedure
    .input(actionSystemLinkInput)
    .mutation(async ({ ctx, input }) => {
      const [link] = await ctx.db`
      delete from public.health_concern_action_systems
      where health_concern_id = ${input.healthConcernId} and action_system_id = ${input.actionSystemId}
      returning health_concern_id::text, action_system_id::text
    `;

      await bumpHealthKnowledgeCaches();
      return { deleted: Boolean(link), link: link ?? null };
    }),

  createHowToUse: adminProcedure.input(howToUseInput).mutation(async ({ ctx, input }) => {
    const [howToUse] = await ctx.db`
      insert into public.eo_how_to_use (
        name,
        application_method_id,
        instructions,
        sub_instructions,
        sub_category,
        bubble_uid,
        updated_at
      )
      values (
        ${input.name},
        ${input.applicationMethodId},
        ${input.instructions},
        ${input.subInstructions ?? null},
        ${input.subCategory ?? null},
        ${input.bubbleUid ?? null},
        now()
      )
      on conflict (name) do update
      set
        application_method_id = excluded.application_method_id,
        instructions = excluded.instructions,
        sub_instructions = excluded.sub_instructions,
        sub_category = excluded.sub_category,
        bubble_uid = excluded.bubble_uid,
        updated_at = now()
      returning id::text, name, application_method_id::text, instructions, sub_instructions, sub_category, bubble_uid
    `;

    await bumpHealthKnowledgeCaches();
    return howToUse;
  }),

  updateHowToUse: adminProcedure.input(updateHowToUseInput).mutation(async ({ ctx, input }) => {
    const [howToUse] = await ctx.db`
      update public.eo_how_to_use
      set
        name = coalesce(${input.name ?? null}, name),
        application_method_id = coalesce(${input.applicationMethodId ?? null}::uuid, application_method_id),
        instructions = coalesce(${input.instructions ?? null}, instructions),
        sub_instructions = coalesce(${input.subInstructions ?? null}, sub_instructions),
        sub_category = coalesce(${input.subCategory ?? null}, sub_category),
        bubble_uid = coalesce(${input.bubbleUid ?? null}, bubble_uid),
        updated_at = now()
      where id = ${input.id}
      returning id::text, name, application_method_id::text, instructions, sub_instructions, sub_category, bubble_uid
    `;

    await bumpHealthKnowledgeCaches();
    return howToUse ?? null;
  }),

  linkHowToUseConcern: adminProcedure
    .input(howToUseConcernInput)
    .mutation(async ({ ctx, input }) => {
      const [link] = await ctx.db`
      insert into public.essential_oil_how_to_use_health_concern (how_to_use_id, health_concern_id)
      values (${input.howToUseId}, ${input.healthConcernId})
      on conflict (how_to_use_id, health_concern_id) do nothing
      returning how_to_use_id::text, health_concern_id::text
    `;

      await bumpHealthKnowledgeCaches();
      return link ?? { how_to_use_id: input.howToUseId, health_concern_id: input.healthConcernId };
    }),

  unlinkHowToUseConcern: adminProcedure
    .input(howToUseConcernInput)
    .mutation(async ({ ctx, input }) => {
      const [link] = await ctx.db`
      delete from public.essential_oil_how_to_use_health_concern
      where how_to_use_id = ${input.howToUseId} and health_concern_id = ${input.healthConcernId}
      returning how_to_use_id::text, health_concern_id::text
    `;

      await bumpHealthKnowledgeCaches();
      return { deleted: Boolean(link), link: link ?? null };
    })
});
