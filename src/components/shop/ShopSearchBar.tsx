'use client';

import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface ShopSearchBarProps {
  suggestions?: string[];
  defaultSearch?: string;
}

export function ShopSearchBar({ suggestions = [], defaultSearch = '' }: ShopSearchBarProps) {
  const searchParams = useSearchParams();
  const q = searchParams.get('q') || defaultSearch;

  const buildUrl = (newQ: string) => {
    const p = new URLSearchParams(searchParams.toString());
    if (newQ) p.set('q', newQ);
    else p.delete('q');
    p.delete('page');
    const s = p.toString();
    return s ? `/shop?${s}` : '/shop';
  };

  const baseParams = new URLSearchParams(searchParams.toString());
  baseParams.delete('q');
  baseParams.delete('page');

  return (
    <div className="tb-search-wrap">
      <form className="tb-search-form" action="/shop" method="get">
        {Array.from(baseParams.entries()).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input
          type="search"
          name="q"
          className="tb-search-input"
          placeholder="蜡笔小新"
          defaultValue={q}
          aria-label="搜索商品"
        />
        <button type="submit" className="tb-search-btn">
          搜索
        </button>
      </form>
      <div className="tb-search-suggestions">
        <Link href="/shop">全部分类</Link>
        {suggestions.slice(0, 8).map((s) => (
          <Link key={s} href={buildUrl(s)}>
            {s}
          </Link>
        ))}
        <Link href="/shop">更多...</Link>
      </div>
    </div>
  );
}
