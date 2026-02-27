'use client';

/**
 * 交易卡片 - 仿币安分享样式
 * 用于在聊天中展示一条交易记录，支持分享到群/好友
 */
import React from 'react';
import type { TradeCardPayload } from '@/sdk';

export interface TradeCardProps {
  payload: TradeCardPayload;
  className?: string;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${M}-${D} ${h}:${m}:${s}`;
}

export function TradeCard({ payload, className = '' }: TradeCardProps) {
  const { symbol, side, price, quantity, quoteAmount, pnl, pnlPercent, time, fee } = payload;
  const isBuy = side === 'buy';
  const hasProfit = pnl != null && Number(pnl) !== 0;
  const isProfit = hasProfit && Number(pnl) > 0;

  return (
    <div className={`trade-card ${className}`.trim()} data-side={side}>
      <div className="trade-card-header">
        <span className="trade-card-logo" aria-hidden>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
          </svg>
        </span>
        <span className="trade-card-symbol">{symbol}</span>
        <span className={`trade-card-side ${isBuy ? 'buy' : 'sell'}`}>
          {isBuy ? '买入' : '卖出'}
        </span>
      </div>
      <div className="trade-card-body">
        <div className="trade-card-row">
          <span className="trade-card-label">价格</span>
          <span className="trade-card-value">{price}</span>
        </div>
        <div className="trade-card-row">
          <span className="trade-card-label">数量</span>
          <span className="trade-card-value">{quantity}</span>
        </div>
        {quoteAmount != null && (
          <div className="trade-card-row">
            <span className="trade-card-label">成交额</span>
            <span className="trade-card-value">{quoteAmount}</span>
          </div>
        )}
        {pnl != null && (
          <div className="trade-card-row">
            <span className="trade-card-label">盈亏</span>
            <span className={`trade-card-value trade-card-pnl ${isProfit ? 'profit' : 'loss'}`}>
              {isProfit ? '+' : ''}{pnl}
              {pnlPercent != null && (
                <span className="trade-card-pnl-pct"> ({isProfit ? '+' : ''}{pnlPercent}%)</span>
              )}
            </span>
          </div>
        )}
        {fee != null && (
          <div className="trade-card-row">
            <span className="trade-card-label">手续费</span>
            <span className="trade-card-value trade-card-fee">{fee}</span>
          </div>
        )}
      </div>
      <div className="trade-card-footer">
        <span className="trade-card-time">{formatTime(time)}</span>
      </div>
    </div>
  );
}
