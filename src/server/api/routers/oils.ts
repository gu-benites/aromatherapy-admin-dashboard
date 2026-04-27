import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { adminProcedure, createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { bumpCacheDomainVersions } from '@/server/cache/redis';

const listInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).optional(),
  pregnancyCategory: z.string().trim().min(1).optional(),
  internalUseStatusId: z.string().uuid().optional(),
  dilutionRecommendationId: z.string().uuid().optional(),
  phototoxicityStatusId: z.string().uuid().optional(),
  applicationMethodId: z.string().uuid().optional()
});

const createTestOilInput = z.object({
  nameEnglish: z.string().trim().min(1).max(120).optional(),
  namePortuguese: z.string().trim().min(1).max(120).optional(),
  nameScientific: z.string().trim().min(1).max(160).optional()
});

const updateOilInput = z.object({
  id: z.string().uuid(),
  nameEnglish: z.string().trim().min(1).max(120).optional(),
  namePortuguese: z.string().trim().min(1).max(120).optional(),
  nameScientific: z.string().trim().min(1).max(160).optional(),
  generalDescription: z.string().trim().max(4000).nullable().optional(),
  imageUrl: z.string().trim().url().nullable().optional(),
  internalUseStatusId: z.string().uuid().nullable().optional(),
  dilutionRecommendationId: z.string().uuid().nullable().optional(),
  phototoxicityStatusId: z.string().uuid().nullable().optional(),
  colorLabelId: z.string().uuid().nullable().optional()
});

const oilLookupLinkInput = z.object({
  essentialOilId: z.string().uuid()
});

const applicationMethodLinkInput = oilLookupLinkInput.extend({
  applicationMethodId: z.string().uuid(),
  sourceField: z.string().trim().max(160).default('admin')
});

const pregnancyStatusLinkInput = oilLookupLinkInput.extend({
  pregnancyNursingStatusId: z.string().uuid()
});

const childSafetyInput = oilLookupLinkInput.extend({
  ageRangeId: z.string().uuid(),
  safetyNotes: z.string().trim().max(1000).nullable().optional()
});

const petSafetyInput = oilLookupLinkInput.extend({
  petId: z.string().uuid(),
  safetyNotes: z.string().trim().max(1000).nullable().optional()
});

const actionSystemLinkInput = oilLookupLinkInput.extend({
  actionSystemId: z.string().uuid(),
  sourceField: z.string().trim().max(160).default('admin')
});

const hardDeleteInput = z.object({
  id: z.string().uuid(),
  confirmation: z.literal('EXCLUIR')
});

type OilListRow = {
  id: string;
  name_english: string | null;
  name_portuguese: string | null;
  name_scientific: string | null;
  image_url: string | null;
  internal_use_status_name: string | null;
  dilution_recommendation_name: string | null;
  phototoxicity_status_name: string | null;
  pregnancy_safety_category_code: string | null;
  pregnancy_safety_category_name: string | null;
  has_professional_guidance: boolean | null;
  has_labor_delivery_guidance: boolean | null;
};

type OilDetailRow = OilListRow & {
  general_description: string | null;
  bubble_uid: string | null;
  internal_use_status_id: string | null;
  dilution_recommendation_id: string | null;
  phototoxicity_status_id: string | null;
  color_label_id: string | null;
  color_label_name: string | null;
  color_label_hex: string | null;
  legacy_pregnancy_tags: string[] | null;
  pregnancy_tag_codes: string[] | null;
};

type CountRow = {
  count: string;
};

function hasOwn(input: object, field: string) {
  return Object.prototype.hasOwnProperty.call(input, field);
}

async function bumpOilCaches() {
  await bumpCacheDomainVersions(['oils', 'dashboard']);
}

