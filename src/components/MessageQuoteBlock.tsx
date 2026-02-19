'use client';

/**
 * 消息内引用块：展示被引用消息的发件人、内容预览
 * 用于「引用回复」时的消息气泡内展示
 */
import React from 'react';
import type { QuoteInfo } from '@/sdk';

interface MessageQuoteBlockProps {
  quote: QuoteInfo;
}

export const MessageQuoteBlock: React.FC<MessageQuoteBlockProps> = ({ quote }) => {
  const preview = (quote.content ?? '').slice(0, 120);
  const truncated = (quote.content ?? '').length > 120; // 是否需显示省略号

  return (
    <div className="message-quote-block">
      <div className="quote-bar" />
      <div className="quote-content">
        <span className="quote-sender">{quote.senderName}</span>
        <span className="quote-text">
          {/* 内容截断至 120 字符，超出显示省略号 */}
          {preview}
          {truncated ? '…' : ''}
        </span>
      </div>
    </div>
  );
};
