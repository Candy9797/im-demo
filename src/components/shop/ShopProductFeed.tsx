'use client';

import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useProductsQuery } from '@/hooks/useProducts';
import { WaterfallCard } from './WaterfallCard';
import { Pagination } from './Pagination';

export function ShopProductFeed() {
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

  const { data, status, error } = useProductsQuery(params);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  if (status === 'pending') {
    return <div className="wf-skeleton" />;
  }
  if (status === 'error') {
    return (
      <div className="wf-error" style={{ padding: '2rem', textAlign: 'center', color: 'var(--tb-text-light)' }}>
        加载失败，请重试
      </div>
    );
  }

  return (
    <>
      <div className="wf-breadcrumb">
        <Link href="/">首页</Link>
        <span className="tb-sep">&gt;</span>
        <span>淘宝网官网</span>
        <span className="tb-item-count">（共找到{total}件商品）</span>
      </div>

      <div className="wf-container">
        {items.map((product) => (
          <div key={product.id} className="wf-item">
            <WaterfallCard product={product} />
          </div>
        ))}
      </div>

      <Pagination page={page} total={total} pageSize={12} />
    </>
  );
}
