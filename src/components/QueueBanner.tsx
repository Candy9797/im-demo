'use client';

/**
 * 排队横幅：转人工排队时显示，展示排队位置和预估等待时间
 */

import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chatStore';
import { ConversationPhase } from '@/sdk';

export const QueueBanner: React.FC = () => {
  // useShallow：浅比较，仅 phase/queue 变化时更新（转人工排队、position 更新）
  const { phase, queue } = useChatStore(
    useShallow((s) => ({ phase: s.phase, queue: s.queue }))
  );

  if (phase !== ConversationPhase.QUEUING || !queue) return null;

  const formatWait = (seconds: number) => {
    if (seconds < 60) return `~${seconds}s`;
    return `~${Math.ceil(seconds / 60)} min`;
  };

  return (
    <div className="queue-banner">
      <div className="queue-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </div>
      <div className="queue-info">
        <span className="queue-position">
          Queue position: <strong>#{queue.position}</strong>
        </span>
        <span className="queue-wait">
          Estimated wait: {formatWait(queue.estimatedWait)}
        </span>
      </div>
      <div className="queue-loader">
        <div className="queue-loader-bar" />
      </div>
    </div>
  );
};
