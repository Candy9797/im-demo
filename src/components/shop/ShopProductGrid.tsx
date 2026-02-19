'use client';

import React, { useState } from 'react';
import { TaobaoProductCard } from './TaobaoProductCard';
import type { Product } from '@/lib/shop/mockProducts';

type SortKey = 'sales' | 'comprehensive' | 'credit' | 'price';
type ViewMode = 'grid' | 'list';

interface ShopProductGridProps {
  products: Product[];
}

export function ShopProductGrid({ products }: ShopProductGridProps) {
  const [sort, setSort] = useState<SortKey>('sales');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

  const sortedProducts = [...products].sort((a, b) => {
    if (sort === 'sales') return (b.sales ?? 0) - (a.sales ?? 0);
    if (sort === 'price') return a.price - b.price;
    return 0;
  });

  return (
    <div className="tb-main">
      <div className="tb-breadcrumb">
        <a href="/">首页</a>
        <span className="tb-sep">&gt;</span>
        <span>淘宝网官网</span>
        <span className="tb-item-count">（共找到{products.length}件商品）</span>
      </div>

      <div className="tb-toolbar">
        <div className="tb-sort-tabs">
          <button
            type="button"
            className={`tb-sort-tab ${sort === 'sales' ? 'active' : ''}`}
            onClick={() => setSort('sales')}
          >
            销量排序
          </button>
          <button
            type="button"
            className={`tb-sort-tab ${sort === 'comprehensive' ? 'active' : ''}`}
            onClick={() => setSort('comprehensive')}
          >
            综合排序
          </button>
          <button
            type="button"
            className={`tb-sort-tab ${sort === 'credit' ? 'active' : ''}`}
            onClick={() => setSort('credit')}
          >
            信用排序
          </button>
          <div className="tb-sort-price">
            <span>价格排序：</span>
            <input
              type="number"
              placeholder="最低价(¥)"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              className="tb-price-input"
            />
            <span>-</span>
            <input
              type="number"
              placeholder="最高价(¥)"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className="tb-price-input"
            />
          </div>
        </div>
        <div className="tb-view-toggle">
          <button
            type="button"
            className={viewMode === 'grid' ? 'active' : ''}
            onClick={() => setViewMode('grid')}
            aria-label="网格视图"
          >
            □
          </button>
          <button
            type="button"
            className={viewMode === 'list' ? 'active' : ''}
            onClick={() => setViewMode('list')}
            aria-label="列表视图"
          >
            ≡
          </button>
        </div>
      </div>

      <div className={`tb-product-grid ${viewMode}`}>
        {sortedProducts.map((p) => (
          <TaobaoProductCard key={p.id} product={p} />
        ))}
      </div>
    </div>
  );
}
