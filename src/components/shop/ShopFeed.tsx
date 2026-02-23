'use client';

import React, { useTransition } from 'react';
import { ProductCard } from './ProductCard';
import type { Product } from '@/lib/shop/mockProducts';

/** 性能策略（见 docs/抖音商城风格电商页面方案.md 五）：并发更新 - useTransition 包裹加购/购买 */

interface ShopFeedProps {
  products: Product[];
}

export function ShopFeed({ products }: ShopFeedProps) {
  /**
   * useTransition 把「加购/购买」触发的更新标记为非紧急（transition）：
   * - 加购/购买会触发状态更新（如购物车 Store）或路由跳转（如去结算），这些都会导致整列表或整页重渲染。
   * - 不包的话：React 会把这些更新当紧急处理，点击后可能整块 UI 卡住或闪一下，体验差。
   * - 包了之后：当前列表保持可交互、不阻塞，更新在后台应用；用户能继续滚动/点击，同时通过 isPending 看到「正在处理」的反馈（底部 loading 条），过渡更顺滑。
   */
  const [isPending, startTransition] = useTransition();

  const handleBuy = (p: Product) => {
    startTransition(() => {
      console.log('Buy', p.id);
      // 可接入购物流程、路由跳转等
    });
  };

  const handleAddCart = (p: Product) => {
    startTransition(() => {
      console.log('Add cart', p.id);
      // 可接入购物车 Store
    });
  };

  return (
    <div className="shop-feed">
      {products.map((product) => (
        <section key={product.id} className="shop-feed-item">
          <ProductCard
            product={product}
            onBuy={handleBuy}
            onAddCart={handleAddCart}
          />
        </section>
      ))}
      {isPending && <div className="shop-loading-bar" aria-hidden />}
    </div>
  );
}