export const oilsRouter = createTRPCRouter({
  list: protectedProcedure.input(listInput).query(async ({ ctx, input }) => {
    const offset = (input.page - 1) * input.pageSize;
    const searchPattern = input.search ? `%${input.search}%` : null;

    const rows = await ctx.db<OilListRow[]>`
      select
        eo.id::text as id,
        eo.name_english,
        eo.name_portuguese,
        eo.name_scientific,
        eo.image_url,
        internal_status.name as internal_use_status_name,
        dilution.name as dilution_recommendation_name,
        phototoxicity.name as phototoxicity_status_name,
        pregnancy.pregnancy_safety_category_code,
        pregnancy.pregnancy_safety_category_name,
        pregnancy.has_professional_guidance,
        pregnancy.has_labor_delivery_guidance
      from public.essential_oils eo
      left join public.eo_internal_use_statuses internal_status
        on internal_status.id = eo.internal_use_status_id
      left join public.eo_dilution_recommendations dilution
        on dilution.id = eo.dilution_recommendation_id
      left join public.eo_phototoxicity_statuses phototoxicity
        on phototoxicity.id = eo.phototoxicity_status_id
      left join public.v_oil_pregnancy_safety_profile pregnancy
        on pregnancy.essential_oil_id = eo.id
      where
        (
          ${searchPattern}::text is null
          or eo.name_english ilike ${searchPattern}
          or eo.name_portuguese ilike ${searchPattern}
          or eo.name_scientific ilike ${searchPattern}
        )
        and (
          ${input.pregnancyCategory ?? null}::text is null
          or pregnancy.pregnancy_safety_category_code = ${input.pregnancyCategory ?? null}
        )
        and (
          ${input.internalUseStatusId ?? null}::uuid is null
          or eo.internal_use_status_id = ${input.internalUseStatusId ?? null}
        )
        and (
          ${input.dilutionRecommendationId ?? null}::uuid is null
          or eo.dilution_recommendation_id = ${input.dilutionRecommendationId ?? null}
        )
        and (
          ${input.phototoxicityStatusId ?? null}::uuid is null
          or eo.phototoxicity_status_id = ${input.phototoxicityStatusId ?? null}
        )
        and (
          ${input.applicationMethodId ?? null}::uuid is null
          or exists (
            select 1
            from public.essential_oil_application_methods method_link
            where
              method_link.essential_oil_id = eo.id
              and method_link.application_method_id = ${input.applicationMethodId ?? null}
          )
        )
      order by lower(coalesce(eo.name_portuguese, eo.name_english, eo.name_scientific))
      limit ${input.pageSize}
      offset ${offset}
    `;

    const [totalRow] = await ctx.db<CountRow[]>`
      select count(*)::text as count
      from public.essential_oils eo
      left join public.v_oil_pregnancy_safety_profile pregnancy
        on pregnancy.essential_oil_id = eo.id
      where
        (
          ${searchPattern}::text is null
          or eo.name_english ilike ${searchPattern}
          or eo.name_portuguese ilike ${searchPattern}
          or eo.name_scientific ilike ${searchPattern}
        )
        and (
          ${input.pregnancyCategory ?? null}::text is null
          or pregnancy.pregnancy_safety_category_code = ${input.pregnancyCategory ?? null}
        )
        and (
          ${input.internalUseStatusId ?? null}::uuid is null
          or eo.internal_use_status_id = ${input.internalUseStatusId ?? null}
        )
        and (
          ${input.dilutionRecommendationId ?? null}::uuid is null
          or eo.dilution_recommendation_id = ${input.dilutionRecommendationId ?? null}
        )
        and (
          ${input.phototoxicityStatusId ?? null}::uuid is null
          or eo.phototoxicity_status_id = ${input.phototoxicityStatusId ?? null}
        )
        and (
          ${input.applicationMethodId ?? null}::uuid is null
          or exists (
            select 1
            from public.essential_oil_application_methods method_link
            where
              method_link.essential_oil_id = eo.id
              and method_link.application_method_id = ${input.applicationMethodId ?? null}
          )
        )
    `;

    return {
      items: rows,
      page: input.page,
      pageSize: input.pageSize,
      total: Number(totalRow?.count ?? 0)
    };
  }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [oil] = await ctx.db<OilDetailRow[]>`
      select
        eo.id::text as id,
        eo.name_english,
        eo.name_portuguese,
        eo.name_scientific,
        eo.general_description,
        eo.image_url,
        eo.bubble_uid,
        eo.internal_use_status_id::text,
        eo.dilution_recommendation_id::text,
        eo.phototoxicity_status_id::text,
        eo.color_label_id::text,
        internal_status.name as internal_use_status_name,
        dilution.name as dilution_recommendation_name,
        phototoxicity.name as phototoxicity_status_name,
        color_label.name_english as color_label_name,
        color_label.color_hex as color_label_hex,
        pregnancy.pregnancy_safety_category_code,
        pregnancy.pregnancy_safety_category_name,
        pregnancy.has_professional_guidance,
        pregnancy.has_labor_delivery_guidance,
        pregnancy.legacy_pregnancy_tags,
        pregnancy.pregnancy_tag_codes
      from public.essential_oils eo
      left join public.eo_internal_use_statuses internal_status
        on internal_status.id = eo.internal_use_status_id
      left join public.eo_dilution_recommendations dilution
        on dilution.id = eo.dilution_recommendation_id
      left join public.eo_phototoxicity_statuses phototoxicity
        on phototoxicity.id = eo.phototoxicity_status_id
      left join public.eo_color_labels color_label
        on color_label.id = eo.color_label_id
      left join public.v_oil_pregnancy_safety_profile pregnancy
        on pregnancy.essential_oil_id = eo.id
      where eo.id = ${input.id}
      limit 1
    `;

      return oil ?? null;
    }),

  detail: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [oil, sourcing, aroma, relationshipSummary] = await Promise.all([
        ctx.db<OilDetailRow[]>`
        select
          eo.id::text as id,
          eo.name_english,
          eo.name_portuguese,
          eo.name_scientific,
          eo.general_description,
          eo.image_url,
          eo.bubble_uid,
          eo.internal_use_status_id::text,
          eo.dilution_recommendation_id::text,
          eo.phototoxicity_status_id::text,
          eo.color_label_id::text,
          internal_status.name as internal_use_status_name,
          dilution.name as dilution_recommendation_name,
          phototoxicity.name as phototoxicity_status_name,
          color_label.name_english as color_label_name,
          color_label.color_hex as color_label_hex,
          pregnancy.pregnancy_safety_category_code,
          pregnancy.pregnancy_safety_category_name,
          pregnancy.has_professional_guidance,
          pregnancy.has_labor_delivery_guidance,
          pregnancy.legacy_pregnancy_tags,
          pregnancy.pregnancy_tag_codes
        from public.essential_oils eo
        left join public.eo_internal_use_statuses internal_status
          on internal_status.id = eo.internal_use_status_id
        left join public.eo_dilution_recommendations dilution
          on dilution.id = eo.dilution_recommendation_id
        left join public.eo_phototoxicity_statuses phototoxicity
          on phototoxicity.id = eo.phototoxicity_status_id
        left join public.eo_color_labels color_label
          on color_label.id = eo.color_label_id
        left join public.v_oil_pregnancy_safety_profile pregnancy
          on pregnancy.essential_oil_id = eo.id
        where eo.id = ${input.id}
        limit 1
      `,
        ctx.db`
        select plant_parts, extraction_methods, countries
        from public.v_oil_sourcing_details
        where oil_id = ${input.id}
        limit 1
      `,
        ctx.db`
        select aroma_notes, aroma_scents
        from public.v_oil_aroma_profile
        where oil_id = ${input.id}
        limit 1
      `,
        ctx.db`
        select
          (select count(*)::int from public.essential_oil_chemical_compounds where essential_oil_id = ${input.id}) as compound_count,
          (select count(*)::int from public.essential_oil_health_concern where essential_oil_id = ${input.id}) as health_concern_count,
          (select count(*)::int from public.essential_oil_therapeutic_properties where essential_oil_id = ${input.id}) as direct_property_count,
          (select count(*)::int from public.v_essential_oil_derived_therapeutic_properties where essential_oil_id = ${input.id}) as derived_property_count,
          (select count(*)::int from public.eo_health_concern_recipe_oils where essential_oil_id = ${input.id}) as recipe_count,
          (select count(*)::int from public.v_eo_product_oils_resolved where essential_oil_id = ${input.id}) as product_count,
          (
            select count(*)::int
            from public.essential_oil_reports report
            join public.essential_oils report_oil on report_oil.id = ${input.id}
            where lower(report.oil_name) in (
              lower(report_oil.name_english),
              lower(report_oil.name_portuguese),
              lower(report_oil.name_scientific)
            )
          ) as report_count,
          (select count(*)::int from public.essential_oil_action_systems where essential_oil_id = ${input.id}) as action_system_count
      `
      ]);

      return {
        oil: oil[0] ?? null,
        sourcing: sourcing[0] ?? null,
        aroma: aroma[0] ?? null,
        relationshipSummary: relationshipSummary[0] ?? null
      };
    }),

  relationshipSummary: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [summary] = await ctx.db`
        select
          (select count(*)::int from public.essential_oil_chemical_compounds where essential_oil_id = ${input.id}) as compound_count,
          (select count(*)::int from public.essential_oil_health_concern where essential_oil_id = ${input.id}) as health_concern_count,
          (select count(*)::int from public.essential_oil_therapeutic_properties where essential_oil_id = ${input.id}) as direct_property_count,
          (select count(*)::int from public.v_essential_oil_derived_therapeutic_properties where essential_oil_id = ${input.id}) as derived_property_count,
          (select count(*)::int from public.eo_health_concern_recipe_oils where essential_oil_id = ${input.id}) as recipe_count,
          (select count(*)::int from public.v_eo_product_oils_resolved where essential_oil_id = ${input.id}) as product_count,
          (
            select count(*)::int
            from public.essential_oil_reports report
            join public.essential_oils report_oil on report_oil.id = ${input.id}
            where lower(report.oil_name) in (
              lower(report_oil.name_english),
              lower(report_oil.name_portuguese),
              lower(report_oil.name_scientific)
            )
          ) as report_count,
          (select count(*)::int from public.essential_oil_action_systems where essential_oil_id = ${input.id}) as action_system_count
      `;

      return summary ?? null;
    }),

  editorContext: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [detail, applicationMethods, pregnancyStatuses, childSafety, petSafety, actionSystems] =
        await Promise.all([
          ctx.db`
          select *
          from public.essential_oils_with_safety_ids
          where id = ${input.id}
          limit 1
        `,
          ctx.db`
          select method.id::text, method.name, method.description, method.safety_notes, method.position,
            (link.application_method_id is not null) as assigned
          from public.eo_application_methods method
          left join public.essential_oil_application_methods link
            on link.application_method_id = method.id and link.essential_oil_id = ${input.id}
          order by method.position nulls last, method.name
        `,
          ctx.db`
          select status.id::text, status.code, status.name, status.status_description,
            (link.pregnancy_nursing_status_id is not null) as assigned
          from public.eo_pregnancy_nursing_statuses status
          left join public.essential_oil_pregnancy_nursing_safety link
            on link.pregnancy_nursing_status_id = status.id and link.essential_oil_id = ${input.id}
          order by coalesce(status.name, status.status_description, status.code)
        `,
          ctx.db`
          select age_range.id::text, age_range.range_description, link.safety_notes,
            (link.age_range_id is not null) as assigned
          from public.eo_child_safety_age_ranges age_range
          left join public.essential_oil_child_safety link
            on link.age_range_id = age_range.id and link.essential_oil_id = ${input.id}
          order by age_range.range_description
        `,
          ctx.db`
          select pet.id::text, pet.animal_name, link.safety_notes,
            (link.pet_id is not null) as assigned
          from public.eo_pets pet
          left join public.essential_oil_pet_safety link
            on link.pet_id = pet.id and link.essential_oil_id = ${input.id}
          order by pet.animal_name
        `,
          ctx.db`
          select action_system.id::text, action_system.name, action_system.name_portuguese,
            action_system.action_type::text, (link.action_system_id is not null) as assigned
          from public.eo_action_systems action_system
          left join public.essential_oil_action_systems link
            on link.action_system_id = action_system.id and link.essential_oil_id = ${input.id}
          order by action_system.action_type::text, action_system.name
        `
        ]);

      return {
        detail: detail[0] ?? null,
        applicationMethods,
        pregnancyStatuses,
        childSafety,
        petSafety,
        actionSystems
      };
    }),

  facets: protectedProcedure.query(async ({ ctx }) => {
    const [
      internalUseStatuses,
      dilutionRecommendations,
      phototoxicityStatuses,
      applicationMethods,
      pregnancyStatuses,
      childSafetyAgeRanges,
      pets,
      colorLabels
    ] = await Promise.all([
      ctx.db`select id::text, code, name, description from public.eo_internal_use_statuses order by name`,
      ctx.db`
        select id::text, name, description, dilution_percentage_min::text, dilution_percentage_max::text,
          dilution_ratio
        from public.eo_dilution_recommendations
        order by name
      `,
      ctx.db`select id::text, name, description, usage_guidance from public.eo_phototoxicity_statuses order by name`,
      ctx.db`
        select id::text, name, description, safety_notes, position
        from public.eo_application_methods
        order by position nulls last, name
      `,
      ctx.db`
        select id::text, code, name, status_description, description, usage_guidance
        from public.eo_pregnancy_nursing_statuses
        order by coalesce(name, status_description, code)
      `,
      ctx.db`select id::text, range_description from public.eo_child_safety_age_ranges order by range_description`,
      ctx.db`select id::text, animal_name from public.eo_pets order by animal_name`,
      ctx.db`
        select id::text, name_english, name_portuguese, color_hex
        from public.eo_color_labels
        order by name_english
      `
    ]);

    return {
      internalUseStatuses,
      dilutionRecommendations,
      phototoxicityStatuses,
      applicationMethods,
      pregnancyStatuses,
      childSafetyAgeRanges,
      pets,
      colorLabels
    };
  }),

  createTestOil: adminProcedure
    .input(createTestOilInput.default({}))
    .mutation(async ({ ctx, input }) => {
      const suffix = new Date()
        .toISOString()
        .replace(/[-:.TZ]/g, '')
        .slice(0, 14);
      const nameEnglish = input.nameEnglish ?? `Codex Test Oil ${suffix}`;
      const namePortuguese = input.namePortuguese ?? `Oleo Teste Codex ${suffix}`;
      const nameScientific = input.nameScientific ?? `Testus codex ${suffix}`;
      const bubbleUid = `codex-test-${suffix}`;

      const [oil] = await ctx.db<OilDetailRow[]>`
      insert into public.essential_oils (
        name_english,
        name_portuguese,
        name_scientific,
        general_description,
        bubble_uid,
        created_at,
        updated_at
      )
      values (
        ${nameEnglish},
        ${namePortuguese},
        ${nameScientific},
        'Temporary test record created through the tRPC API.',
        ${bubbleUid},
        now(),
        now()
      )
      returning
        id::text as id,
        name_english,
        name_portuguese,
        name_scientific,
        general_description,
        image_url,
        bubble_uid,
        internal_use_status_id::text,
        dilution_recommendation_id::text,
        phototoxicity_status_id::text,
        color_label_id::text,
        null::text as internal_use_status_name,
        null::text as dilution_recommendation_name,
        null::text as phototoxicity_status_name,
        null::text as color_label_name,
        null::text as color_label_hex,
        null::text as pregnancy_safety_category_code,
        null::text as pregnancy_safety_category_name,
        false as has_professional_guidance,
        false as has_labor_delivery_guidance,
        null::text[] as legacy_pregnancy_tags,
        null::text[] as pregnancy_tag_codes
    `;

      await bumpOilCaches();
      return oil;
    }),

  update: adminProcedure.input(updateOilInput).mutation(async ({ ctx, input }) => {
    const [oil] = await ctx.db<OilDetailRow[]>`
      update public.essential_oils
      set
        name_english = coalesce(${input.nameEnglish ?? null}, name_english),
        name_portuguese = coalesce(${input.namePortuguese ?? null}, name_portuguese),
        name_scientific = coalesce(${input.nameScientific ?? null}, name_scientific),
        general_description = case
          when ${hasOwn(input, 'generalDescription')} then ${input.generalDescription ?? null}
          else general_description
        end,
        image_url = case
          when ${hasOwn(input, 'imageUrl')} then ${input.imageUrl ?? null}
          else image_url
        end,
        internal_use_status_id = case
          when ${hasOwn(input, 'internalUseStatusId')} then ${input.internalUseStatusId ?? null}::uuid
          else internal_use_status_id
        end,
        dilution_recommendation_id = case
          when ${hasOwn(input, 'dilutionRecommendationId')} then ${input.dilutionRecommendationId ?? null}::uuid
          else dilution_recommendation_id
        end,
        phototoxicity_status_id = case
          when ${hasOwn(input, 'phototoxicityStatusId')} then ${input.phototoxicityStatusId ?? null}::uuid
          else phototoxicity_status_id
        end,
        color_label_id = case
          when ${hasOwn(input, 'colorLabelId')} then ${input.colorLabelId ?? null}::uuid
          else color_label_id
        end,
        updated_at = now()
      where id = ${input.id}
      returning
        id::text as id,
        name_english,
        name_portuguese,
        name_scientific,
        general_description,
        image_url,
        bubble_uid,
        internal_use_status_id::text,
        dilution_recommendation_id::text,
        phototoxicity_status_id::text,
        color_label_id::text,
        null::text as internal_use_status_name,
        null::text as dilution_recommendation_name,
        null::text as phototoxicity_status_name,
        null::text as color_label_name,
        null::text as color_label_hex,
        null::text as pregnancy_safety_category_code,
        null::text as pregnancy_safety_category_name,
        false as has_professional_guidance,
        false as has_labor_delivery_guidance,
        null::text[] as legacy_pregnancy_tags,
        null::text[] as pregnancy_tag_codes
    `;

    await bumpOilCaches();
    return oil ?? null;
  }),

  linkApplicationMethod: adminProcedure
    .input(applicationMethodLinkInput)
    .mutation(async ({ ctx, input }) => {
      const [link] = await ctx.db`
      insert into public.essential_oil_application_methods (
        essential_oil_id,
        application_method_id,
        source_field
      )
      values (${input.essentialOilId}, ${input.applicationMethodId}, ${input.sourceField})
      on conflict (essential_oil_id, application_method_id) do update
      set source_field = excluded.source_field
      returning essential_oil_id::text, application_method_id::text, source_field
    `;

      await bumpOilCaches();
      return link;
    }),

  unlinkApplicationMethod: adminProcedure
    .input(applicationMethodLinkInput)
    .mutation(async ({ ctx, input }) => {
      const [link] = await ctx.db`
      delete from public.essential_oil_application_methods
      where
        essential_oil_id = ${input.essentialOilId}
        and application_method_id = ${input.applicationMethodId}
      returning essential_oil_id::text, application_method_id::text
    `;

      await bumpOilCaches();
      return { deleted: Boolean(link), link: link ?? null };
    }),

  linkPregnancyStatus: adminProcedure
    .input(pregnancyStatusLinkInput)
    .mutation(async ({ ctx, input }) => {
      const [link] = await ctx.db`
      insert into public.essential_oil_pregnancy_nursing_safety (
        essential_oil_id,
        pregnancy_nursing_status_id
      )
      values (${input.essentialOilId}, ${input.pregnancyNursingStatusId})
      on conflict (essential_oil_id, pregnancy_nursing_status_id) do nothing
      returning essential_oil_id::text, pregnancy_nursing_status_id::text
    `;

      await bumpOilCaches();
      return (
        link ?? {
          essential_oil_id: input.essentialOilId,
          pregnancy_nursing_status_id: input.pregnancyNursingStatusId
        }
      );
    }),

  unlinkPregnancyStatus: adminProcedure
    .input(pregnancyStatusLinkInput)
    .mutation(async ({ ctx, input }) => {
      const [link] = await ctx.db`
      delete from public.essential_oil_pregnancy_nursing_safety
      where
        essential_oil_id = ${input.essentialOilId}
        and pregnancy_nursing_status_id = ${input.pregnancyNursingStatusId}
      returning essential_oil_id::text, pregnancy_nursing_status_id::text
    `;

      await bumpOilCaches();
      return { deleted: Boolean(link), link: link ?? null };
    }),

  upsertChildSafety: adminProcedure.input(childSafetyInput).mutation(async ({ ctx, input }) => {
    const [link] = await ctx.db`
      insert into public.essential_oil_child_safety (
        essential_oil_id,
        age_range_id,
        safety_notes
      )
      values (${input.essentialOilId}, ${input.ageRangeId}, ${input.safetyNotes ?? null})
      on conflict (essential_oil_id, age_range_id) do update
      set safety_notes = excluded.safety_notes
      returning essential_oil_id::text, age_range_id::text, safety_notes
    `;

    await bumpOilCaches();
    return link;
  }),

  removeChildSafety: adminProcedure.input(childSafetyInput).mutation(async ({ ctx, input }) => {
    const [link] = await ctx.db`
      delete from public.essential_oil_child_safety
      where essential_oil_id = ${input.essentialOilId} and age_range_id = ${input.ageRangeId}
      returning essential_oil_id::text, age_range_id::text
    `;

    await bumpOilCaches();
    return { deleted: Boolean(link), link: link ?? null };
  }),

  upsertPetSafety: adminProcedure.input(petSafetyInput).mutation(async ({ ctx, input }) => {
    const [link] = await ctx.db`
      insert into public.essential_oil_pet_safety (
        essential_oil_id,
        pet_id,
        safety_notes
      )
      values (${input.essentialOilId}, ${input.petId}, ${input.safetyNotes ?? null})
      on conflict (essential_oil_id, pet_id) do update
      set safety_notes = excluded.safety_notes
      returning essential_oil_id::text, pet_id::text, safety_notes
    `;

    await bumpOilCaches();
    return link;
  }),

  removePetSafety: adminProcedure.input(petSafetyInput).mutation(async ({ ctx, input }) => {
    const [link] = await ctx.db`
      delete from public.essential_oil_pet_safety
      where essential_oil_id = ${input.essentialOilId} and pet_id = ${input.petId}
      returning essential_oil_id::text, pet_id::text
    `;

    await bumpOilCaches();
    return { deleted: Boolean(link), link: link ?? null };
  }),

  linkActionSystem: adminProcedure.input(actionSystemLinkInput).mutation(async ({ ctx, input }) => {
    const [link] = await ctx.db`
      insert into public.essential_oil_action_systems (
        essential_oil_id,
        action_system_id,
        source_field
      )
      values (${input.essentialOilId}, ${input.actionSystemId}, ${input.sourceField})
      on conflict (essential_oil_id, action_system_id) do update
      set source_field = excluded.source_field
      returning essential_oil_id::text, action_system_id::text, source_field
    `;

    await bumpCacheDomainVersions(['oils', 'healthKnowledge', 'dashboard']);
    return link;
  }),

  unlinkActionSystem: adminProcedure
    .input(actionSystemLinkInput)
    .mutation(async ({ ctx, input }) => {
      const [link] = await ctx.db`
      delete from public.essential_oil_action_systems
      where essential_oil_id = ${input.essentialOilId} and action_system_id = ${input.actionSystemId}
      returning essential_oil_id::text, action_system_id::text
    `;

      await bumpCacheDomainVersions(['oils', 'healthKnowledge', 'dashboard']);
      return { deleted: Boolean(link), link: link ?? null };
    }),

  hardDelete: adminProcedure.input(hardDeleteInput).mutation(async ({ ctx, input }) => {
    const [userProtocolRefs] = await ctx.db<CountRow[]>`
      select count(*)::text as count
      from public.user_protocol_property_suggested_oils
      where oil_id = ${input.id}
    `;
    const [userRecipeRefs] = await ctx.db<CountRow[]>`
      select count(*)::text as count
      from public.user_saved_recipe_oils
      where oil_id = ${input.id}
    `;

    if (Number(userProtocolRefs?.count ?? 0) > 0 || Number(userRecipeRefs?.count ?? 0) > 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Cannot hard delete an oil that is referenced by saved user data'
      });
    }

    return ctx.db.begin(async (tx) => {
      await tx`delete from public.eo_health_concern_recipe_oils where essential_oil_id = ${input.id}`;
      await tx`delete from public.eo_product_oils where essential_oil_id = ${input.id}`;
      await tx`delete from public.essential_oil_action_systems where essential_oil_id = ${input.id}`;
      await tx`delete from public.essential_oil_application_methods where essential_oil_id = ${input.id}`;
      await tx`delete from public.essential_oil_aroma_notes where essential_oil_id = ${input.id}`;
      await tx`delete from public.essential_oil_aroma_scents where essential_oil_id = ${input.id}`;
      await tx`delete from public.essential_oil_chakra_association where essential_oil_id = ${input.id}`;
      await tx`delete from public.essential_oil_chemical_compounds where essential_oil_id = ${input.id}`;
      await tx`delete from public.essential_oil_child_safety where essential_oil_id = ${input.id}`;
      await tx`delete from public.essential_oil_energetic_emotional_properties where essential_oil_id = ${input.id}`;
      await tx`delete from public.essential_oil_extraction_countries where essential_oil_id = ${input.id}`;
      await tx`delete from public.essential_oil_extraction_methods where essential_oil_id = ${input.id}`;
      await tx`delete from public.essential_oil_health_concern where essential_oil_id = ${input.id}`;
      await tx`delete from public.essential_oil_pet_safety where essential_oil_id = ${input.id}`;
      await tx`delete from public.essential_oil_plant_parts where essential_oil_id = ${input.id}`;
      await tx`delete from public.essential_oil_pregnancy_nursing_safety where essential_oil_id = ${input.id}`;
      await tx`delete from public.essential_oil_therapeutic_properties where essential_oil_id = ${input.id}`;
      const [oil] = await tx`
        delete from public.essential_oils
        where id = ${input.id}
        returning id::text, name_english, name_portuguese
      `;

      await bumpCacheDomainVersions([
        'oils',
        'chemistry',
        'recipes',
        'products',
        'healthKnowledge',
        'dashboard'
      ]);

      return {
        deleted: Boolean(oil),
        oil: oil ?? null
      };
    });
  })
});
