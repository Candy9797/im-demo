'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const BRANDS = [
  { key: 'vivo', label: 'vivo' },
  { key: '故宫', label: '故宫淘宝' },
];

const CATEGORIES = [
  { key: '', label: '全部分类' },
  { key: '数码', label: '数码' },
  { key: '家居', label: '家居' },
  { key: '女装', label: '女装' },
  { key: '文创', label: '文创' },
  { key: '美妆', label: '美妆' },
  { key: '母婴', label: '母婴' },
  { key: '运动', label: '运动' },
  { key: '文具', label: '文具' },
];

const SORT_OPTIONS = [
  { key: 'default', label: '综合' },
  { key: 'sales_desc', label: '销量' },
  { key: 'price_asc', label: '价格升序' },
  { key: 'price_desc', label: '价格降序' },
  { key: 'rating_desc', label: '好评' },
];

export function ShopFilters() {
  const searchParams = useSearchParams();
  const [priceMin, setPriceMin] = useState(searchParams.get('priceMin') || '');
  const [priceMax, setPriceMax] = useState(searchParams.get('priceMax') || '');

  const buildUrl = (updates: Record<string, string | null>) => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.delete('page');
    const s = p.toString();
    return s ? `/shop?${s}` : '/shop';
  };

  const buildPriceUrl = () => {
    const p = new URLSearchParams(searchParams.toString());
    if (priceMin) p.set('priceMin', priceMin);
    else p.delete('priceMin');
    if (priceMax) p.set('priceMax', priceMax);
    else p.delete('priceMax');
    p.delete('page');
    const s = p.toString();
    return s ? `/shop?${s}` : '/shop';
  };

  const brand = searchParams.get('brand') || '';
  const category = searchParams.get('category') || '';
  const sort = searchParams.get('sort') || 'default';

  return (
    <aside className="tb-sidebar wf-sidebar">
      <div className="tb-sidebar-section">
        <h4 className="tb-sidebar-title">相关推荐</h4>
        <Link href="/shop" className="tb-sidebar-link">
          月销口碑推荐排行榜
        </Link>
      </div>

      <div className="tb-sidebar-section">
        <h4 className="tb-sidebar-title">分类</h4>
        {CATEGORIES.map((c) => (
          <Link
            key={c.key || 'all'}
            href={buildUrl({ category: c.key || null })}
            className={`tb-filter-link ${category === c.key ? 'active' : ''}`}
          >
            {c.label}
          </Link>
        ))}
      </div>

      <div className="tb-sidebar-section">
        <h4 className="tb-sidebar-title">品牌</h4>
        {BRANDS.map((b) => (
          <Link
            key={b.key}
            href={buildUrl({ brand: brand === b.key ? null : b.key })}
            className={`tb-filter-link ${brand === b.key ? 'active' : ''}`}
          >
            {b.label}
          </Link>
        ))}
      </div>

      <div className="tb-sidebar-section">
        <h4 className="tb-sidebar-title">排序</h4>
        {SORT_OPTIONS.map((s) => (
          <Link
            key={s.key}
            href={buildUrl({ sort: s.key === 'default' ? null : s.key })}
            className={`tb-filter-link ${sort === s.key ? 'active' : ''}`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      <div className="tb-sidebar-section">
        <h4 className="tb-sidebar-title">价格区间（元）</h4>
        <form action={buildPriceUrl()} method="get" className="tb-price-form">
          {Array.from(searchParams.entries())
            .filter(([k]) => !['priceMin', 'priceMax', 'page'].includes(k))
            .map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          <div className="tb-price-inputs">
            <input
              type="number"
              name="priceMin"
              className="tb-price-input"
              placeholder="最低"
              value={priceMin}
              onChange={(e) => setPriceMin(e.target.value)}
              min={0}
            />
            <span className="tb-price-sep">-</span>
            <input
              type="number"
              name="priceMax"
              className="tb-price-input"
              placeholder="最高"
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value)}
              min={0}
            />
          </div>
          <button type="submit" className="tb-btn tb-btn-sm">
            确定
          </button>
        </form>
      </div>

      <Link href="/shop" className="tb-btn tb-btn-reset">
        重置
      </Link>
    </aside>
  );
}
