import 'server-only';

import { TRPCError } from '@trpc/server';

export function assertLocalMutationEnabled() {
  if (process.env.NODE_ENV === 'production' || process.env.TRPC_ENABLE_TEST_MUTATIONS !== '1') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin test mutations are disabled'
    });
  }
}
