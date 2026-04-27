import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { adminProcedure, createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { bumpCacheDomainVersions } from '@/server/cache/redis';

const createHealthConcernInput = z.object({
  benefitName: z.string().trim().min(1).max(180),
  nameEnglish: z.string().trim().min(1).max(180).optional(),
  namePortuguese: z.string().trim().min(1).max(180).optional(),
  descriptionPortuguese: z.string().trim().max(2000).optional(),
  bodySystemPortuguese: z.string().trim().max(300).optional(),
  therapeuticPropertiesPortuguese: z.string().trim().max(1000).optional(),
  bubbleId: z.string().trim().max(120).optional()
});

const linkOilInput = z.object({
  essentialOilId: z.string().uuid(),
  healthConcernId: z.string().uuid()
});

const updateHealthConcernInput = createHealthConcernInput.partial().extend({
  id: z.string().uuid()
});

const hardDeleteInput = z.object({
  id: z.string().uuid(),
  confirmation: z.literal('EXCLUIR')
});

type HealthConcernRow = {
  id: string;
  benefit_name: string;
  name_english: string | null;
  name_portuguese: string | null;
  description_portuguese: string | null;
  body_system_portuguese: string | null;
  therapeutic_properties_portuguese: string | null;
  bubble_id: string | null;
};

type CountRow = {
  count: string;
};

export const healthConcernsRouter = createTRPCRouter({
  forOil: protectedProcedure
    .input(z.object({ essentialOilId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db<HealthConcernRow[]>`
        select
          concern.id::text as id,
          concern.benefit_name,
          concern.name_english,
          concern.name_portuguese,
          concern.description_portuguese,
          concern.body_system_portuguese,
          concern.therapeutic_properties_portuguese,
          concern.bubble_id
        from public.essential_oil_health_concern oil_concern
        join public.eo_health_concerns concern
          on concern.id = oil_concern.health_concern_id
        where oil_concern.essential_oil_id = ${input.essentialOilId}
        order by lower(concern.benefit_name)
      `;
    }),

  create: adminProcedure.input(createHealthConcernInput).mutation(async ({ ctx, input }) => {
    const [healthConcern] = await ctx.db<HealthConcernRow[]>`
      insert into public.eo_health_concerns (
        benefit_name,
        name_english,
        name_portuguese,
        description_portuguese,
        body_system_portuguese,
        therapeutic_properties_portuguese,
        bubble_id,
        updated_at
      )
      values (
        ${input.benefitName},
        ${input.nameEnglish ?? null},
        ${input.namePortuguese ?? null},
        ${input.descriptionPortuguese ?? null},
        ${input.bodySystemPortuguese ?? null},
        ${input.therapeuticPropertiesPortuguese ?? null},
        ${input.bubbleId ?? null},
        now()
      )
      on conflict (benefit_name) do update
      set
        name_english = excluded.name_english,
        name_portuguese = excluded.name_portuguese,
        description_portuguese = excluded.description_portuguese,
        body_system_portuguese = excluded.body_system_portuguese,
        therapeutic_properties_portuguese = excluded.therapeutic_properties_portuguese,
        bubble_id = excluded.bubble_id,
        updated_at = now()
      returning
        id::text as id,
        benefit_name,
        name_english,
        name_portuguese,
        description_portuguese,
        body_system_portuguese,
        therapeutic_properties_portuguese,
        bubble_id
    `;

    await bumpCacheDomainVersions(['healthKnowledge', 'oils', 'dashboard']);
    return healthConcern;
  }),

  update: adminProcedure.input(updateHealthConcernInput).mutation(async ({ ctx, input }) => {
    const [healthConcern] = await ctx.db<HealthConcernRow[]>`
      update public.eo_health_concerns
      set
        benefit_name = coalesce(${input.benefitName ?? null}, benefit_name),
        name_english = coalesce(${input.nameEnglish ?? null}, name_english),
        name_portuguese = coalesce(${input.namePortuguese ?? null}, name_portuguese),
        description_portuguese = coalesce(${input.descriptionPortuguese ?? null}, description_portuguese),
        body_system_portuguese = coalesce(${input.bodySystemPortuguese ?? null}, body_system_portuguese),
        therapeutic_properties_portuguese = coalesce(
          ${input.therapeuticPropertiesPortuguese ?? null},
          therapeutic_properties_portuguese
        ),
        bubble_id = coalesce(${input.bubbleId ?? null}, bubble_id),
        updated_at = now()
      where id = ${input.id}
      returning
        id::text as id,
        benefit_name,
        name_english,
        name_portuguese,
        description_portuguese,
        body_system_portuguese,
        therapeutic_properties_portuguese,
        bubble_id
    `;

    await bumpCacheDomainVersions(['healthKnowledge', 'oils', 'dashboard']);
    return healthConcern ?? null;
  }),

  linkOil: adminProcedure.input(linkOilInput).mutation(async ({ ctx, input }) => {
    const [link] = await ctx.db<
      {
        essential_oil_id: string;
        health_concern_id: string;
      }[]
    >`
      insert into public.essential_oil_health_concern (
        essential_oil_id,
        health_concern_id
      )
      values (${input.essentialOilId}, ${input.healthConcernId})
      on conflict (essential_oil_id, health_concern_id) do nothing
      returning essential_oil_id::text, health_concern_id::text
    `;

    await bumpCacheDomainVersions(['healthKnowledge', 'oils', 'dashboard']);
    return (
      link ?? {
        essential_oil_id: input.essentialOilId,
        health_concern_id: input.healthConcernId
      }
    );
  }),

  unlinkOil: adminProcedure.input(linkOilInput).mutation(async ({ ctx, input }) => {
    const [link] = await ctx.db<
      {
        essential_oil_id: string;
        health_concern_id: string;
      }[]
    >`
      delete from public.essential_oil_health_concern
      where
        essential_oil_id = ${input.essentialOilId}
        and health_concern_id = ${input.healthConcernId}
      returning essential_oil_id::text, health_concern_id::text
    `;

    await bumpCacheDomainVersions(['healthKnowledge', 'oils', 'dashboard']);
    return {
      deleted: Boolean(link),
      link: link ?? null
    };
  }),

  hardDelete: adminProcedure.input(hardDeleteInput).mutation(async ({ ctx, input }) => {
    const [recipeRefs] = await ctx.db<CountRow[]>`
      select count(*)::text as count
      from public.eo_health_concern_recipes
      where health_concern_id = ${input.id}
    `;

    if (Number(recipeRefs?.count ?? 0) > 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Cannot hard delete a health concern while recipes reference it'
      });
    }

    return ctx.db.begin(async (tx) => {
      await tx`delete from public.essential_oil_health_concern where health_concern_id = ${input.id}`;
      await tx`delete from public.essential_oil_how_to_use_health_concern where health_concern_id = ${input.id}`;
      await tx`delete from public.health_concern_action_systems where health_concern_id = ${input.id}`;
      const [healthConcern] = await tx`
        delete from public.eo_health_concerns
        where id = ${input.id}
        returning id::text, benefit_name
      `;

      await bumpCacheDomainVersions(['healthKnowledge', 'oils', 'recipes', 'dashboard']);

      return {
        deleted: Boolean(healthConcern),
        healthConcern: healthConcern ?? null
      };
    });
  })
});
