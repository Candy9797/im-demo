'use client';

import React from 'react';

const BRANDS = ['vivo', '故宫淘宝'];
const TARGETS = ['青少年', '通用'];

export function ShopSidebar() {
  return (
    <aside className="tb-sidebar">
      <div className="tb-sidebar-section">
        <h4 className="tb-sidebar-title">淘宝网官网相关推荐</h4>
        <a href="#" className="tb-sidebar-link">
          月销口碑推荐排行榜
        </a>
      </div>
      <div className="tb-sidebar-section">
        <h4 className="tb-sidebar-title">品牌</h4>
        {BRANDS.map((b) => (
          <label key={b} className="tb-checkbox">
            <input type="checkbox" />
            <span>{b}</span>
          </label>
        ))}
      </div>
      <div className="tb-sidebar-section">
        <h4 className="tb-sidebar-title">适用对象</h4>
        {TARGETS.map((t) => (
          <label key={t} className="tb-checkbox">
            <input type="checkbox" />
            <span>{t}</span>
          </label>
        ))}
      </div>
      <button type="button" className="tb-btn tb-btn-reset">
        重置
      </button>
    </aside>
  );
}
