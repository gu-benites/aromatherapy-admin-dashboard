import { z } from 'zod';
import { adminProcedure, createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { bumpCacheDomainVersions } from '@/server/cache/redis';

const sourceTypeSchema = z.enum([
  'official_doterra',
  'secondary',
  'chromatography',
  'manual',
  'unknown'
]);

const fractionalPercentageSchema = z.number().min(0).max(1);

function percentageRangeRefinement(
  input: {
    minPercentage?: number | null;
    maxPercentage?: number | null;
  },
  ctx: z.RefinementCtx
) {
  if (
    input.minPercentage !== undefined &&
    input.minPercentage !== null &&
    input.maxPercentage !== undefined &&
    input.maxPercentage !== null &&
    input.minPercentage > input.maxPercentage
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'minPercentage must be less than or equal to maxPercentage',
      path: ['minPercentage']
    });
  }
}

const createCompoundInput = z.object({
  name: z.string().trim().min(1).max(180),
  description: z.string().trim().max(2000).optional(),
  bubbleUid: z.string().trim().max(120).optional(),
  pubchemCompoundId: z.string().trim().max(80).optional(),
  carbonStructure: z.string().trim().max(120).optional()
});

const updateCompoundInput = createCompoundInput.partial().extend({
  id: z.string().uuid()
});

const hardDeleteCompoundInput = z.object({
  id: z.string().uuid(),
  confirmation: z.literal('EXCLUIR')
});

const linkTherapeuticPropertyInput = z.object({
  chemicalCompoundId: z.string().uuid(),
  therapeuticPropertyId: z.string().uuid(),
  sourceType: sourceTypeSchema.default('manual'),
  sourceReference: z.string().trim().max(500).optional()
});

const upsertOilCompoundInput = z
  .object({
    essentialOilId: z.string().uuid(),
    chemicalCompoundId: z.string().uuid(),
    minPercentage: fractionalPercentageSchema.nullable().optional(),
    maxPercentage: fractionalPercentageSchema.nullable().optional(),
    typicalPercentage: fractionalPercentageSchema.nullable().optional(),
    notes: z.string().trim().max(1000).optional(),
    bubbleId: z.string().trim().max(120).optional(),
    sourceType: sourceTypeSchema.default('manual'),
    sourceReference: z.string().trim().max(500).optional()
  })
  .superRefine(percentageRangeRefinement);

const updateOilCompoundPercentagesInput = z
  .object({
    essentialOilId: z.string().uuid(),
    chemicalCompoundId: z.string().uuid(),
    minPercentage: fractionalPercentageSchema.nullable(),
    maxPercentage: fractionalPercentageSchema.nullable(),
    typicalPercentage: fractionalPercentageSchema.nullable(),
    notes: z.string().trim().max(1000).optional(),
    sourceType: sourceTypeSchema.optional(),
    sourceReference: z.string().trim().max(500).optional()
  })
  .superRefine(percentageRangeRefinement);

const compoundsListInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).optional(),
  sourceType: sourceTypeSchema.optional(),
  functionalGroupId: z.string().uuid().optional(),
  carbonStructureId: z.string().uuid().optional()
});

type ChemicalCompoundRow = {
  id: string;
  name: string;
  description: string | null;
  bubble_uid: string | null;
  pubchem_compound_id: string | null;
  carbon_structure: string | null;
};

type OilCompoundRow = {
  essential_oil_id: string;
  chemical_compound_id: string;
  min_percentage: string | null;
  max_percentage: string | null;
  typical_percentage: string | null;
  notes: string | null;
  source_type: string;
  source_reference: string | null;
};

