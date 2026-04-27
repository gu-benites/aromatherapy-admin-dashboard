import { readFileSync } from 'node:fs';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3001';
const DEFAULT_PREFIX_ROOT = 'CODEX_DELETE_ME_TRPC';

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
    } else if (arg.startsWith('--')) {
      args.set(arg.slice(2), 'true');
    }
  }

  return {
    baseUrl: args.get('base-url') ?? DEFAULT_BASE_URL,
    cleanupOnly: args.get('cleanup-only') === 'true',
    keepData: args.get('keep-data') === 'true',
    includeLegacyCleanup: args.get('include-legacy-cleanup') === 'true',
    prefix: args.get('prefix') ?? `${DEFAULT_PREFIX_ROOT}_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
  };
}

function getAdminUserId() {
  return (readEnv('CLERK_ADMIN_USERS') ?? '').split(',')[0]?.trim() || 'codex-expert-workflow-smoke';
}

function makeClient({ baseUrl, auth = true }) {
  const headers = auth
    ? {
        'x-dev-user-id': getAdminUserId(),
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

async function expectFailure(label, action, expectedMessagePattern) {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (expectedMessagePattern && !expectedMessagePattern.test(message)) {
      throw new Error(`${label} failed with unexpected message: ${message}`);
    }
    return message;
  }

  throw new Error(`${label} unexpectedly succeeded`);
}

async function cleanup(client, prefix, includeLegacyCodexLavender = false) {
  const before = await client.testData.countByPrefix.query({
    prefix,
    includeLegacyCodexLavender
  });
  const deleted = await client.testData.cleanup.mutate({
    prefix,
    includeLegacyCodexLavender
  });
  const after = await client.testData.countByPrefix.query({
    prefix,
    includeLegacyCodexLavender
  });

  return {
    before,
    deleted: deleted.deleted,
    after
  };
}

async function runCreatePhase(client, prefix) {
  const oil = await client.oils.createTestOil.mutate({
    nameEnglish: `${prefix} Expert Workflow Oil`,
    namePortuguese: `${prefix} Oleo Fluxo Expert`,
    nameScientific: `${prefix} testus workflow`
  });

  const healthConcern = await client.healthConcerns.create.mutate({
    benefitName: `${prefix} Stress Study Concern`,
    nameEnglish: `${prefix} Stress Study`,
    namePortuguese: `${prefix} Estudo de Estresse`,
    descriptionPortuguese: `${prefix} concern fake para testar cadastro e vinculo.`,
    bodySystemPortuguese: 'Sistema nervoso - fake test',
    therapeuticPropertiesPortuguese: `${prefix} calming, grounding`,
    bubbleId: `${prefix}-health-concern`
  });

  await client.healthConcerns.linkOil.mutate({
    essentialOilId: oil.id,
    healthConcernId: healthConcern.id
  });

  const property = await client.therapeuticProperties.create.mutate({
    propertyName: `${prefix} Calming Property`,
    propertyNamePortuguese: `${prefix} Propriedade Calmante`,
    description: `${prefix} fake therapeutic property.`,
    descriptionPortuguese: `${prefix} propriedade fake para testar vinculo.`,
    bubbleUid: `${prefix}-therapeutic-property`
  });

  await client.therapeuticProperties.linkOil.mutate({
    essentialOilId: oil.id,
    propertyId: property.id
  });

  const compound = await client.chemistry.createCompound.mutate({
    name: `${prefix} Linalool Fake Compound`,
    description: `${prefix} fake compound to test chemistry management.`,
    bubbleUid: `${prefix}-compound`,
    pubchemCompoundId: `${prefix}-pubchem`,
    carbonStructure: 'Monoterpene alcohol - fake'
  });

  await client.chemistry.linkTherapeuticProperty.mutate({
    chemicalCompoundId: compound.id,
    therapeuticPropertyId: property.id,
    sourceType: 'manual',
    sourceReference: `${prefix} expert manual link test`
  });

  const oilCompound = await client.chemistry.upsertOilCompound.mutate({
    essentialOilId: oil.id,
    chemicalCompoundId: compound.id,
    minPercentage: 0.125,
    maxPercentage: 0.225,
    typicalPercentage: 0.17,
    notes: `${prefix} initial fake GC/MS range`,
    bubbleId: `${prefix}-oil-compound`,
    sourceType: 'manual',
    sourceReference: `${prefix} fake source before edit`
  });

  const recipe = await client.recipes.create.mutate({
    bubbleUid: `${prefix}-recipe`,
    healthConcernId: healthConcern.id,
    recipeTitle: `${prefix} Roll-on Respiracao Calma`,
    fullRecipeText: `${prefix} receita fake criada pela API.`,
    explanation: `${prefix} explicacao fake para curadoria.`,
    applicationMethodText: 'Topical fake workflow test',
    carrierOilText: '10 ml oleo carreador fake',
    bottleSizeText: '10 ml',
    capTypeText: 'Roll-on',
    preparationInstructionsText: 'Misturar os ingredientes fake no frasco teste.',
    usageProtocolText: 'Aplicar fake 2x ao dia em teste local.',
    oilDropsText: `3 gotas de ${oil.name_portuguese}`,
    targetAudienceText: 'Adultos - fake test',
    reviewedByDaiane: false
  });

  const recipeOil = await client.recipes.addOil.mutate({
    recipeId: recipe.id,
    essentialOilId: oil.id,
    oilOrder: 1,
    dropsCount: 3,
    rawOilLine: `3 gotas - ${oil.name_portuguese}`
  });

  const preparationInstruction = await client.recipes.addInstruction.mutate({
    recipeId: recipe.id,
    instructionType: 'preparation',
    stepOrder: 1,
    instructionText: `${prefix} adicionar oleo fake no frasco.`
  });

  const usageInstruction = await client.recipes.addInstruction.mutate({
    recipeId: recipe.id,
    instructionType: 'usage_protocol',
    stepOrder: 1,
    instructionText: `${prefix} aplicar fake em area pequena.`
  });

  const applicationMethod = await client.recipes.addApplicationMethod.mutate({
    recipeId: recipe.id,
    methodName: `${prefix} Topical Method`,
    sourceText: 'Topical fake workflow test',
    parseStatus: 'mapped'
  });

  const oilFacets = await client.oils.facets.query();
  const healthKnowledgeFacets = await client.healthKnowledge.facets.query();
  const oilApplicationMethod = await client.oils.linkApplicationMethod.mutate({
    essentialOilId: oil.id,
    applicationMethodId: oilFacets.applicationMethods[0].id,
    sourceField: `${prefix} oil app method smoke`
  });
  const oilPregnancyStatus = await client.oils.linkPregnancyStatus.mutate({
    essentialOilId: oil.id,
    pregnancyNursingStatusId: oilFacets.pregnancyStatuses[0].id
  });
  const oilChildSafety = await client.oils.upsertChildSafety.mutate({
    essentialOilId: oil.id,
    ageRangeId: oilFacets.childSafetyAgeRanges[0].id,
    safetyNotes: `${prefix} child safety fake note`
  });
  const oilPetSafety = await client.oils.upsertPetSafety.mutate({
    essentialOilId: oil.id,
    petId: oilFacets.pets[0].id,
    safetyNotes: `${prefix} pet safety fake note`
  });
  const oilActionSystem = await client.oils.linkActionSystem.mutate({
    essentialOilId: oil.id,
    actionSystemId: healthKnowledgeFacets.actionSystems[0].id,
    sourceField: `${prefix} oil action smoke`
  });
  const product = await client.products.create.mutate({
    bubbleUid: `${prefix}-product`,
    nameEnglish: `${prefix} Fake Blend Product`,
    namePortuguese: `${prefix} Produto Blend Fake`
  });
  const productOil = await client.products.addOil.mutate({
    productId: product.id,
    essentialOilId: oil.id,
    componentBubbleUid: `${prefix}-component-oil`,
    componentPosition: 1
  });

  return {
    oil,
    healthConcern,
    property,
    compound,
    oilCompound,
    recipe,
    recipeOil,
    preparationInstruction,
    usageInstruction,
    applicationMethod,
    oilApplicationMethod,
    oilPregnancyStatus,
    oilChildSafety,
    oilPetSafety,
    oilActionSystem,
    product,
    productOil
  };
}

async function runUpdatePhase(client, prefix, created) {
  const updatedOil = await client.oils.update.mutate({
    id: created.oil.id,
    namePortuguese: `${prefix} Oleo Fluxo Expert Editado`,
    generalDescription: `${prefix} descricao editada via smoke test`
  });

  const updatedHealthConcern = await client.healthConcerns.update.mutate({
    id: created.healthConcern.id,
    namePortuguese: `${prefix} Estudo de Estresse Editado`,
    descriptionPortuguese: `${prefix} descricao de concern editada`,
    bodySystemPortuguese: 'Sistema nervoso editado - fake test'
  });

  const updatedProperty = await client.therapeuticProperties.update.mutate({
    id: created.property.id,
    propertyNamePortuguese: `${prefix} Propriedade Calmante Editada`,
    descriptionPortuguese: `${prefix} descricao de propriedade editada`
  });

  const updatedCompound = await client.chemistry.updateCompound.mutate({
    id: created.compound.id,
    description: `${prefix} compound editado`,
    pubchemCompoundId: `${prefix}-pubchem-edited`,
    carbonStructure: 'Monoterpene alcohol edited - fake'
  });

  const updatedOilCompound = await client.chemistry.updateOilCompoundPercentages.mutate({
    essentialOilId: created.oil.id,
    chemicalCompoundId: created.compound.id,
    minPercentage: 0.1325,
    maxPercentage: 0.2475,
    typicalPercentage: 0.195,
    notes: `${prefix} updated fake GC/MS range`,
    sourceType: 'manual',
    sourceReference: `${prefix} edited source`
  });

  const updatedRecipe = await client.recipes.update.mutate({
    id: created.recipe.id,
    recipeTitle: `${prefix} Roll-on Respiracao Calma Editado`,
    explanation: `${prefix} explicacao editada`,
    carrierOilText: '15 ml oleo carreador fake editado',
    reviewedByDaiane: true
  });

  const updatedRecipeOil = await client.recipes.addOil.mutate({
    recipeId: created.recipe.id,
    essentialOilId: created.oil.id,
    oilOrder: 2,
    dropsCount: 5,
    rawOilLine: `5 gotas - ${updatedOil.name_portuguese}`
  });

  const updatedPreparationInstruction = await client.recipes.addInstruction.mutate({
    recipeId: created.recipe.id,
    instructionType: 'preparation',
    stepOrder: 1,
    instructionText: `${prefix} instrucao de preparo editada.`
  });

  const updatedApplicationMethod = await client.recipes.updateApplicationMethod.mutate({
    id: created.applicationMethod.link.id,
    sourceText: 'Topical fake workflow test edited',
    parseStatus: 'ambiguous'
  });

  return {
    updatedOil,
    updatedHealthConcern,
    updatedProperty,
    updatedCompound,
    updatedOilCompound,
    updatedRecipe,
    updatedRecipeOil,
    updatedPreparationInstruction,
    updatedApplicationMethod
  };
}

async function runReadAssertions(client, created) {
  const oil = await client.oils.byId.query({ id: created.oil.id });
  const healthConcerns = await client.healthConcerns.forOil.query({ essentialOilId: created.oil.id });
  const properties = await client.therapeuticProperties.forOil.query({ essentialOilId: created.oil.id });
  const compounds = await client.chemistry.oilCompounds.query({ essentialOilId: created.oil.id });
  const recipe = await client.recipes.byId.query({ id: created.recipe.id });

  const compound = compounds.find((item) => item.chemical_compound_id === created.compound.id);

  assert(oil?.id === created.oil.id, 'oil readback failed');
  assert(healthConcerns.some((item) => item.id === created.healthConcern.id), 'health concern link readback failed');
  assert(properties.some((item) => item.id === created.property.id), 'therapeutic property link readback failed');
  assert(compound, 'compound link readback failed');
  assert(compound.min_percentage === '0.1325', 'compound min percentage update failed');
  assert(compound.max_percentage === '0.2475', 'compound max percentage update failed');
  assert(compound.typical_percentage === '0.1950', 'compound typical percentage update failed');
  assert(recipe?.recipe.id === created.recipe.id, 'recipe readback failed');
  assert(recipe.oils.some((item) => item.essential_oil_id === created.oil.id), 'recipe oil link readback failed');
  assert(recipe.instructions.length === 2, 'recipe instruction count failed');
  assert(recipe.applicationMethods.length === 1, 'recipe application method count failed');

  return {
    oil,
    healthConcerns,
    properties,
    compounds,
    recipe
  };
}

async function runNegativeTests({ baseUrl, client, created }) {
  const anonymousClient = makeClient({ baseUrl, auth: false });
  const nonAdminClient = createTRPCClient({
    links: [
      httpBatchLink({
        url: `${baseUrl.replace(/\/$/, '')}/api/trpc`,
        transformer: superjson,
        headers: {
          'x-dev-user-id': 'codex-non-admin-smoke',
          'x-dev-auth-token': readEnv('TRPC_DEV_AUTH_TOKEN') ?? ''
        }
      })
    ]
  });

  const unauthorized = await expectFailure(
    'anonymous protected query',
    () => anonymousClient.system.databaseSummary.query(),
    /authentication|required|UNAUTHORIZED/i
  );

  const invalidPercentage = await expectFailure(
    'invalid percentage over 1',
    () =>
      client.chemistry.upsertOilCompound.mutate({
        essentialOilId: created.oil.id,
        chemicalCompoundId: created.compound.id,
        minPercentage: 1.2,
        maxPercentage: 1.3,
        typicalPercentage: 1.25
      }),
    /too_big|Number must be less than or equal to 1|1/i
  );

  const invalidRange = await expectFailure(
    'invalid min/max range',
    () =>
      client.chemistry.updateOilCompoundPercentages.mutate({
        essentialOilId: created.oil.id,
        chemicalCompoundId: created.compound.id,
        minPercentage: 0.5,
        maxPercentage: 0.2,
        typicalPercentage: 0.3
      }),
    /minPercentage/i
  );

  const invalidRecipe = await expectFailure(
    'recipe missing bubbleUid',
    () =>
      client.recipes.create.mutate({
        recipeTitle: 'Invalid recipe without bubbleUid'
      }),
    /bubbleUid|required|invalid/i
  );

  const invalidDeleteConfirmation = await expectFailure(
    'hard delete without EXCLUIR confirmation',
    () =>
      client.recipes.hardDelete.mutate({
        id: created.recipe.id,
        confirmation: 'DELETE'
      }),
    /EXCLUIR|invalid/i
  );

  const forbiddenMutation = await expectFailure(
    'non-admin mutation',
    () =>
      nonAdminClient.oils.update.mutate({
        id: created.oil.id,
        namePortuguese: 'Non admin should not edit'
      }),
    /Admin privileges|FORBIDDEN/i
  );

  return {
    unauthorized,
    invalidPercentage,
    invalidRange,
    invalidRecipe,
    invalidDeleteConfirmation,
    forbiddenMutation
  };
}

async function runUnlinkPhase(client, created) {
  const removedApplicationMethod = await client.recipes.removeApplicationMethod.mutate({
    id: created.applicationMethod.link.id
  });
  const removedUsageInstruction = await client.recipes.removeInstruction.mutate({
    id: created.usageInstruction.id
  });
  const removedRecipeOil = await client.recipes.removeOil.mutate({
    recipeId: created.recipe.id,
    essentialOilId: created.oil.id
  });
  const removedOilCompound = await client.chemistry.unlinkOilCompound.mutate({
    essentialOilId: created.oil.id,
    chemicalCompoundId: created.compound.id
  });
  const removedCompoundProperty = await client.chemistry.unlinkTherapeuticProperty.mutate({
    chemicalCompoundId: created.compound.id,
    therapeuticPropertyId: created.property.id
  });
  const removedOilProperty = await client.therapeuticProperties.unlinkOil.mutate({
    essentialOilId: created.oil.id,
    propertyId: created.property.id
  });
  const removedOilHealthConcern = await client.healthConcerns.unlinkOil.mutate({
    essentialOilId: created.oil.id,
    healthConcernId: created.healthConcern.id
  });
  const removedOilApplicationMethod = await client.oils.unlinkApplicationMethod.mutate({
    essentialOilId: created.oil.id,
    applicationMethodId: created.oilApplicationMethod.application_method_id
  });
  const removedOilPregnancyStatus = await client.oils.unlinkPregnancyStatus.mutate({
    essentialOilId: created.oil.id,
    pregnancyNursingStatusId: created.oilPregnancyStatus.pregnancy_nursing_status_id
  });
  const removedOilChildSafety = await client.oils.removeChildSafety.mutate({
    essentialOilId: created.oil.id,
    ageRangeId: created.oilChildSafety.age_range_id
  });
  const removedOilPetSafety = await client.oils.removePetSafety.mutate({
    essentialOilId: created.oil.id,
    petId: created.oilPetSafety.pet_id
  });
  const removedOilActionSystem = await client.oils.unlinkActionSystem.mutate({
    essentialOilId: created.oil.id,
    actionSystemId: created.oilActionSystem.action_system_id
  });
  const removedProductOil = await client.products.removeOil.mutate({
    productId: created.product.id,
    essentialOilId: created.oil.id
  });

  const recipe = await client.recipes.byId.query({ id: created.recipe.id });
  const compounds = await client.chemistry.oilCompounds.query({ essentialOilId: created.oil.id });
  const properties = await client.therapeuticProperties.forOil.query({ essentialOilId: created.oil.id });
  const healthConcerns = await client.healthConcerns.forOil.query({ essentialOilId: created.oil.id });

  assert(recipe?.oils.length === 0, 'recipe oil unlink failed');
  assert(recipe.instructions.length === 1, 'instruction removal failed');
  assert(recipe.applicationMethods.length === 0, 'application method removal failed');
  assert(compounds.length === 0, 'oil compound unlink failed');
  assert(properties.length === 0, 'oil property unlink failed');
  assert(healthConcerns.length === 0, 'oil health concern unlink failed');

  return {
    removedApplicationMethod,
    removedUsageInstruction,
    removedRecipeOil,
    removedOilCompound,
    removedCompoundProperty,
    removedOilProperty,
    removedOilHealthConcern,
    removedOilApplicationMethod,
    removedOilPregnancyStatus,
    removedOilChildSafety,
    removedOilPetSafety,
    removedOilActionSystem,
    removedProductOil
  };
}

async function main() {
  const options = parseArgs();
  const client = makeClient({ baseUrl: options.baseUrl });

  if (options.cleanupOnly) {
    const cleanupResult = await cleanup(client, options.prefix, options.includeLegacyCleanup);
    console.log(JSON.stringify({ mode: 'cleanup-only', prefix: options.prefix, cleanup: cleanupResult }, null, 2));
    return;
  }

  await cleanup(client, options.prefix, false);

  const created = await runCreatePhase(client, options.prefix);
  const updates = await runUpdatePhase(client, options.prefix, created);
  const readback = await runReadAssertions(client, created);
  const negativeTests = await runNegativeTests({ baseUrl: options.baseUrl, client, created });
  const unlink = await runUnlinkPhase(client, created);
  const cleanupResult = options.keepData ? null : await cleanup(client, options.prefix, false);

  console.log(
    JSON.stringify(
      {
        prefix: options.prefix,
        created: {
          oilId: created.oil.id,
          healthConcernId: created.healthConcern.id,
          therapeuticPropertyId: created.property.id,
          compoundId: created.compound.id,
          recipeId: created.recipe.id,
          productId: created.product.id
        },
        updates: {
          oilNamePortuguese: updates.updatedOil?.name_portuguese,
          healthConcernNamePortuguese: updates.updatedHealthConcern?.name_portuguese,
          propertyNamePortuguese: updates.updatedProperty?.property_name_portuguese,
          compoundPubchem: updates.updatedCompound?.pubchem_compound_id,
          recipeReviewed: updates.updatedRecipe?.reviewed_by_daiane,
          compoundPercentages: updates.updatedOilCompound
        },
        readback: {
          oilFound: Boolean(readback.oil),
          healthConcernLinks: readback.healthConcerns.length,
          propertyLinks: readback.properties.length,
          compoundLinks: readback.compounds.length,
          recipeInstructions: readback.recipe?.instructions.length ?? 0,
          recipeApplicationMethods: readback.recipe?.applicationMethods.length ?? 0
        },
        negativeTests,
        unlink,
        cleanup: cleanupResult
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
