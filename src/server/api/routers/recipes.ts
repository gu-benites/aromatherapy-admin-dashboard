import { z } from 'zod';
import { adminProcedure, createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { bumpCacheDomainVersions } from '@/server/cache/redis';

const instructionTypeSchema = z.enum(['preparation', 'usage_protocol']);
const parseStatusSchema = z.enum(['mapped', 'empty', 'ambiguous', 'unmapped']);

const createRecipeInput = z.object({
  bubbleUid: z.string().trim().min(1).max(160),
  healthConcernId: z.string().uuid().optional(),
  recipeTitle: z.string().trim().min(1).max(240),
  fullRecipeText: z.string().trim().max(5000).optional(),
  explanation: z.string().trim().max(3000).optional(),
  applicationMethodText: z.string().trim().max(1000).optional(),
  carrierOilText: z.string().trim().max(1000).optional(),
  bottleSizeText: z.string().trim().max(500).optional(),
  capTypeText: z.string().trim().max(500).optional(),
  preparationInstructionsText: z.string().trim().max(3000).optional(),
  usageProtocolText: z.string().trim().max(3000).optional(),
  oilDropsText: z.string().trim().max(1000).optional(),
  targetAudienceText: z.string().trim().max(1000).optional(),
  reviewedByDaiane: z.boolean().default(false)
});

const addRecipeOilInput = z.object({
  recipeId: z.string().uuid(),
  essentialOilId: z.string().uuid(),
  oilOrder: z.number().int().min(1).optional(),
  dropsCount: z.number().int().min(0).max(200).optional(),
  rawOilLine: z.string().trim().max(500).optional()
});

const updateRecipeInput = createRecipeInput.partial().extend({
  id: z.string().uuid()
});

const addInstructionInput = z.object({
  recipeId: z.string().uuid(),
  instructionType: instructionTypeSchema,
  stepOrder: z.number().int().min(1),
  instructionText: z.string().trim().min(1).max(2000)
});

const addApplicationMethodInput = z.object({
  recipeId: z.string().uuid(),
  methodName: z.string().trim().min(1).max(120),
  sourceText: z.string().trim().max(500).optional(),
  parseStatus: parseStatusSchema.default('mapped')
});

const updateApplicationMethodInput = z.object({
  id: z.string().uuid(),
  sourceText: z.string().trim().max(500).optional(),
  parseStatus: parseStatusSchema.optional()
});

const listInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).optional(),
  reviewed: z.boolean().optional(),
  healthConcernId: z.string().uuid().optional(),
  applicationMethodId: z.string().uuid().optional(),
  completeness: z
    .enum(['complete', 'missing_oils', 'missing_instructions', 'unreviewed'])
    .optional()
});

const hardDeleteInput = z.object({
  id: z.string().uuid(),
  confirmation: z.literal('EXCLUIR')
});

type RecipeRow = {
  id: string;
  bubble_uid: string;
  health_concern_id: string | null;
  recipe_title: string | null;
  full_recipe_text: string | null;
  explanation: string | null;
  application_method_text: string | null;
  carrier_oil_text: string | null;
  bottle_size_text: string | null;
  cap_type_text: string | null;
  preparation_instructions_text: string | null;
  usage_protocol_text: string | null;
  oil_drops_text: string | null;
  target_audience_text: string | null;
  reviewed_by_daiane: boolean;
};

