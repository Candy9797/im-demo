'use client';

import React from 'react';
import Link from 'next/link';
import { ShopSearchBar } from './ShopSearchBar';
import { useCartStore } from '@/stores/cartStore';

interface ShopHeaderProps {
  suggestions?: string[];
  defaultSearch?: string;
}

export function ShopHeader({ suggestions = [], defaultSearch = '' }: ShopHeaderProps) {
  const totalCount = useCartStore((s) => s.totalCount());

  return (
    <>
      <div className="tb-top-bar">
        <div className="tb-top-inner">
          <span>全球</span>
          <Link href="/">亲，请登录</Link>
          <Link href="/">免费注册</Link>
          <Link href="/">手机逛淘宝</Link>
          <span className="tb-top-right">
            <Link href="/">我的淘宝</Link>
            <Link href="/shop/cart" className="tb-cart-link">
              购物车
              {totalCount > 0 && (
                <span className="tb-cart-count">{totalCount > 99 ? '99+' : totalCount}</span>
              )}
            </Link>
            <Link href="/">收藏夹</Link>
          </span>
        </div>
      </div>

      <header className="tb-header">
        <div className="tb-header-inner">
          <Link href="/" className="tb-logo">
            <span className="tb-logo-cn">淘宝</span>
            <span className="tb-logo-en">Taobao</span>
            <span className="tb-logo-global">全球</span>
          </Link>

          <ShopSearchBar suggestions={suggestions} defaultSearch={defaultSearch} />

          <div className="tb-user-area">
            <span className="tb-greeting">Hi! 你好，请登录</span>
            <Link href="/" className="tb-btn tb-btn-login">
              登录
            </Link>
            <Link href="/" className="tb-btn tb-btn-register">
              注册运费立减
            </Link>
          </div>
        </div>
      </header>
    </>
  );
}
