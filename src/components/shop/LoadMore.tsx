'use client';

import React, { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/** 性能策略（见 docs/抖音商城风格电商页面方案.md 五）：并发更新 - useTransition 包裹非紧急路由跳转 */

interface LoadMoreProps {
  hasMore: boolean;
  page: number;
}

export function LoadMore({ hasMore, page }: LoadMoreProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  /**
   * useTransition 把「加载下一页」标记为非紧急更新（transition）：
   * - 不包的话：router.push 会触发紧急更新，当前页可能立刻被挂起或整页切到 loading，交互会卡顿。
   * - 包了之后：当前页保持可交互、保持展示，Next.js 在后台准备新页面；准备好再切换，过渡更顺滑。
   * isPending 在过渡期间为 true，用于显示「加载中...」和禁用按钮，避免重复点击。
   */
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
