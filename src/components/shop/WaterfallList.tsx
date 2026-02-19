'use client';

import React, { useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { WaterfallCard } from './WaterfallCard';
import type { Product } from '@/lib/shop/mockProducts';

interface WaterfallListProps {
  initialItems: Product[];
  initialPage: number;
  initialHasMore: boolean;
}

export function WaterfallList({
  initialItems,
  initialPage,
  initialHasMore,
}: WaterfallListProps) {
  const [items, setItems] = useState(initialItems);
  const [page, setPage] = useState(initialPage);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isPending, startTransition] = useTransition();
  const searchParams = useSearchParams();

  const loadMore = () => {
    if (!hasMore || isPending) return;
    const p = new URLSearchParams(searchParams.toString());
    p.set('page', String(page + 1));
    startTransition(async () => {
      const res = await fetch(`/api/shop/products?${p.toString()}`);
      const data = await res.json();
      setItems((prev) => [...prev, ...data.items]);
      setPage(data.page);
      setHasMore(data.hasMore);
    });
  };

  return (
    <>
      <div className="wf-container">
        {items.map((product) => (
          <div key={product.id} className="wf-item">
            <WaterfallCard product={product} />
          </div>
        ))}
      </div>

      {hasMore && (
        <div className="wf-load-more">
          <button
            type="button"
            className="tb-btn"
            onClick={loadMore}
            disabled={isPending}
          >
            {isPending ? '加载中...' : '加载更多'}
          </button>
        </div>
      )}
    </>
  );
}
