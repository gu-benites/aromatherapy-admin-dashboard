import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { adminProcedure, createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { bumpCacheDomainVersions } from '@/server/cache/redis';

const listInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).optional(),
  productTypeId: z.string().uuid().optional(),
  colorLabelId: z.string().uuid().optional(),
  countryCode: z.string().trim().min(2).max(8).optional(),
  hasResolvedOils: z.boolean().optional()
});

const productInput = z.object({
  bubbleUid: z.string().trim().min(1).max(160),
  nameEnglish: z.string().trim().min(1).max(180),
  namePortuguese: z.string().trim().max(180).nullable().optional(),
  imageUrl: z.string().trim().url().nullable().optional(),
  productNumber: z.string().trim().max(80).nullable().optional(),
  officialUrl: z.string().trim().url().nullable().optional(),
  countryCode: z.string().trim().max(8).nullable().optional(),
  primaryProductTypeId: z.string().uuid().nullable().optional(),
  colorLabelId: z.string().uuid().nullable().optional(),
  isMainProduct: z.boolean().nullable().optional()
});

const updateProductInput = productInput.partial().extend({
  id: z.string().uuid()
});

const productOilInput = z.object({
  productId: z.string().uuid(),
  essentialOilId: z.string().uuid(),
  componentBubbleUid: z.string().trim().max(160).optional(),
  componentPosition: z.number().int().min(0).nullable().optional(),
  sourceField: z.string().trim().max(160).default('admin')
});

const productTypeInput = z.object({
  productId: z.string().uuid(),
  productTypeId: z.string().uuid()
});

const hardDeleteInput = z.object({
  id: z.string().uuid(),
  confirmation: z.literal('EXCLUIR')
});

type CountRow = {
  count: string;
};

function hasOwn(input: object, field: string) {
  return Object.prototype.hasOwnProperty.call(input, field);
}

async function bumpProductCaches() {
  await bumpCacheDomainVersions(['products', 'oils', 'dashboard']);
}

