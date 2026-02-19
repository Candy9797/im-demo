'use client';

import React, { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface LoadMoreProps {
  hasMore: boolean;
  page: number;
}

export function LoadMore({ hasMore, page }: LoadMoreProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  if (!hasMore) return null;

  const loadNext = () => {
    const p = new URLSearchParams(searchParams.toString());
    p.set('page', String(page + 1));
    startTransition(() => {
      router.push(`/shop?${p.toString()}`);
    });
  };

  return (
    <div className="wf-load-more">
      <button
        type="button"
        className="tb-btn"
        onClick={loadNext}
        disabled={isPending}
      >
        {isPending ? '加载中...' : '加载更多'}
      </button>
    </div>
  );
}
