'use client';

import React, { useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { ShopFilters } from '@/components/shop/ShopFilters';
import { Shop2ProductFeed } from '@/components/shop/Shop2ProductFeed';
import type { Product } from '@/lib/shop/mockProducts';
import type { Shop2FilterParams } from '@/lib/shop/getProducts';
import { SEARCH_SUGGESTIONS } from '@/lib/shop/mockProducts';

const PAGE_SIZE = 12;

export interface Shop2PageClientProps {
  initialItems: Product[];
  initialPage: number;
  initialTotal: number;
  initialHasMore: boolean;
  initialParams: Shop2FilterParams;
}

export function Shop2PageClient({
  initialItems,
  initialPage,
  initialTotal,
  initialHasMore,
  initialParams,
}: Shop2PageClientProps) {
  const [params, setParams] = React.useState<Shop2FilterParams>(() => initialParams);

  const onParamsChange = useCallback((updates: Partial<Shop2FilterParams>) => {
    setParams((prev) => {
      const next = { ...prev, ...updates };
      if ('page' in updates && updates.page === undefined) next.page = 1;
      return next;
    });
  }, []);

  const defaultSearch = useMemo(() => params.q ?? '', [params.q]);

  return (
    <main className="tb-page wf-page">
      <ShopHeader
        suggestions={SEARCH_SUGGESTIONS}
        defaultSearch={defaultSearch}
        locale="zh"
        basePath="/shop2"
      />
      <div className="wf-content">
        <ShopFilters
          basePath="/shop2"
          clientSideFilter
          currentParams={params}
          onParamsChange={onParamsChange}
        />
        <div className="wf-main">
          <Shop2ProductFeed
            params={params}
            initialItems={initialItems}
            initialPage={initialPage}
            initialTotal={initialTotal}
            initialHasMore={initialHasMore}
            initialParams={initialParams}
            onPageChange={(page) => setParams((prev) => ({ ...prev, page }))}
          />
        </div>
      </div>
      <Link href="/" className="tb-float-consult" title="自助咨询">
        <span className="tb-float-icon">😊</span>
        <span>自助咨询</span>
      </Link>
    </main>
  );
}
