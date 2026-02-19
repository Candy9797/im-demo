'use client';

import React, { useState } from 'react';
import Link from 'next/link';

interface TaobaoHeaderProps {
  suggestions?: string[];
  defaultSearch?: string;
}

export function TaobaoHeader({ suggestions = [], defaultSearch = '' }: TaobaoHeaderProps) {
  const [search, setSearch] = useState(defaultSearch);

  return (
    <>
      <div className="tb-top-bar">
        <div className="tb-top-inner">
          <span>全球</span>
          <a href="#">亲，请登录</a>
          <a href="#">免费注册</a>
          <a href="#">手机逛淘宝</a>
          <span className="tb-top-right">
            <a href="#">我的淘宝</a>
            <a href="#">购物车</a>
            <a href="#">收藏夹</a>
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

          <div className="tb-search-wrap">
            <form className="tb-search-form" onSubmit={(e) => e.preventDefault()}>
              <input
                type="search"
                className="tb-search-input"
                placeholder="蜡笔小新"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button type="submit" className="tb-search-btn">
                搜索
              </button>
            </form>
            <div className="tb-search-suggestions">
              <a href="#">全部分类</a>
              {suggestions.slice(0, 8).map((s) => (
                <a key={s} href="#">{s}</a>
              ))}
              <a href="#">更多...</a>
            </div>
          </div>

          <div className="tb-user-area">
            <span className="tb-greeting">Hi! 你好，请登录</span>
            <button type="button" className="tb-btn tb-btn-login">登录</button>
            <button type="button" className="tb-btn tb-btn-register">注册运费立减</button>
          </div>
        </div>
      </header>
    </>
  );
}
