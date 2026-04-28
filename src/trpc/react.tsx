'use client';

import { httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { useAuth } from '@clerk/nextjs';
import { useState } from 'react';
import superjson from 'superjson';
import type { QueryClient } from '@tanstack/react-query';
import type { AppRouter } from '@/server/api/root';

export const api = createTRPCReact<AppRouter>();

const ADMIN_TRPC_URL = 'https://api.aromachat.app/api/admin/trpc';

export function TRPCReactProvider({
  children,
  queryClient
}: {
  children: React.ReactNode;
  queryClient: QueryClient;
}) {
  const { getToken } = useAuth();
  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        httpBatchLink({
          transformer: superjson,
          url: ADMIN_TRPC_URL,
          async headers() {
            const token = await getToken();

            return token
              ? {
                  authorization: `Bearer ${token}`
                }
              : {};
          }
        })
      ]
    })
  );

  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      {children}
    </api.Provider>
  );
}
