'use client';

/**
 * QuotePreview - 输入框上方展示被引用消息，可取消
 */
import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chatStore';

export const QuotePreview: React.FC = () => {
  // useShallow：浅比较，仅 quoteTarget 变化时更新（点击回复时设置引用目标）
  const { quoteTarget, setQuoteTarget } = useChatStore(
    useShallow((s) => ({ quoteTarget: s.quoteTarget, setQuoteTarget: s.setQuoteTarget }))
  );

  if (!quoteTarget) return null;

  const preview = (quoteTarget.content ?? '').slice(0, 80);
  const truncated = (quoteTarget.content ?? '').length > 80;

  return (
    <div className="quote-preview">
      <div className="quote-bar" />
      <div className="quote-preview-content">
        <span className="quote-preview-sender">{quoteTarget.senderName}</span>
        <span className="quote-preview-text">
          {preview}
          {truncated ? '…' : ''}
        </span>
      </div>
      <button
        className="quote-preview-close"
        onClick={() => setQuoteTarget(null)}
        title="取消引用"
        aria-label="取消引用"
      >
        ✕
      </button>
    </div>
  );
};
