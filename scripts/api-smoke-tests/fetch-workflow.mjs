import { readFileSync } from 'node:fs';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3001';

function readEnvFile() {
  try {
    return readFileSync('.env', 'utf8');
  } catch {
    return '';
  }
}

function readEnv(name) {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;

  const match = readEnvFile().match(new RegExp(`^${name}=(.+)$`, 'm'));
  return match?.[1]?.trim();
}

function parseArgs() {
  const args = new Map();
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--') && arg.includes('=')) {
      const [key, ...value] = arg.slice(2).split('=');
      args.set(key, value.join('='));
    }
  }

  return {
    baseUrl: args.get('base-url') ?? DEFAULT_BASE_URL
  };
}

function makeClient({ baseUrl, auth = true }) {
  const headers = auth
    ? {
        'x-dev-user-id': 'codex-fetch-workflow-smoke',
        'x-dev-auth-token': readEnv('TRPC_DEV_AUTH_TOKEN') ?? ''
      }
    : undefined;

  return createTRPCClient({
    links: [
      httpBatchLink({
        url: `${baseUrl.replace(/\/$/, '')}/api/trpc`,
        transformer: superjson,
        headers
      })
    ]
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function expectFailure(label, action) {
  try {
    await action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error(`${label} unexpectedly succeeded`);
}

async function main() {
  const { baseUrl } = parseArgs();
  const client = makeClient({ baseUrl });
  const anonymousClient = makeClient({ baseUrl, auth: false });

  const anonymousError = await expectFailure('anonymous protected read', () =>
    anonymousClient.dashboard.summary.query()
  );

  const dashboard = await client.dashboard.summary.query();
  assert(dashboard.counts.essential_oils > 0, 'dashboard summary missing essential oils');
  assert(dashboard.counts.recipes > 0, 'dashboard summary missing recipes');
  assert(dashboard.counts.products > 0, 'dashboard summary missing products');

  const oilFacets = await client.oils.facets.query();
  assert(oilFacets.applicationMethods.length > 0, 'oil application method facets missing');
  assert(oilFacets.pregnancyStatuses.length > 0, 'oil pregnancy facets missing');

  const oils = await client.oils.list.query({ page: 1, pageSize: 10 });
  assert(oils.items.length > 0, 'oil list returned no rows');
  const oilDetail = await client.oils.detail.query({ id: oils.items[0].id });
  assert(oilDetail.oil?.id === oils.items[0].id, 'oil detail readback failed');
  const oilEditor = await client.oils.editorContext.query({ id: oils.items[0].id });
  assert(oilEditor.applicationMethods.length > 0, 'oil editor context missing application methods');

  const chemistryFacets = await client.chemistry.facets.query();
  assert(chemistryFacets.sourceTypes.length > 0, 'chemistry source type facets missing');
  const compounds = await client.chemistry.compoundsList.query({ page: 1, pageSize: 10 });
  assert(compounds.items.length > 0, 'compound list returned no rows');
  const officialCompounds = await client.chemistry.compoundsList.query({
    page: 1,
    pageSize: 5,
    sourceType: 'official_doterra'
  });
  const secondaryCompounds = await client.chemistry.compoundsList.query({
    page: 1,
    pageSize: 5,
    sourceType: 'secondary'
  });
  assert(officialCompounds.items.length > 0, 'official chemistry filter returned no rows');
  assert(secondaryCompounds.items.length > 0, 'secondary chemistry filter returned no rows');
  const compoundDetail = await client.chemistry.compoundDetail.query({ id: compounds.items[0].id });
  assert(compoundDetail?.compound.id === compounds.items[0].id, 'compound detail readback failed');

  const productFacets = await client.products.facets.query();
  assert(productFacets.productTypes.length > 0, 'product type facets missing');
  const mixType = productFacets.productTypes.find((type) => type.name === 'Mix');
  const products = await client.products.list.query({ page: 1, pageSize: 10 });
  assert(products.items.length > 0, 'product list returned no rows');
  if (mixType) {
    const mixes = await client.products.list.query({ page: 1, pageSize: 5, productTypeId: mixType.id });
    assert(mixes.items.length > 0, 'Mix product filter returned no rows');
  }
  const productDetail = await client.products.detail.query({ id: products.items[0].id });
  assert(productDetail?.product.id === products.items[0].id, 'product detail readback failed');

  const recipeSummary = await client.recipes.completenessSummary.query();
  assert(recipeSummary.total_recipes > 0, 'recipe completeness summary missing recipes');
  const recipes = await client.recipes.list.query({ page: 1, pageSize: 10 });
  assert(recipes.items.length > 0, 'recipe list returned no rows');
  const recipeQueue = await client.recipes.reviewQueue.query({ issue: 'missing_oils', page: 1, pageSize: 5 });
  assert(recipeQueue.length > 0, 'recipe missing-oils queue returned no rows');
  const recipeDetail = await client.recipes.byId.query({ id: recipes.items[0].id });
  assert(recipeDetail?.recipe.id === recipes.items[0].id, 'recipe detail readback failed');

  const healthFacets = await client.healthKnowledge.facets.query();
  assert(healthFacets.actionSystems.length > 0, 'health knowledge action system facets missing');
  const concerns = await client.healthKnowledge.concernsList.query({ page: 1, pageSize: 10 });
  assert(concerns.items.length > 0, 'health concern list returned no rows');
  const concernDetail = await client.healthKnowledge.concernDetail.query({ id: concerns.items[0].id });
  assert(concernDetail?.concern.id === concerns.items[0].id, 'health concern detail readback failed');
  const actionSystems = await client.healthKnowledge.actionSystemsList.query({ page: 1, pageSize: 10 });
  assert(actionSystems.items.length > 0, 'action system list returned no rows');
  const properties = await client.healthKnowledge.therapeuticPropertiesList.query({
    page: 1,
    pageSize: 10,
    source: 'both'
  });
  assert(properties.length > 0, 'therapeutic property list returned no rows');
  const propertyDetail = await client.healthKnowledge.therapeuticPropertyDetail.query({ id: properties[0].id });
  assert(propertyDetail?.property.id === properties[0].id, 'therapeutic property detail readback failed');

  console.log(
    JSON.stringify(
      {
        auth: { anonymousProtectedReadRejected: Boolean(anonymousError) },
        dashboard: dashboard.counts,
        oils: { total: oils.total, firstOil: oils.items[0].name_english },
        chemistry: { total: compounds.total, firstCompound: compounds.items[0].name },
        products: { total: products.total, firstProduct: products.items[0].name_english },
        recipes: { total: recipes.total, missingOilsQueue: recipeQueue.length },
        healthKnowledge: {
          concerns: concerns.total,
          actionSystems: actionSystems.total,
          therapeuticProperties: properties.length
        }
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
