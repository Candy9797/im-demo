'use client';

/**
 * 正在输入指示：Bot/Agent 输入时显示动画点点
 */

import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chatStore';
import { SenderType } from '@/sdk';

export const TypingIndicator: React.FC = () => {
  // useShallow：浅比较，仅 typing 变化时更新（Bot/Agent 输入态变更）
  const { typing } = useChatStore(useShallow((s) => ({ typing: s.typing })));

  if (!typing.isTyping) return null;

  const getName = () => {
    switch (typing.senderType) {
      case SenderType.BOT:
        return 'Smart Assistant';
      case SenderType.AGENT:
        return 'Agent';
      default:
        return 'Someone';
    }
  };

  return (
    <div className="typing-indicator">
      <div className="typing-avatar">
        {typing.senderType === SenderType.BOT ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <circle cx="12" cy="5" r="4" />
          </svg>
        ) : (
          <span>CS</span>
        )}
      </div>
      <div className="typing-content">
        <span className="typing-name">{getName()}</span>
        <div className="typing-dots">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </div>
      </div>
    </div>
  );
};
