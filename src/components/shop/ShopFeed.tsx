'use client';

import React, { useTransition } from 'react';
import { ProductCard } from './ProductCard';
import type { Product } from '@/lib/shop/mockProducts';

interface ShopFeedProps {
  products: Product[];
}

export function ShopFeed({ products }: ShopFeedProps) {
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
