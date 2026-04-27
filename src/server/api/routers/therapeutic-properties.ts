import { z } from 'zod';
import { adminProcedure, createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { bumpCacheDomainVersions } from '@/server/cache/redis';

const createPropertyInput = z.object({
  propertyName: z.string().trim().min(1).max(180),
  propertyNamePortuguese: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(2000).optional(),
  descriptionPortuguese: z.string().trim().max(2000).optional(),
  bubbleUid: z.string().trim().max(120).optional()
});

const linkOilInput = z.object({
  essentialOilId: z.string().uuid(),
  propertyId: z.string().uuid()
});

const updatePropertyInput = createPropertyInput.partial().extend({
  id: z.string().uuid()
});

const hardDeleteInput = z.object({
  id: z.string().uuid(),
  confirmation: z.literal('EXCLUIR')
});

type TherapeuticPropertyRow = {
  id: string;
  property_name: string;
  property_name_portuguese: string | null;
  description: string | null;
  description_portuguese: string | null;
  bubble_uid: string | null;
};

export const therapeuticPropertiesRouter = createTRPCRouter({
  forOil: protectedProcedure
    .input(z.object({ essentialOilId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db<TherapeuticPropertyRow[]>`
        select
          property.id::text as id,
          property.property_name,
          property.property_name_portuguese,
          property.description,
          property.description_portuguese,
          property.bubble_uid
        from public.essential_oil_therapeutic_properties oil_property
        join public.eo_therapeutic_properties property
          on property.id = oil_property.property_id
        where oil_property.essential_oil_id = ${input.essentialOilId}
        order by lower(property.property_name)
      `;
    }),

  create: adminProcedure.input(createPropertyInput).mutation(async ({ ctx, input }) => {
    const [property] = await ctx.db<TherapeuticPropertyRow[]>`
      insert into public.eo_therapeutic_properties (
        property_name,
        property_name_portuguese,
        description,
        description_portuguese,
        bubble_uid,
        updated_at
      )
      values (
        ${input.propertyName},
        ${input.propertyNamePortuguese ?? null},
        ${input.description ?? null},
        ${input.descriptionPortuguese ?? null},
        ${input.bubbleUid ?? null},
        now()
      )
      on conflict (property_name) do update
      set
        property_name_portuguese = excluded.property_name_portuguese,
        description = excluded.description,
        description_portuguese = excluded.description_portuguese,
        bubble_uid = excluded.bubble_uid,
        updated_at = now()
      returning
        id::text as id,
        property_name,
        property_name_portuguese,
        description,
        description_portuguese,
        bubble_uid
    `;

    await bumpCacheDomainVersions(['healthKnowledge', 'chemistry', 'oils', 'dashboard']);
    return property;
  }),

  update: adminProcedure.input(updatePropertyInput).mutation(async ({ ctx, input }) => {
    const [property] = await ctx.db<TherapeuticPropertyRow[]>`
      update public.eo_therapeutic_properties
      set
        property_name = coalesce(${input.propertyName ?? null}, property_name),
        property_name_portuguese = coalesce(
          ${input.propertyNamePortuguese ?? null},
          property_name_portuguese
        ),
        description = coalesce(${input.description ?? null}, description),
        description_portuguese = coalesce(${input.descriptionPortuguese ?? null}, description_portuguese),
        bubble_uid = coalesce(${input.bubbleUid ?? null}, bubble_uid),
        updated_at = now()
      where id = ${input.id}
      returning
        id::text as id,
        property_name,
        property_name_portuguese,
        description,
        description_portuguese,
        bubble_uid
    `;

    await bumpCacheDomainVersions(['healthKnowledge', 'chemistry', 'oils', 'dashboard']);
    return property ?? null;
  }),

  linkOil: adminProcedure.input(linkOilInput).mutation(async ({ ctx, input }) => {
    const [link] = await ctx.db<
      {
        essential_oil_id: string;
        property_id: string;
      }[]
    >`
      insert into public.essential_oil_therapeutic_properties (
        essential_oil_id,
        property_id
      )
      values (${input.essentialOilId}, ${input.propertyId})
      on conflict (essential_oil_id, property_id) do nothing
      returning essential_oil_id::text, property_id::text
    `;

    await bumpCacheDomainVersions(['healthKnowledge', 'oils', 'dashboard']);
    return (
      link ?? {
        essential_oil_id: input.essentialOilId,
        property_id: input.propertyId
      }
    );
  }),

  unlinkOil: adminProcedure.input(linkOilInput).mutation(async ({ ctx, input }) => {
    const [link] = await ctx.db<
      {
        essential_oil_id: string;
        property_id: string;
      }[]
    >`
      delete from public.essential_oil_therapeutic_properties
      where
        essential_oil_id = ${input.essentialOilId}
        and property_id = ${input.propertyId}
      returning essential_oil_id::text, property_id::text
    `;

    await bumpCacheDomainVersions(['healthKnowledge', 'oils', 'dashboard']);
    return {
      deleted: Boolean(link),
      link: link ?? null
    };
  }),

  hardDelete: adminProcedure.input(hardDeleteInput).mutation(async ({ ctx, input }) => {
    return ctx.db.begin(async (tx) => {
      await tx`delete from public.chemical_compound_therapeutic_properties where therapeutic_property_id = ${input.id}`;
      await tx`delete from public.eo_therapeutic_property_carbon_structures where property_id = ${input.id}`;
      await tx`delete from public.eo_therapeutic_property_functional_groups where property_id = ${input.id}`;
      await tx`delete from public.essential_oil_therapeutic_properties where property_id = ${input.id}`;
      const [property] = await tx`
        delete from public.eo_therapeutic_properties
        where id = ${input.id}
        returning id::text, property_name
      `;

      await bumpCacheDomainVersions(['healthKnowledge', 'chemistry', 'oils', 'dashboard']);

      return {
        deleted: Boolean(property),
        property: property ?? null
      };
    });
  })
});
