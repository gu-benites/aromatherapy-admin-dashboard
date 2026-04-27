import 'server-only';

import { headers } from 'next/headers';
import { appRouter } from '@/server/api/root';
import { createCallerFactory, createTRPCContext } from '@/server/api/trpc';

const createCaller = createCallerFactory(appRouter);

export async function createServerCaller() {
  return createCaller(
    await createTRPCContext({
      headers: await headers()
    })
  );
}
