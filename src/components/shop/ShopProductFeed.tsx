'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useProductsInfiniteQuery } from '@/hooks/useProducts';
import { useTranslations } from '@/components/providers/IntlProvider';
import { WaterfallCard } from './WaterfallCard';
import { Pagination } from './Pagination';

const PAGE_SIZE = 12;
const MAX_ITEMS_PER_VIEW = 100;

export function ShopProductFeed() {
  const t = useTranslations('shop');
  const searchParams = useSearchParams();
  const q = searchParams.get('q') || '';
  const brand = searchParams.get('brand') || '';
  const category = searchParams.get('category') || '';
  const priceMin = searchParams.get('priceMin');
  const priceMax = searchParams.get('priceMax');
  const sortRaw = searchParams.get('sort') || 'default';
  const sort = ['default', 'price_asc', 'price_desc', 'sales_desc', 'rating_desc'].includes(sortRaw)
    ? sortRaw
    : 'default';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));

  const params = {
    q: q || undefined,
    brand: brand || undefined,
    category: category || undefined,
    priceMin: priceMin ? Number(priceMin) : undefined,
    priceMax: priceMax ? Number(priceMax) : undefined,
    sort: sort as 'default' | 'price_asc' | 'price_desc' | 'sales_desc' | 'rating_desc',
    page,
  };

  const { data, status, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useProductsInfiniteQuery(params);
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && items.length < MAX_ITEMS_PER_VIEW) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: '200px', threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  if (status === 'pending') {
    return <div className="wf-skeleton" />;
  }
  if (status === 'error') {
    return (
      <div className="wf-error" style={{ padding: '2rem', textAlign: 'center', color: 'var(--tb-text-light)' }}>
        {t('loadFail')}
      </div>
    );
  }

  return (
    <>
      <div className="wf-breadcrumb">
        <Link href="/">{t('breadcrumbHome')}</Link>
        <span className="tb-sep">&gt;</span>
        <span>{t('breadcrumbShop')}</span>
        <span className="tb-item-count">（{t('itemCount', { count: total })}）</span>
      </div>

      <div className="wf-container">
        {items.map((product) => (
          <div key={product.id} className="wf-item">
            <WaterfallCard product={product} />
          </div>
        ))}
      </div>

      <div ref={sentinelRef} className="wf-sentinel" aria-hidden />
      {isFetchingNextPage && (
        <div className="wf-load-more" style={{ padding: '1rem', textAlign: 'center', color: 'var(--tb-text-light)' }}>
          {t('loading')}
        </div>
      )}
      {!hasNextPage && items.length > 0 && (
        <div className="wf-end" style={{ padding: '1rem', textAlign: 'center', color: 'var(--tb-text-light)', fontSize: '0.9rem' }}>
          {items.length >= MAX_ITEMS_PER_VIEW ? t('loadedMax') : t('loadedAll')}
        </div>
      )}

      <Pagination page={page} total={total} pageSize={PAGE_SIZE} />
    </>
  );
}
