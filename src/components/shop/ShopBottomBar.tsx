'use client';

import React from 'react';

const tabs = [
  { key: 'home', label: '首页', active: false },
  { key: 'shop', label: '商城', active: true },
  { key: 'msg', label: '消息', active: false },
  { key: 'me', label: '我', active: false },
];

export function ShopBottomBar() {
  return (
    <nav className="shop-bottom-bar">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          className={`shop-tab ${t.active ? 'active' : ''}`}
          aria-current={t.active ? 'page' : undefined}
        >
          <span className="shop-tab-icon">{t.label.charAt(0)}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
