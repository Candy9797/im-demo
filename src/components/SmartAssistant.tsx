'use client';

/**
 * 自助导航面板：Bot 阶段显示
 * FAQ 快捷按钮、转人工入口
 */

import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chatStore';
import { ConversationPhase } from '@/sdk';

export const SmartAssistant: React.FC = () => {
  // useShallow：浅比较，仅 phase/faqItems 变化时更新（BOT→AGENT 切换、FAQ 配置变更）
  const { phase, faqItems } = useChatStore(
    useShallow((s) => ({
      phase: s.phase,
      faqItems: s.faqItems,
    }))
  );

  // Only show in bot phase
  if (phase !== ConversationPhase.BOT) return null;

  return (
    <div className="smart-assistant">
      <div className="faq-label">Common Questions</div>
      <div className="faq-grid">
        {faqItems.map((faq) => (
          <button
            key={faq.id}
            type="button"
            className={`faq-btn ${faq.id === 'faq-6' ? 'faq-btn-transfer' : ''}`}
            onClick={() => useChatStore.getState().selectFAQ(faq.id)}
          >
            <span className="faq-icon">{faq.icon}</span>
            <span className="faq-text">{faq.question}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