export const chemistryRouter = createTRPCRouter({
  compoundsList: protectedProcedure.input(compoundsListInput).query(async ({ ctx, input }) => {
    const searchPattern = input.search ? `%${input.search}%` : null;
    const offset = (input.page - 1) * input.pageSize;

    const rows = await ctx.db`
      select
        compound.id::text,
        compound.name,
        compound.description,
        compound.pubchem_compound_id,
        compound.carbon_structure,
        (select count(*)::int from public.essential_oil_chemical_compounds link where link.chemical_compound_id = compound.id) as oil_count,
        (select count(*)::int from public.chemical_compound_therapeutic_properties link where link.chemical_compound_id = compound.id) as therapeutic_property_count,
        (select count(*)::int from public.chemical_compound_functional_groups link where link.chemical_compound_id = compound.id) as functional_group_count,
        (select count(*)::int from public.chemical_compound_carbon_structures link where link.chemical_compound_id = compound.id) as carbon_structure_count
      from public.chemical_compounds compound
      where
        (${searchPattern}::text is null or compound.name ilike ${searchPattern} or compound.description ilike ${searchPattern})
        and (${input.sourceType ?? null}::text is null or exists (
          select 1 from public.essential_oil_chemical_compounds link
          where link.chemical_compound_id = compound.id and link.source_type = ${input.sourceType ?? null}::chemical_compound_source_type
        ))
        and (${input.functionalGroupId ?? null}::uuid is null or exists (
          select 1 from public.chemical_compound_functional_groups link
          where link.chemical_compound_id = compound.id and link.functional_group_id = ${input.functionalGroupId ?? null}
        ))
        and (${input.carbonStructureId ?? null}::uuid is null or exists (
          select 1 from public.chemical_compound_carbon_structures link
          where link.chemical_compound_id = compound.id and link.carbon_structure_id = ${input.carbonStructureId ?? null}
        ))
      order by lower(compound.name)
      limit ${input.pageSize}
      offset ${offset}
    `;

    const [totalRow] = await ctx.db<{ count: string }[]>`
      select count(*)::text as count
      from public.chemical_compounds compound
      where
        (${searchPattern}::text is null or compound.name ilike ${searchPattern} or compound.description ilike ${searchPattern})
        and (${input.sourceType ?? null}::text is null or exists (
          select 1 from public.essential_oil_chemical_compounds link
          where link.chemical_compound_id = compound.id and link.source_type = ${input.sourceType ?? null}::chemical_compound_source_type
        ))
        and (${input.functionalGroupId ?? null}::uuid is null or exists (
          select 1 from public.chemical_compound_functional_groups link
          where link.chemical_compound_id = compound.id and link.functional_group_id = ${input.functionalGroupId ?? null}
        ))
        and (${input.carbonStructureId ?? null}::uuid is null or exists (
          select 1 from public.chemical_compound_carbon_structures link
          where link.chemical_compound_id = compound.id and link.carbon_structure_id = ${input.carbonStructureId ?? null}
        ))
    `;

    return {
      items: rows,
      page: input.page,
      pageSize: input.pageSize,
      total: Number(totalRow?.count ?? 0)
    };
  }),

  compoundDetail: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [compound] = await ctx.db<ChemicalCompoundRow[]>`
      select id::text, name, description, bubble_uid, pubchem_compound_id, carbon_structure
      from public.chemical_compounds
      where id = ${input.id}
      limit 1
    `;

      if (!compound) return null;

      const [functionalGroups, carbonStructures, oilLinks, propertyLinks] = await Promise.all([
        ctx.db`
        select group_lookup.id::text, group_lookup.name_english, group_lookup.name_portuguese
        from public.chemical_compound_functional_groups link
        join public.chemical_functional_groups group_lookup on group_lookup.id = link.functional_group_id
        where link.chemical_compound_id = ${input.id}
        order by group_lookup.name_english
      `,
        ctx.db`
        select structure.id::text, structure.name_english, structure.name_portuguese
        from public.chemical_compound_carbon_structures link
        join public.chemical_carbon_structures structure on structure.id = link.carbon_structure_id
        where link.chemical_compound_id = ${input.id}
        order by structure.name_english
      `,
        ctx.db`
        select oil_link.essential_oil_id::text, oil.name_english, oil.name_portuguese,
          oil_link.min_percentage::text, oil_link.max_percentage::text, oil_link.typical_percentage::text,
          oil_link.source_type::text, oil_link.source_reference
        from public.essential_oil_chemical_compounds oil_link
        join public.essential_oils oil on oil.id = oil_link.essential_oil_id
        where oil_link.chemical_compound_id = ${input.id}
        order by oil.name_english
      `,
        ctx.db`
        select property.id::text, property.property_name, property.property_name_portuguese,
          link.source_type::text, link.source_reference
        from public.chemical_compound_therapeutic_properties link
        join public.eo_therapeutic_properties property on property.id = link.therapeutic_property_id
        where link.chemical_compound_id = ${input.id}
        order by property.property_name
      `
      ]);

      return { compound, functionalGroups, carbonStructures, oilLinks, propertyLinks };
    }),

  compoundOilLinks: protectedProcedure
    .input(
      z.object({
        compoundId: z.string().uuid(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(50)
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.db`
        select oil_link.essential_oil_id::text, oil.name_english, oil.name_portuguese,
          oil_link.min_percentage::text, oil_link.max_percentage::text, oil_link.typical_percentage::text,
          oil_link.notes, oil_link.source_type::text, oil_link.source_reference
        from public.essential_oil_chemical_compounds oil_link
        join public.essential_oils oil on oil.id = oil_link.essential_oil_id
        where oil_link.chemical_compound_id = ${input.compoundId}
        order by oil.name_english
        limit ${input.pageSize}
        offset ${(input.page - 1) * input.pageSize}
      `;
    }),

  compoundPropertyLinks: protectedProcedure
    .input(z.object({ compoundId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db`
        select property.id::text, property.property_name, property.property_name_portuguese,
          link.source_type::text, link.source_reference
        from public.chemical_compound_therapeutic_properties link
        join public.eo_therapeutic_properties property on property.id = link.therapeutic_property_id
        where link.chemical_compound_id = ${input.compoundId}
        order by property.property_name
      `;
    }),

  facets: protectedProcedure.query(async ({ ctx }) => {
    const [functionalGroups, carbonStructures, sourceTypes] = await Promise.all([
      ctx.db`
        select id::text, name_english, name_portuguese
        from public.chemical_functional_groups
        order by name_english
      `,
      ctx.db`
        select id::text, name_english, name_portuguese
        from public.chemical_carbon_structures
        order by name_english
      `,
      ctx.db`
        select source_type::text, count(*)::int as count
        from public.essential_oil_chemical_compounds
        group by source_type
        order by source_type::text
      `
    ]);

    return { functionalGroups, carbonStructures, sourceTypes };
  }),

  coverageSummary: protectedProcedure.query(async ({ ctx }) => {
    const [summary] = await ctx.db`
      select
        count(*)::int as total_compounds,
        count(*) filter (where exists (
          select 1 from public.essential_oil_chemical_compounds link where link.chemical_compound_id = compound.id
        ))::int as with_oil_links,
        count(*) filter (where exists (
          select 1 from public.chemical_compound_therapeutic_properties link where link.chemical_compound_id = compound.id
        ))::int as with_therapeutic_properties,
        count(*) filter (where not exists (
          select 1 from public.chemical_compound_functional_groups link where link.chemical_compound_id = compound.id
        ))::int as without_functional_groups,
        count(*) filter (where not exists (
          select 1 from public.chemical_compound_carbon_structures link where link.chemical_compound_id = compound.id
        ))::int as without_carbon_structures
      from public.chemical_compounds compound
    `;

    const sourceTypes = await ctx.db`
      select source_type::text, count(*)::int as count
      from public.essential_oil_chemical_compounds
      group by source_type
      order by count desc, source_type::text
    `;

    return { summary, sourceTypes };
  }),

  oilCompounds: protectedProcedure
    .input(z.object({ essentialOilId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db<
        (OilCompoundRow & {
          compound_name: string;
          compound_description: string | null;
          pubchem_compound_id: string | null;
          carbon_structure: string | null;
        })[]
      >`
        select
          oil_compound.essential_oil_id::text,
          oil_compound.chemical_compound_id::text,
          oil_compound.min_percentage::text,
          oil_compound.max_percentage::text,
          oil_compound.typical_percentage::text,
          oil_compound.notes,
          oil_compound.source_type::text,
          oil_compound.source_reference,
          compound.name as compound_name,
          compound.description as compound_description,
          compound.pubchem_compound_id,
          compound.carbon_structure
        from public.essential_oil_chemical_compounds oil_compound
        join public.chemical_compounds compound
          on compound.id = oil_compound.chemical_compound_id
        where oil_compound.essential_oil_id = ${input.essentialOilId}
        order by lower(compound.name)
      `;
    }),

  createCompound: adminProcedure.input(createCompoundInput).mutation(async ({ ctx, input }) => {
    const [compound] = await ctx.db<ChemicalCompoundRow[]>`
      insert into public.chemical_compounds (
        name,
        description,
        bubble_uid,
        pubchem_compound_id,
        carbon_structure
      )
      values (
        ${input.name},
        ${input.description ?? null},
        ${input.bubbleUid ?? null},
        ${input.pubchemCompoundId ?? null},
        ${input.carbonStructure ?? null}
      )
      on conflict (name) do update
      set
        description = excluded.description,
        bubble_uid = excluded.bubble_uid,
        pubchem_compound_id = excluded.pubchem_compound_id,
        carbon_structure = excluded.carbon_structure
      returning
        id::text as id,
        name,
        description,
        bubble_uid,
        pubchem_compound_id,
        carbon_structure
    `;

    await bumpCacheDomainVersions(['chemistry', 'oils', 'healthKnowledge', 'dashboard']);
    return compound;
  }),

  updateCompound: adminProcedure.input(updateCompoundInput).mutation(async ({ ctx, input }) => {
    const [compound] = await ctx.db<ChemicalCompoundRow[]>`
      update public.chemical_compounds
      set
        name = coalesce(${input.name ?? null}, name),
        description = coalesce(${input.description ?? null}, description),
        bubble_uid = coalesce(${input.bubbleUid ?? null}, bubble_uid),
        pubchem_compound_id = coalesce(${input.pubchemCompoundId ?? null}, pubchem_compound_id),
        carbon_structure = coalesce(${input.carbonStructure ?? null}, carbon_structure)
      where id = ${input.id}
      returning
        id::text as id,
        name,
        description,
        bubble_uid,
        pubchem_compound_id,
        carbon_structure
    `;

    await bumpCacheDomainVersions(['chemistry', 'oils', 'healthKnowledge', 'dashboard']);
    return compound ?? null;
  }),

  linkTherapeuticProperty: adminProcedure
    .input(linkTherapeuticPropertyInput)
    .mutation(async ({ ctx, input }) => {
      const [link] = await ctx.db<
        {
          chemical_compound_id: string;
          therapeutic_property_id: string;
          source_type: string;
          source_reference: string | null;
        }[]
      >`
        insert into public.chemical_compound_therapeutic_properties (
          chemical_compound_id,
          therapeutic_property_id,
          source_type,
          source_reference,
          updated_at
        )
        values (
          ${input.chemicalCompoundId},
          ${input.therapeuticPropertyId},
          ${input.sourceType}::chemical_compound_source_type,
          ${input.sourceReference ?? null},
          now()
        )
        on conflict (chemical_compound_id, therapeutic_property_id) do update
        set
          source_type = excluded.source_type,
          source_reference = excluded.source_reference,
          updated_at = now()
        returning
          chemical_compound_id::text,
          therapeutic_property_id::text,
          source_type::text,
          source_reference
      `;

      await bumpCacheDomainVersions(['chemistry', 'healthKnowledge', 'oils', 'dashboard']);
      return link;
    }),

  unlinkTherapeuticProperty: adminProcedure
    .input(
      z.object({
        chemicalCompoundId: z.string().uuid(),
        therapeuticPropertyId: z.string().uuid()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [link] = await ctx.db<
        {
          chemical_compound_id: string;
          therapeutic_property_id: string;
        }[]
      >`
        delete from public.chemical_compound_therapeutic_properties
        where
          chemical_compound_id = ${input.chemicalCompoundId}
          and therapeutic_property_id = ${input.therapeuticPropertyId}
        returning chemical_compound_id::text, therapeutic_property_id::text
      `;

      await bumpCacheDomainVersions(['chemistry', 'healthKnowledge', 'oils', 'dashboard']);
      return {
        deleted: Boolean(link),
        link: link ?? null
      };
    }),

  upsertOilCompound: adminProcedure
    .input(upsertOilCompoundInput)
    .mutation(async ({ ctx, input }) => {
      const minPercentage = input.minPercentage ?? null;
      const maxPercentage = input.maxPercentage ?? null;
      const typicalPercentage = input.typicalPercentage ?? null;

      const [link] = await ctx.db<OilCompoundRow[]>`
      insert into public.essential_oil_chemical_compounds (
        essential_oil_id,
        chemical_compound_id,
        min_percentage,
        max_percentage,
        typical_percentage,
        notes,
        percentage_range,
        bubble_id,
        source_type,
        source_reference
      )
      values (
        ${input.essentialOilId},
        ${input.chemicalCompoundId},
        ${minPercentage},
        ${maxPercentage},
        ${typicalPercentage},
        ${input.notes ?? null},
        case
          when ${minPercentage}::numeric is not null and ${maxPercentage}::numeric is not null
          then numrange(${minPercentage}, ${maxPercentage}, '[]')
          else null
        end,
        ${input.bubbleId ?? null},
        ${input.sourceType}::chemical_compound_source_type,
        ${input.sourceReference ?? null}
      )
      on conflict (essential_oil_id, chemical_compound_id) do update
      set
        min_percentage = excluded.min_percentage,
        max_percentage = excluded.max_percentage,
        typical_percentage = excluded.typical_percentage,
        notes = excluded.notes,
        percentage_range = excluded.percentage_range,
        bubble_id = excluded.bubble_id,
        source_type = excluded.source_type,
        source_reference = excluded.source_reference
      returning
        essential_oil_id::text,
        chemical_compound_id::text,
        min_percentage::text,
        max_percentage::text,
        typical_percentage::text,
        notes,
        source_type::text,
        source_reference
    `;

      await bumpCacheDomainVersions(['chemistry', 'oils', 'dashboard']);
      return link;
    }),

  updateOilCompoundPercentages: adminProcedure
    .input(updateOilCompoundPercentagesInput)
    .mutation(async ({ ctx, input }) => {
      const [link] = await ctx.db<OilCompoundRow[]>`
        update public.essential_oil_chemical_compounds
        set
          min_percentage = ${input.minPercentage},
          max_percentage = ${input.maxPercentage},
          typical_percentage = ${input.typicalPercentage},
          notes = coalesce(${input.notes ?? null}, notes),
          source_type = coalesce(${input.sourceType ?? null}::chemical_compound_source_type, source_type),
          source_reference = coalesce(${input.sourceReference ?? null}, source_reference),
          percentage_range = case
            when ${input.minPercentage}::numeric is not null and ${input.maxPercentage}::numeric is not null
            then numrange(${input.minPercentage}, ${input.maxPercentage}, '[]')
            else null
          end
        where
          essential_oil_id = ${input.essentialOilId}
          and chemical_compound_id = ${input.chemicalCompoundId}
        returning
          essential_oil_id::text,
          chemical_compound_id::text,
          min_percentage::text,
          max_percentage::text,
          typical_percentage::text,
          notes,
          source_type::text,
          source_reference
      `;

      await bumpCacheDomainVersions(['chemistry', 'oils', 'dashboard']);
      return link ?? null;
    }),

  unlinkOilCompound: adminProcedure
    .input(
      z.object({
        essentialOilId: z.string().uuid(),
        chemicalCompoundId: z.string().uuid()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [link] = await ctx.db<
        {
          essential_oil_id: string;
          chemical_compound_id: string;
        }[]
      >`
        delete from public.essential_oil_chemical_compounds
        where
          essential_oil_id = ${input.essentialOilId}
          and chemical_compound_id = ${input.chemicalCompoundId}
        returning essential_oil_id::text, chemical_compound_id::text
      `;

      await bumpCacheDomainVersions(['chemistry', 'oils', 'dashboard']);
      return {
        deleted: Boolean(link),
        link: link ?? null
      };
    }),

  hardDeleteCompound: adminProcedure
    .input(hardDeleteCompoundInput)
    .mutation(async ({ ctx, input }) => {
      return ctx.db.begin(async (tx) => {
        await tx`delete from public.chemical_compound_carbon_structures where chemical_compound_id = ${input.id}`;
        await tx`delete from public.chemical_compound_functional_groups where chemical_compound_id = ${input.id}`;
        await tx`delete from public.chemical_compound_therapeutic_properties where chemical_compound_id = ${input.id}`;
        await tx`delete from public.essential_oil_chemical_compounds where chemical_compound_id = ${input.id}`;
        const [compound] = await tx`
        delete from public.chemical_compounds
        where id = ${input.id}
        returning id::text, name
      `;

        await bumpCacheDomainVersions(['chemistry', 'healthKnowledge', 'oils', 'dashboard']);

        return {
          deleted: Boolean(compound),
          compound: compound ?? null
        };
      });
    })
});
