import { createTRPCRouter } from '@/server/api/trpc';
import { chemistryRouter } from '@/server/api/routers/chemistry';
import { dashboardRouter } from '@/server/api/routers/dashboard';
import { healthConcernsRouter } from '@/server/api/routers/health-concerns';
import { healthKnowledgeRouter } from '@/server/api/routers/health-knowledge';
import { oilsRouter } from '@/server/api/routers/oils';
import { pregnancyRouter } from '@/server/api/routers/pregnancy';
import { productsRouter } from '@/server/api/routers/products';
import { recipesRouter } from '@/server/api/routers/recipes';
import { systemRouter } from '@/server/api/routers/system';
import { testDataRouter } from '@/server/api/routers/test-data';
import { therapeuticPropertiesRouter } from '@/server/api/routers/therapeutic-properties';
import { viewerRouter } from '@/server/api/routers/viewer';

export const appRouter = createTRPCRouter({
  chemistry: chemistryRouter,
  dashboard: dashboardRouter,
  healthConcerns: healthConcernsRouter,
  healthKnowledge: healthKnowledgeRouter,
  oils: oilsRouter,
  pregnancy: pregnancyRouter,
  products: productsRouter,
  recipes: recipesRouter,
  system: systemRouter,
  testData: testDataRouter,
  therapeuticProperties: therapeuticPropertiesRouter,
  viewer: viewerRouter
});

export type AppRouter = typeof appRouter;
