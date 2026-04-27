import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { getCachedJson, makeVersionedCacheKey, redisHealthCheck } from '@/server/cache/redis';

type CountRow = {
  count: string;
};

export const systemRouter = createTRPCRouter({
  cacheHealth: protectedProcedure.query(async () => redisHealthCheck()),

  databaseSummary: protectedProcedure.query(async ({ ctx }) => {
    const result = await getCachedJson({
      key: await makeVersionedCacheKey('dashboard', 'databaseSummary'),
      ttlSeconds: 60,
      load: async () => {
        const [oilCount] = await ctx.db<CountRow[]>`
          select count(*)::text as count
          from public.essential_oils
        `;

        const [profileCount] = await ctx.db<CountRow[]>`
          select count(*)::text as count
          from public.v_oil_pregnancy_safety_profile
        `;

        return {
          essentialOilCount: Number(oilCount?.count ?? 0),
          pregnancyProfileCount: Number(profileCount?.count ?? 0)
        };
      }
    });

    return {
      ...result.data,
      cache: result.cache
    };
  })
});
