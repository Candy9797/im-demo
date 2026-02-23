'use client';

import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { Product } from '@/lib/shop/mockProducts';
import type { SortOption, GetProductsResult, Shop2FilterParams } from '@/lib/shop/getProducts';
import { WaterfallCard } from './WaterfallCard';
import { Pagination } from './Pagination';
import { useTranslations } from '@/components/providers/IntlProvider';

const PAGE_SIZE = 12;
const MAX_ITEMS_PER_VIEW = 100;

async function fetchProducts(params: {
  q?: string;
  brand?: string;
  category?: string;
  priceMin?: number;
  priceMax?: number;
  sort?: SortOption;
  page: number;
}): Promise<GetProductsResult> {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.brand) sp.set('brand', params.brand);
  if (params.category) sp.set('category', params.category);
  if (params.priceMin != null) sp.set('priceMin', String(params.priceMin));
  if (params.priceMax != null) sp.set('priceMax', String(params.priceMax));
  if (params.sort && params.sort !== 'default') sp.set('sort', params.sort);
  sp.set('page', String(params.page));
  sp.set('pageSize', '12');
  const res = await fetch(`/api/shop/products?${sp.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch products');
  return res.json();
}

function normalizeParamsForCompare(p: Shop2FilterParams): Record<string, string | number | undefined> {
  return {
    q: p.q ?? '',
    brand: p.brand ?? '',
    category: p.category ?? '',
    sort: p.sort ?? 'default',
    priceMin: p.priceMin ?? '',
    priceMax: p.priceMax ?? '',
    page: p.page ?? 1,
  };
}

function paramsEqual(a: Shop2FilterParams, b: Shop2FilterParams): boolean {
  const na = normalizeParamsForCompare(a);
  const nb = normalizeParamsForCompare(b);
  return Object.keys(na).every((k) => na[k] === nb[k]);
}

interface Shop2ProductFeedProps {
  initialItems: Product[];
  initialPage: number;
  initialTotal: number;
  initialHasMore: boolean;
  /** 受控模式：由父组件传入，筛选/分页不依赖 URL */
  params?: Shop2FilterParams;
  /** 与 initialData 对应的服务端参数；仅在 params 与 initialParams 一致时使用 initialData */
  initialParams?: Shop2FilterParams;
  /** 受控模式下的分页回调 */
  onPageChange?: (page: number) => void;
}

/** 服务端首屏取数 + 客户端加载更多：首屏来自 SSR，后续页走 API；受控模式下筛选/分页仅更新父组件状态 */
export function Shop2ProductFeed({
  initialItems,
  initialPage,
  initialTotal,
  initialHasMore,
  params: paramsProp,
  initialParams,
  onPageChange,
}: Shop2ProductFeedProps) {
  const t = useTranslations('shop');
  const searchParams = useSearchParams();

  const params = useMemo(() => {
    if (paramsProp) {
      const p = paramsProp;
      const sortRaw = p.sort ?? 'default';
      const sort = (['default', 'price_asc', 'price_desc', 'sales_desc', 'rating_desc'].includes(String(sortRaw))
        ? sortRaw
        : 'default') as SortOption;
      return {
        q: p.q ?? '',
        brand: p.brand ?? '',
        category: p.category ?? '',
        priceMin: p.priceMin,
        priceMax: p.priceMax,
        sort,
        page: Math.max(1, p.page ?? 1),
      };
    }
    const q = searchParams.get('q') || '';
    const brand = searchParams.get('brand') || '';
    const category = searchParams.get('category') || '';
    const priceMin = searchParams.get('priceMin');
    const priceMax = searchParams.get('priceMax');
    const sortRaw = searchParams.get('sort') || 'default';
    const sort = (['default', 'price_asc', 'price_desc', 'sales_desc', 'rating_desc'].includes(sortRaw)
      ? sortRaw
      : 'default') as SortOption;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    return {
      q: q || undefined,
      brand: brand || undefined,
      category: category || undefined,
      priceMin: priceMin ? Number(priceMin) : undefined,
      priceMax: priceMax ? Number(priceMax) : undefined,
      sort,
      page,
    };
  }, [paramsProp, searchParams]);

  const apiParams = useMemo(
    () => ({
      q: params.q || undefined,
      brand: params.brand || undefined,
      category: params.category || undefined,
      priceMin: params.priceMin,
      priceMax: params.priceMax,
      sort: params.sort,
    }),
    [params.q, params.brand, params.category, params.priceMin, params.priceMax, params.sort]
  );

  const useInitialData = Boolean(
    paramsProp && initialParams && paramsEqual(paramsProp, initialParams)
  );
  const initialData = useInitialData
    ? {
        pages: [
          {
            items: initialItems,
            total: initialTotal,
            page: initialPage,
            hasMore: initialHasMore,
          },
        ],
        pageParams: [initialPage] as number[],
      }
    : undefined;

  const {
    data,
    status,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['products', 'infinite', 'shop2', apiParams, params.page],
    queryFn: ({ pageParam }) => fetchProducts({ ...apiParams, page: pageParam }),
    initialPageParam: params.page,
    initialData,
    getNextPageParam: (last, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0);
      if (loaded >= MAX_ITEMS_PER_VIEW) return undefined;
      return last.hasMore ? last.page + 1 : undefined;
    },
  });

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

      <Pagination
        page={params.page}
        total={total}
        pageSize={PAGE_SIZE}
        basePath="/shop2"
        onPageChange={onPageChange}
      />
    </>
  );
}
