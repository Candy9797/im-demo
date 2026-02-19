'use client';

/**
 * ChatSessionQuotePreview - 会话页输入框上方展示被引用消息，可取消
 * 使用 chatSessionStore（与客服 IM 的 QuotePreview 使用 chatStore 区分）
 */
import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useChatSessionStore } from '@/store/chatSessionStore';

export const ChatSessionQuotePreview: React.FC = () => {
  const { quoteTarget, setQuoteTarget } = useChatSessionStore(
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
