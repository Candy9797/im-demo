'use client';

import React, { useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { WaterfallCard } from './WaterfallCard';
import type { Product } from '@/lib/shop/mockProducts';

/** 性能策略（见 docs/抖音商城风格电商页面方案.md 五）：并发更新 - useTransition 包裹加载更多 */

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
    // 用 startTransition 把「追加列表 + 更新分页状态」标成非紧急更新：列表变长时
    // 重渲染成本高，不包的话 React 会当紧急更新处理，容易卡顿；包了之后当前列表
    // 保持可交互，新数据在后台应用，过渡更顺滑。isPending 用于展示「加载中」并禁用按钮。
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
