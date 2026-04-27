import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';

const categoryCode = z.enum([
  'pregnancy_safe_all_trimesters',
  'pregnancy_safe_after_first_trimester',
  'pregnancy_professional_guidance',
  'pregnancy_no_specific_guidance'
]);

type PregnancyStatusRow = {
  id: string;
  code: string | null;
  name: string | null;
  description: string | null;
  usage_guidance: string | null;
  status_description: string | null;
};

type PregnancyProfileRow = {
  essential_oil_id: string;
  oil_name_english: string | null;
  oil_name_portuguese: string | null;
  pregnancy_safety_category_code: string | null;
  pregnancy_safety_category_name: string | null;
  matches_safe_all_trimesters_filter: boolean | null;
  matches_safe_after_first_trimester_filter: boolean | null;
  matches_professional_guidance_filter: boolean | null;
  has_labor_delivery_guidance: boolean | null;
  has_lactation_guidance: boolean | null;
};

export const pregnancyRouter = createTRPCRouter({
  statuses: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db<PregnancyStatusRow[]>`
      select
        id::text as id,
        code,
        name,
        description,
        usage_guidance,
        status_description
      from public.eo_pregnancy_nursing_statuses
      order by coalesce(name, status_description, code)
    `;
  }),

  profiles: protectedProcedure
    .input(
      z.object({
        category: categoryCode.optional(),
        limit: z.number().int().min(1).max(200).default(100)
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.db<PregnancyProfileRow[]>`
        select
          essential_oil_id::text as essential_oil_id,
          oil_name_english,
          oil_name_portuguese,
          pregnancy_safety_category_code,
          pregnancy_safety_category_name,
          matches_safe_all_trimesters_filter,
          matches_safe_after_first_trimester_filter,
          matches_professional_guidance_filter,
          has_labor_delivery_guidance,
          has_lactation_guidance
        from public.v_oil_pregnancy_safety_profile
        where
          ${input.category ?? null}::text is null
          or pregnancy_safety_category_code = ${input.category ?? null}
        order by lower(coalesce(oil_name_portuguese, oil_name_english))
        limit ${input.limit}
      `;
    })
});
