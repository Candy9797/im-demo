'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

interface QueryProviderProps {
  children: React.ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // staleTime: 60 * 1000：60 秒内，这份数据在 React Query 里被视为“新鲜”（fresh），不会因为组件重新挂载或窗口重新聚焦就自动重新请求。
            // 所有 query 默认在 60 秒内都算新鲜，不自动重新请求。适合列表、配置等不需要“秒级”刷新的数据。
            staleTime: 60 * 1000,
          },
        },
      })
  );
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
