'use client';

/**
 * 交易卡片分享弹窗：一键生成示例或填写后分享到当前会话（群/好友）
 */
import React, { useState, useCallback } from 'react';
import { TradeCard } from '@/components/TradeCard';
import type { TradeCardPayload } from '@/sdk';

const DEMO_PAYLOAD: TradeCardPayload = {
  symbol: 'BTCUSDT',
  side: 'buy',
  price: '43250.00',
  quantity: '0.015',
  quoteAmount: '648.75',
  pnl: '+12.35',
  pnlPercent: '+1.85',
  time: Date.now() - 300000,
  fee: '0.32 USDT',
};

export interface TradeCardShareModalProps {
  open: boolean;
  onClose: () => void;
  onShare: (payload: TradeCardPayload) => void;
}

export function TradeCardShareModal({ open, onClose, onShare }: TradeCardShareModalProps) {
  const [payload, setPayload] = useState<TradeCardPayload>(DEMO_PAYLOAD);

  const handleOneClickDemo = useCallback(() => {
    setPayload({
      ...DEMO_PAYLOAD,
      time: Date.now(),
      side: Math.random() > 0.5 ? 'buy' : 'sell',
      pnl: (Math.random() > 0.5 ? '+' : '-') + (Math.random() * 50).toFixed(2),
      pnlPercent: (Math.random() > 0.5 ? '+' : '-') + (Math.random() * 5).toFixed(2) + '%',
    });
  }, []);

  const handleShare = useCallback(() => {
    onShare(payload);
    onClose();
  }, [payload, onShare, onClose]);

  if (!open) return null;

  return (
    <div className="trade-share-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="分享交易卡片">
      <div className="trade-share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="trade-share-header">
          <h3>分享交易卡片</h3>
          <button type="button" className="trade-share-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="trade-share-preview">
          <TradeCard payload={payload} />
        </div>
        <div className="trade-share-actions">
          <button type="button" className="trade-share-btn demo" onClick={handleOneClickDemo}>
            一键生成示例
          </button>
          <button type="button" className="trade-share-btn primary" onClick={handleShare}>
            分享到当前会话
          </button>
        </div>
      </div>
    </div>
  );
}
