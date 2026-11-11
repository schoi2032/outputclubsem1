'use client'
import { Toaster, TooltipProvider } from '@quid/ui'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError } from '@/lib/api'

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            // Live updates (realtime.ts) keep the cache fresh, so don't refetch on every
            // screen change. Each round trip to the server is slow from Korea.
            staleTime: 60_000,
            gcTime: 30 * 60_000,
            retry: (count, err) =>
              !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
          },
        },
        mutationCache: new MutationCache({
          onError: (err) => {
            if (err instanceof ApiError && err.status === 401) window.location.href = '/login'
          },
        }),
      }),
  )
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