export const productsRouter = createTRPCRouter({
  list: protectedProcedure.input(listInput).query(async ({ ctx, input }) => {
    const offset = (input.page - 1) * input.pageSize;
    const searchPattern = input.search ? `%${input.search}%` : null;

    const rows = await ctx.db`
      select
        product.id::text,
        product.bubble_uid,
        product.name_english,
        product.name_portuguese,
        product.image_url,
        product.product_number,
        product.country_code,
        product.member_price::text,
        product.regular_price::text,
        color_label.name_english as color_label_name,
        color_label.color_hex as color_label_hex,
        primary_type.name as primary_product_type_name,
        coalesce(resolved.resolved_oil_count, 0)::int as resolved_oil_count,
        coalesce(types.product_type_names, array[]::text[]) as product_type_names
      from public.eo_products product
      left join public.eo_color_labels color_label
        on color_label.id = product.color_label_id
      left join public.eo_product_types primary_type
        on primary_type.id = product.primary_product_type_id
      left join lateral (
        select count(*)::int as resolved_oil_count
        from public.v_eo_product_oils_resolved resolved
        where resolved.product_id = product.id
      ) resolved on true
      left join lateral (
        select array_agg(product_type.name order by product_type.name) as product_type_names
        from public.eo_product_type_assignments assignment
        join public.eo_product_types product_type on product_type.id = assignment.product_type_id
        where assignment.product_id = product.id
      ) types on true
      where
        (
          ${searchPattern}::text is null
          or product.name_english ilike ${searchPattern}
          or product.name_portuguese ilike ${searchPattern}
          or product.product_number ilike ${searchPattern}
        )
        and (${input.productTypeId ?? null}::uuid is null or exists (
          select 1 from public.eo_product_type_assignments assignment
          where assignment.product_id = product.id and assignment.product_type_id = ${input.productTypeId ?? null}
        ))
        and (${input.colorLabelId ?? null}::uuid is null or product.color_label_id = ${input.colorLabelId ?? null})
        and (${input.countryCode ?? null}::text is null or product.country_code = ${input.countryCode ?? null})
        and (
          ${input.hasResolvedOils ?? null}::boolean is null
          or (${input.hasResolvedOils ?? null} = true and coalesce(resolved.resolved_oil_count, 0) > 0)
          or (${input.hasResolvedOils ?? null} = false and coalesce(resolved.resolved_oil_count, 0) = 0)
        )
      order by lower(coalesce(product.name_portuguese, product.name_english))
      limit ${input.pageSize}
      offset ${offset}
    `;

    const [totalRow] = await ctx.db<CountRow[]>`
      select count(*)::text as count
      from public.eo_products product
      where
        (
          ${searchPattern}::text is null
          or product.name_english ilike ${searchPattern}
          or product.name_portuguese ilike ${searchPattern}
          or product.product_number ilike ${searchPattern}
        )
        and (${input.productTypeId ?? null}::uuid is null or exists (
          select 1 from public.eo_product_type_assignments assignment
          where assignment.product_id = product.id and assignment.product_type_id = ${input.productTypeId ?? null}
        ))
        and (${input.colorLabelId ?? null}::uuid is null or product.color_label_id = ${input.colorLabelId ?? null})
        and (${input.countryCode ?? null}::text is null or product.country_code = ${input.countryCode ?? null})
        and (
          ${input.hasResolvedOils ?? null}::boolean is null
          or (${input.hasResolvedOils ?? null} = true and exists (
            select 1 from public.v_eo_product_oils_resolved resolved where resolved.product_id = product.id
          ))
          or (${input.hasResolvedOils ?? null} = false and not exists (
            select 1 from public.v_eo_product_oils_resolved resolved where resolved.product_id = product.id
          ))
        )
    `;

    return {
      items: rows,
      page: input.page,
      pageSize: input.pageSize,
      total: Number(totalRow?.count ?? 0)
    };
  }),

  detail: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [product] = await ctx.db`
      select
        product.id::text,
        product.bubble_uid,
        product.main_product_id::text,
        product.primary_product_type_id::text,
        product.name_english,
        product.name_portuguese,
        product.image_url,
        product.product_number,
        product.anvisa_processo,
        product.official_url,
        product.country_code,
        product.is_main_product,
        product.pv::text,
        product.regular_price::text,
        product.member_price::text,
        product.quantity::text,
        product.bottle_size_unit,
        product.color_label_id::text,
        color_label.name_english as color_label_name,
        color_label.color_hex as color_label_hex
      from public.eo_products product
      left join public.eo_color_labels color_label on color_label.id = product.color_label_id
      where product.id = ${input.id}
      limit 1
    `;

      if (!product) return null;

      const [types, composition] = await Promise.all([
        ctx.db`
        select product_type.id::text, product_type.name, product_type.slug
        from public.eo_product_type_assignments assignment
        join public.eo_product_types product_type on product_type.id = assignment.product_type_id
        where assignment.product_id = ${input.id}
        order by product_type.name
      `,
        ctx.db`
        select
          resolved.essential_oil_id::text,
          oil.name_english as oil_name_english,
          oil.name_portuguese as oil_name_portuguese,
          resolved.component_bubble_uid,
          resolved.component_position,
          resolved.resolution_source
        from public.v_eo_product_oils_resolved resolved
        join public.essential_oils oil on oil.id = resolved.essential_oil_id
        where resolved.product_id = ${input.id}
        order by resolved.component_position nulls last, oil.name_english
      `
      ]);

      return { product, types, composition };
    }),

  composition: protectedProcedure
    .input(z.object({ id: z.string().uuid(), resolved: z.boolean().default(true) }))
    .query(async ({ ctx, input }) => {
      if (input.resolved) {
        return ctx.db`
          select
            resolved.product_id::text,
            resolved.essential_oil_id::text,
            oil.name_english as oil_name_english,
            oil.name_portuguese as oil_name_portuguese,
            resolved.component_bubble_uid,
            resolved.component_position,
            resolved.resolution_source
          from public.v_eo_product_oils_resolved resolved
          join public.essential_oils oil on oil.id = resolved.essential_oil_id
          where resolved.product_id = ${input.id}
          order by resolved.component_position nulls last, oil.name_english
        `;
      }

      return ctx.db`
        select
          product_oil.product_id::text,
          product_oil.essential_oil_id::text,
          oil.name_english as oil_name_english,
          oil.name_portuguese as oil_name_portuguese,
          product_oil.component_bubble_uid,
          product_oil.component_position,
          product_oil.source_field
        from public.eo_product_oils product_oil
        join public.essential_oils oil on oil.id = product_oil.essential_oil_id
        where product_oil.product_id = ${input.id}
        order by product_oil.component_position nulls last, oil.name_english
      `;
    }),

  facets: protectedProcedure.query(async ({ ctx }) => {
    const [productTypes, colorLabels, countries] = await Promise.all([
      ctx.db`select id::text, name, slug from public.eo_product_types order by name`,
      ctx.db`select id::text, name_english, name_portuguese, color_hex from public.eo_color_labels order by name_english`,
      ctx.db`
        select distinct country_code
        from public.eo_products
        where country_code is not null
        order by country_code
      `
    ]);

    return { productTypes, colorLabels, countries };
  }),

  coverageSummary: protectedProcedure.query(async ({ ctx }) => {
    const [summary] = await ctx.db`
      select
        count(*)::int as total_products,
        count(*) filter (where exists (
          select 1 from public.v_eo_product_oils_resolved resolved where resolved.product_id = product.id
        ))::int as with_resolved_oils,
        count(*) filter (where not exists (
          select 1 from public.v_eo_product_oils_resolved resolved where resolved.product_id = product.id
        ))::int as without_resolved_oils,
        count(*) filter (where main_product_id is not null)::int as inherits_main_product,
        count(*) filter (where (
          select count(*) from public.eo_product_type_assignments assignment where assignment.product_id = product.id
        ) > 1)::int as with_multiple_types
      from public.eo_products product
    `;

    return summary;
  }),

  create: adminProcedure.input(productInput).mutation(async ({ ctx, input }) => {
    const [product] = await ctx.db`
      insert into public.eo_products (
        bubble_uid,
        name_english,
        name_portuguese,
        image_url,
        product_number,
        official_url,
        country_code,
        primary_product_type_id,
        color_label_id,
        is_main_product,
        updated_at
      )
      values (
        ${input.bubbleUid},
        ${input.nameEnglish},
        ${input.namePortuguese ?? null},
        ${input.imageUrl ?? null},
        ${input.productNumber ?? null},
        ${input.officialUrl ?? null},
        ${input.countryCode ?? null},
        ${input.primaryProductTypeId ?? null},
        ${input.colorLabelId ?? null},
        ${input.isMainProduct ?? null},
        now()
      )
      on conflict (bubble_uid) do update
      set
        name_english = excluded.name_english,
        name_portuguese = excluded.name_portuguese,
        image_url = excluded.image_url,
        product_number = excluded.product_number,
        official_url = excluded.official_url,
        country_code = excluded.country_code,
        primary_product_type_id = excluded.primary_product_type_id,
        color_label_id = excluded.color_label_id,
        is_main_product = excluded.is_main_product,
        updated_at = now()
      returning id::text, bubble_uid, name_english, name_portuguese
    `;

    await bumpProductCaches();
    return product;
  }),

  update: adminProcedure.input(updateProductInput).mutation(async ({ ctx, input }) => {
    const [product] = await ctx.db`
      update public.eo_products
      set
        bubble_uid = coalesce(${input.bubbleUid ?? null}, bubble_uid),
        name_english = coalesce(${input.nameEnglish ?? null}, name_english),
        name_portuguese = case when ${hasOwn(input, 'namePortuguese')} then ${input.namePortuguese ?? null} else name_portuguese end,
        image_url = case when ${hasOwn(input, 'imageUrl')} then ${input.imageUrl ?? null} else image_url end,
        product_number = case when ${hasOwn(input, 'productNumber')} then ${input.productNumber ?? null} else product_number end,
        official_url = case when ${hasOwn(input, 'officialUrl')} then ${input.officialUrl ?? null} else official_url end,
        country_code = case when ${hasOwn(input, 'countryCode')} then ${input.countryCode ?? null} else country_code end,
        primary_product_type_id = case when ${hasOwn(input, 'primaryProductTypeId')} then ${input.primaryProductTypeId ?? null}::uuid else primary_product_type_id end,
        color_label_id = case when ${hasOwn(input, 'colorLabelId')} then ${input.colorLabelId ?? null}::uuid else color_label_id end,
        is_main_product = case when ${hasOwn(input, 'isMainProduct')} then ${input.isMainProduct ?? null}::boolean else is_main_product end,
        updated_at = now()
      where id = ${input.id}
      returning id::text, bubble_uid, name_english, name_portuguese
    `;

    await bumpProductCaches();
    return product ?? null;
  }),

  addOil: adminProcedure.input(productOilInput).mutation(async ({ ctx, input }) => {
    const [link] = await ctx.db`
      insert into public.eo_product_oils (
        product_id,
        essential_oil_id,
        component_bubble_uid,
        component_position,
        source_field
      )
      values (
        ${input.productId},
        ${input.essentialOilId},
        ${input.componentBubbleUid ?? input.essentialOilId},
        ${input.componentPosition ?? null},
        ${input.sourceField}
      )
      on conflict (product_id, essential_oil_id) do update
      set
        component_bubble_uid = excluded.component_bubble_uid,
        component_position = excluded.component_position,
        source_field = excluded.source_field
      returning product_id::text, essential_oil_id::text, component_position, source_field
    `;

    await bumpProductCaches();
    return link;
  }),

  removeOil: adminProcedure.input(productOilInput).mutation(async ({ ctx, input }) => {
    const [link] = await ctx.db`
      delete from public.eo_product_oils
      where product_id = ${input.productId} and essential_oil_id = ${input.essentialOilId}
      returning product_id::text, essential_oil_id::text
    `;

    await bumpProductCaches();
    return { deleted: Boolean(link), link: link ?? null };
  }),

  addType: adminProcedure.input(productTypeInput).mutation(async ({ ctx, input }) => {
    const [link] = await ctx.db`
      insert into public.eo_product_type_assignments (product_id, product_type_id)
      values (${input.productId}, ${input.productTypeId})
      on conflict (product_id, product_type_id) do nothing
      returning product_id::text, product_type_id::text
    `;

    await bumpProductCaches();
    return link ?? { product_id: input.productId, product_type_id: input.productTypeId };
  }),

  removeType: adminProcedure.input(productTypeInput).mutation(async ({ ctx, input }) => {
    const [link] = await ctx.db`
      delete from public.eo_product_type_assignments
      where product_id = ${input.productId} and product_type_id = ${input.productTypeId}
      returning product_id::text, product_type_id::text
    `;

    await bumpProductCaches();
    return { deleted: Boolean(link), link: link ?? null };
  }),

  hardDelete: adminProcedure.input(hardDeleteInput).mutation(async ({ ctx, input }) => {
    const [childRefs] = await ctx.db<CountRow[]>`
      select count(*)::text as count
      from public.eo_products
      where main_product_id = ${input.id}
    `;

    if (Number(childRefs?.count ?? 0) > 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Cannot hard delete a product that is used as another product main_product'
      });
    }

    return ctx.db.begin(async (tx) => {
      await tx`delete from public.eo_product_oils where product_id = ${input.id}`;
      await tx`delete from public.eo_product_type_assignments where product_id = ${input.id}`;
      const [product] = await tx`
        delete from public.eo_products
        where id = ${input.id}
        returning id::text, bubble_uid, name_english
      `;

      await bumpProductCaches();

      return {
        deleted: Boolean(product),
        product: product ?? null
      };
    });
  })
});