export const recipesRouter = createTRPCRouter({
  list: protectedProcedure.input(listInput).query(async ({ ctx, input }) => {
    const searchPattern = input.search ? `%${input.search}%` : null;
    const offset = (input.page - 1) * input.pageSize;

    const rows = await ctx.db`
      select
        recipe.id::text,
        recipe.recipe_title,
        recipe.health_concern_id::text,
        concern.benefit_name as health_concern,
        recipe.reviewed_by_daiane,
        (select count(*)::int from public.eo_health_concern_recipe_oils oil where oil.recipe_id = recipe.id) as oil_count,
        (select count(*)::int from public.eo_health_concern_recipe_instructions instruction where instruction.recipe_id = recipe.id) as instruction_count,
        (select count(*)::int from public.eo_health_concern_recipe_application_methods method where method.recipe_id = recipe.id) as application_method_count
      from public.eo_health_concern_recipes recipe
      left join public.eo_health_concerns concern on concern.id = recipe.health_concern_id
      where
        (${searchPattern}::text is null or recipe.recipe_title ilike ${searchPattern} or recipe.full_recipe_text ilike ${searchPattern})
        and (${input.reviewed ?? null}::boolean is null or recipe.reviewed_by_daiane = ${input.reviewed ?? null})
        and (${input.healthConcernId ?? null}::uuid is null or recipe.health_concern_id = ${input.healthConcernId ?? null})
        and (${input.applicationMethodId ?? null}::uuid is null or exists (
          select 1 from public.eo_health_concern_recipe_application_methods method
          where method.recipe_id = recipe.id and method.application_method_id = ${input.applicationMethodId ?? null}
        ))
        and (
          ${input.completeness ?? null}::text is null
          or (${input.completeness ?? null} = 'unreviewed' and recipe.reviewed_by_daiane = false)
          or (${input.completeness ?? null} = 'missing_oils' and not exists (
            select 1 from public.eo_health_concern_recipe_oils oil where oil.recipe_id = recipe.id
          ))
          or (${input.completeness ?? null} = 'missing_instructions' and not exists (
            select 1 from public.eo_health_concern_recipe_instructions instruction where instruction.recipe_id = recipe.id
          ))
          or (${input.completeness ?? null} = 'complete'
            and recipe.reviewed_by_daiane = true
            and exists (select 1 from public.eo_health_concern_recipe_oils oil where oil.recipe_id = recipe.id)
            and exists (select 1 from public.eo_health_concern_recipe_instructions instruction where instruction.recipe_id = recipe.id)
            and exists (select 1 from public.eo_health_concern_recipe_application_methods method where method.recipe_id = recipe.id)
          )
        )
      order by recipe.reviewed_by_daiane asc, recipe.recipe_title nulls last
      limit ${input.pageSize}
      offset ${offset}
    `;

    const [totalRow] = await ctx.db<{ count: string }[]>`
      select count(*)::text as count
      from public.eo_health_concern_recipes recipe
      where
        (${searchPattern}::text is null or recipe.recipe_title ilike ${searchPattern} or recipe.full_recipe_text ilike ${searchPattern})
        and (${input.reviewed ?? null}::boolean is null or recipe.reviewed_by_daiane = ${input.reviewed ?? null})
        and (${input.healthConcernId ?? null}::uuid is null or recipe.health_concern_id = ${input.healthConcernId ?? null})
    `;

    return {
      items: rows,
      page: input.page,
      pageSize: input.pageSize,
      total: Number(totalRow?.count ?? 0)
    };
  }),

  kanban: protectedProcedure
    .input(
      z.object({
        groupBy: z
          .enum(['review_status', 'completeness', 'health_concern'])
          .default('review_status')
      })
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db`
        select
          recipe.id::text,
          recipe.recipe_title,
          recipe.reviewed_by_daiane,
          concern.benefit_name as health_concern,
          (select count(*)::int from public.eo_health_concern_recipe_oils oil where oil.recipe_id = recipe.id) as oil_count,
          (select count(*)::int from public.eo_health_concern_recipe_instructions instruction where instruction.recipe_id = recipe.id) as instruction_count,
          (select count(*)::int from public.eo_health_concern_recipe_application_methods method where method.recipe_id = recipe.id) as application_method_count
        from public.eo_health_concern_recipes recipe
        left join public.eo_health_concerns concern on concern.id = recipe.health_concern_id
        order by recipe.updated_at desc
        limit 250
      `;

      return {
        groupBy: input.groupBy,
        items: rows.map((row) => {
          const oilCount = Number(row.oil_count ?? 0);
          const instructionCount = Number(row.instruction_count ?? 0);
          const methodCount = Number(row.application_method_count ?? 0);
          const completeness =
            oilCount === 0
              ? 'missing_oils'
              : instructionCount === 0
                ? 'missing_instructions'
                : methodCount === 0
                  ? 'missing_application_methods'
                  : 'complete';

          return {
            ...row,
            group:
              input.groupBy === 'review_status'
                ? row.reviewed_by_daiane
                  ? 'reviewed'
                  : 'unreviewed'
                : input.groupBy === 'health_concern'
                  ? (row.health_concern ?? 'No concern')
                  : completeness,
            completeness
          };
        })
      };
    }),

  completenessSummary: protectedProcedure.query(async ({ ctx }) => {
    const [summary] = await ctx.db`
      select
        count(*)::int as total_recipes,
        count(*) filter (where reviewed_by_daiane)::int as reviewed,
        count(*) filter (where not reviewed_by_daiane)::int as unreviewed,
        count(*) filter (where not exists (
          select 1 from public.eo_health_concern_recipe_oils oil where oil.recipe_id = recipe.id
        ))::int as missing_oils,
        count(*) filter (where not exists (
          select 1 from public.eo_health_concern_recipe_instructions instruction where instruction.recipe_id = recipe.id
        ))::int as missing_instructions,
        count(*) filter (where not exists (
          select 1 from public.eo_health_concern_recipe_application_methods method where method.recipe_id = recipe.id
        ))::int as missing_application_methods
      from public.eo_health_concern_recipes recipe
    `;

    return summary;
  }),

  reviewQueue: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
        issue: z.enum(['unreviewed', 'missing_oils', 'missing_instructions']).default('unreviewed')
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.db`
        select recipe.id::text, recipe.recipe_title, recipe.reviewed_by_daiane, concern.benefit_name as health_concern
        from public.eo_health_concern_recipes recipe
        left join public.eo_health_concerns concern on concern.id = recipe.health_concern_id
        where
          (${input.issue} = 'unreviewed' and recipe.reviewed_by_daiane = false)
          or (${input.issue} = 'missing_oils' and not exists (
            select 1 from public.eo_health_concern_recipe_oils oil where oil.recipe_id = recipe.id
          ))
          or (${input.issue} = 'missing_instructions' and not exists (
            select 1 from public.eo_health_concern_recipe_instructions instruction where instruction.recipe_id = recipe.id
          ))
        order by recipe.updated_at desc
        limit ${input.pageSize}
        offset ${(input.page - 1) * input.pageSize}
      `;
    }),

  facets: protectedProcedure.query(async ({ ctx }) => {
    const applicationMethods =
      await ctx.db`select id::text, name, description, position from public.eo_application_methods order by position nulls last, name`;

    return { applicationMethods };
  }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [recipe] = await ctx.db<RecipeRow[]>`
      select
        id::text as id,
        bubble_uid,
        health_concern_id::text,
        recipe_title,
        full_recipe_text,
        explanation,
        application_method_text,
        carrier_oil_text,
        bottle_size_text,
        cap_type_text,
        preparation_instructions_text,
        usage_protocol_text,
        oil_drops_text,
        target_audience_text,
        reviewed_by_daiane
      from public.eo_health_concern_recipes
      where id = ${input.id}
      limit 1
    `;

      if (!recipe) {
        return null;
      }

      const oils = await ctx.db<
        {
          essential_oil_id: string;
          oil_name_english: string | null;
          oil_name_portuguese: string | null;
          oil_order: number | null;
          drops_count: number | null;
          raw_oil_line: string | null;
        }[]
      >`
      select
        recipe_oil.essential_oil_id::text,
        oil.name_english as oil_name_english,
        oil.name_portuguese as oil_name_portuguese,
        recipe_oil.oil_order,
        recipe_oil.drops_count,
        recipe_oil.raw_oil_line
      from public.eo_health_concern_recipe_oils recipe_oil
      join public.essential_oils oil
        on oil.id = recipe_oil.essential_oil_id
      where recipe_oil.recipe_id = ${input.id}
      order by recipe_oil.oil_order nulls last, oil.name_english
    `;

      const instructions = await ctx.db<
        {
          id: string;
          instruction_type: string;
          step_order: number;
          instruction_text: string;
        }[]
      >`
      select
        id::text,
        instruction_type::text,
        step_order,
        instruction_text
      from public.eo_health_concern_recipe_instructions
      where recipe_id = ${input.id}
      order by instruction_type, step_order
    `;

      const applicationMethods = await ctx.db<
        {
          id: string;
          method_name: string | null;
          source_text: string | null;
          parse_status: string;
        }[]
      >`
      select
        recipe_method.id::text,
        method.name as method_name,
        recipe_method.source_text,
        recipe_method.parse_status::text
      from public.eo_health_concern_recipe_application_methods recipe_method
      left join public.eo_application_methods method
        on method.id = recipe_method.application_method_id
      where recipe_method.recipe_id = ${input.id}
      order by method.name nulls last, recipe_method.source_text
    `;

      return {
        recipe,
        oils,
        instructions,
        applicationMethods
      };
    }),

  create: adminProcedure.input(createRecipeInput).mutation(async ({ ctx, input }) => {
    const [recipe] = await ctx.db<RecipeRow[]>`
      insert into public.eo_health_concern_recipes (
        bubble_uid,
        health_concern_id,
        recipe_title,
        full_recipe_text,
        explanation,
        application_method_text,
        carrier_oil_text,
        bottle_size_text,
        cap_type_text,
        preparation_instructions_text,
        usage_protocol_text,
        oil_drops_text,
        target_audience_text,
        reviewed_by_daiane,
        updated_at
      )
      values (
        ${input.bubbleUid},
        ${input.healthConcernId ?? null},
        ${input.recipeTitle},
        ${input.fullRecipeText ?? null},
        ${input.explanation ?? null},
        ${input.applicationMethodText ?? null},
        ${input.carrierOilText ?? null},
        ${input.bottleSizeText ?? null},
        ${input.capTypeText ?? null},
        ${input.preparationInstructionsText ?? null},
        ${input.usageProtocolText ?? null},
        ${input.oilDropsText ?? null},
        ${input.targetAudienceText ?? null},
        ${input.reviewedByDaiane},
        now()
      )
      on conflict (bubble_uid) do update
      set
        health_concern_id = excluded.health_concern_id,
        recipe_title = excluded.recipe_title,
        full_recipe_text = excluded.full_recipe_text,
        explanation = excluded.explanation,
        application_method_text = excluded.application_method_text,
        carrier_oil_text = excluded.carrier_oil_text,
        bottle_size_text = excluded.bottle_size_text,
        cap_type_text = excluded.cap_type_text,
        preparation_instructions_text = excluded.preparation_instructions_text,
        usage_protocol_text = excluded.usage_protocol_text,
        oil_drops_text = excluded.oil_drops_text,
        target_audience_text = excluded.target_audience_text,
        reviewed_by_daiane = excluded.reviewed_by_daiane,
        updated_at = now()
      returning
        id::text as id,
        bubble_uid,
        health_concern_id::text,
        recipe_title,
        full_recipe_text,
        explanation,
        application_method_text,
        carrier_oil_text,
        bottle_size_text,
        cap_type_text,
        preparation_instructions_text,
        usage_protocol_text,
        oil_drops_text,
        target_audience_text,
        reviewed_by_daiane
    `;

    await bumpCacheDomainVersions(['recipes', 'healthKnowledge', 'oils', 'dashboard']);
    return recipe;
  }),

  update: adminProcedure.input(updateRecipeInput).mutation(async ({ ctx, input }) => {
    const [recipe] = await ctx.db<RecipeRow[]>`
      update public.eo_health_concern_recipes
      set
        bubble_uid = coalesce(${input.bubbleUid ?? null}, bubble_uid),
        health_concern_id = coalesce(${input.healthConcernId ?? null}, health_concern_id),
        recipe_title = coalesce(${input.recipeTitle ?? null}, recipe_title),
        full_recipe_text = coalesce(${input.fullRecipeText ?? null}, full_recipe_text),
        explanation = coalesce(${input.explanation ?? null}, explanation),
        application_method_text = coalesce(${input.applicationMethodText ?? null}, application_method_text),
        carrier_oil_text = coalesce(${input.carrierOilText ?? null}, carrier_oil_text),
        bottle_size_text = coalesce(${input.bottleSizeText ?? null}, bottle_size_text),
        cap_type_text = coalesce(${input.capTypeText ?? null}, cap_type_text),
        preparation_instructions_text = coalesce(
          ${input.preparationInstructionsText ?? null},
          preparation_instructions_text
        ),
        usage_protocol_text = coalesce(${input.usageProtocolText ?? null}, usage_protocol_text),
        oil_drops_text = coalesce(${input.oilDropsText ?? null}, oil_drops_text),
        target_audience_text = coalesce(${input.targetAudienceText ?? null}, target_audience_text),
        reviewed_by_daiane = coalesce(${input.reviewedByDaiane ?? null}, reviewed_by_daiane),
        updated_at = now()
      where id = ${input.id}
      returning
        id::text as id,
        bubble_uid,
        health_concern_id::text,
        recipe_title,
        full_recipe_text,
        explanation,
        application_method_text,
        carrier_oil_text,
        bottle_size_text,
        cap_type_text,
        preparation_instructions_text,
        usage_protocol_text,
        oil_drops_text,
        target_audience_text,
        reviewed_by_daiane
    `;

    await bumpCacheDomainVersions(['recipes', 'healthKnowledge', 'oils', 'dashboard']);
    return recipe ?? null;
  }),

  addOil: adminProcedure.input(addRecipeOilInput).mutation(async ({ ctx, input }) => {
    const [link] = await ctx.db<
      {
        recipe_id: string;
        essential_oil_id: string;
        oil_order: number | null;
        drops_count: number | null;
        raw_oil_line: string | null;
      }[]
    >`
      insert into public.eo_health_concern_recipe_oils (
        recipe_id,
        essential_oil_id,
        oil_order,
        drops_count,
        raw_oil_line
      )
      values (
        ${input.recipeId},
        ${input.essentialOilId},
        ${input.oilOrder ?? null},
        ${input.dropsCount ?? null},
        ${input.rawOilLine ?? null}
      )
      on conflict (recipe_id, essential_oil_id) do update
      set
        oil_order = excluded.oil_order,
        drops_count = excluded.drops_count,
        raw_oil_line = excluded.raw_oil_line
      returning
        recipe_id::text,
        essential_oil_id::text,
        oil_order,
        drops_count,
        raw_oil_line
    `;

    await bumpCacheDomainVersions(['recipes', 'oils', 'dashboard']);
    return link;
  }),

  removeOil: adminProcedure
    .input(z.object({ recipeId: z.string().uuid(), essentialOilId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [link] = await ctx.db<
        {
          recipe_id: string;
          essential_oil_id: string;
        }[]
      >`
        delete from public.eo_health_concern_recipe_oils
        where
          recipe_id = ${input.recipeId}
          and essential_oil_id = ${input.essentialOilId}
        returning recipe_id::text, essential_oil_id::text
      `;

      await bumpCacheDomainVersions(['recipes', 'oils', 'dashboard']);
      return {
        deleted: Boolean(link),
        link: link ?? null
      };
    }),

  addInstruction: adminProcedure.input(addInstructionInput).mutation(async ({ ctx, input }) => {
    const [instruction] = await ctx.db<
      {
        id: string;
        recipe_id: string;
        instruction_type: string;
        step_order: number;
        instruction_text: string;
      }[]
    >`
      insert into public.eo_health_concern_recipe_instructions (
        recipe_id,
        instruction_type,
        step_order,
        instruction_text
      )
      values (
        ${input.recipeId},
        ${input.instructionType}::eo_health_concern_recipe_instruction_type,
        ${input.stepOrder},
        ${input.instructionText}
      )
      on conflict (recipe_id, instruction_type, step_order) do update
      set instruction_text = excluded.instruction_text
      returning
        id::text,
        recipe_id::text,
        instruction_type::text,
        step_order,
        instruction_text
    `;

    await bumpCacheDomainVersions(['recipes', 'dashboard']);
    return instruction;
  }),

  removeInstruction: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [instruction] = await ctx.db<
        {
          id: string;
          recipe_id: string;
        }[]
      >`
      delete from public.eo_health_concern_recipe_instructions
      where id = ${input.id}
      returning id::text, recipe_id::text
    `;

      await bumpCacheDomainVersions(['recipes', 'dashboard']);
      return {
        deleted: Boolean(instruction),
        instruction: instruction ?? null
      };
    }),

  addApplicationMethod: adminProcedure
    .input(addApplicationMethodInput)
    .mutation(async ({ ctx, input }) => {
      return ctx.db.begin(async (tx) => {
        const [method] = await tx<{ id: string; name: string }[]>`
        insert into public.eo_application_methods (
          name,
          updated_at
        )
        values (${input.methodName}, now())
        on conflict (name) do update
        set updated_at = now()
        returning id::text, name
      `;

        const [link] = await tx<
          {
            id: string;
            recipe_id: string;
            application_method_id: string | null;
            source_text: string | null;
            parse_status: string;
          }[]
        >`
        insert into public.eo_health_concern_recipe_application_methods (
          recipe_id,
          application_method_id,
          source_text,
          parse_status
        )
        values (
          ${input.recipeId},
          ${method.id},
          ${input.sourceText ?? null},
          ${input.parseStatus}::eo_health_concern_recipe_application_method_parse_status
        )
        returning
          id::text,
          recipe_id::text,
          application_method_id::text,
          source_text,
          parse_status::text
      `;

        await bumpCacheDomainVersions(['recipes', 'dashboard']);
        return {
          method,
          link
        };
      });
    }),

  updateApplicationMethod: adminProcedure
    .input(updateApplicationMethodInput)
    .mutation(async ({ ctx, input }) => {
      const [link] = await ctx.db<
        {
          id: string;
          recipe_id: string;
          application_method_id: string | null;
          source_text: string | null;
          parse_status: string;
        }[]
      >`
        update public.eo_health_concern_recipe_application_methods
        set
          source_text = coalesce(${input.sourceText ?? null}, source_text),
          parse_status = coalesce(
            ${input.parseStatus ?? null}::eo_health_concern_recipe_application_method_parse_status,
            parse_status
          )
        where id = ${input.id}
        returning
          id::text,
          recipe_id::text,
          application_method_id::text,
          source_text,
          parse_status::text
      `;

      await bumpCacheDomainVersions(['recipes', 'dashboard']);
      return link ?? null;
    }),

  removeApplicationMethod: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [link] = await ctx.db<
        {
          id: string;
          recipe_id: string;
        }[]
      >`
        delete from public.eo_health_concern_recipe_application_methods
        where id = ${input.id}
        returning id::text, recipe_id::text
      `;

      await bumpCacheDomainVersions(['recipes', 'dashboard']);
      return {
        deleted: Boolean(link),
        link: link ?? null
      };
    }),

  hardDelete: adminProcedure.input(hardDeleteInput).mutation(async ({ ctx, input }) => {
    return ctx.db.begin(async (tx) => {
      await tx`delete from public.eo_health_concern_recipe_application_methods where recipe_id = ${input.id}`;
      await tx`delete from public.eo_health_concern_recipe_instructions where recipe_id = ${input.id}`;
      await tx`delete from public.eo_health_concern_recipe_oils where recipe_id = ${input.id}`;
      const [recipe] = await tx`
        delete from public.eo_health_concern_recipes
        where id = ${input.id}
        returning id::text, bubble_uid, recipe_title
      `;

      await bumpCacheDomainVersions(['recipes', 'healthKnowledge', 'oils', 'dashboard']);

      return {
        deleted: Boolean(recipe),
        recipe: recipe ?? null
      };
    });
  })
});
