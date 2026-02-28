'use client';

/**
 * 历史/性能测试页：Mock 消息、数量切换、虚拟列表、发送模拟
 * history 页主要是做组件性能验证，重点测的是 HistoryMessageList + Virtuoso 虚拟列表 的表现。
测的是哪些组件
HistoryMessageList：基于 Virtuoso 的虚拟消息列表
MessageItem：单条消息展示（头像、气泡、表情等）
主要解决/验证的问题
1. 长列表性能（千轮对话）
问题：一次性渲染几千条消息会导致大量 DOM，容易卡顿、白屏
方案：用 Virtuoso 做虚拟滚动（Windowing），只渲染视口内的若干条 + overscan
验证：切换 500 / 1k / 2k / 5k / 1 万 条消息，确认滚动仍然流畅
2. DOM 数量基本恒定
问题：普通列表：N 条消息 ≈ N 个 DOM 节点
方案：虚拟列表只挂载可见区域内的条目，其余用 padding 占位
效果：总消息量增加时，实际渲染的 DOM 数量保持约 10–20 个左右，不随消息量线性增长
3. 可选渲染复杂度（hideReactions）
问题：表情反应会额外增加 DOM 和样式
验证：通过「显示/隐藏表情反应」开关，对比有无 reactions 时的渲染耗时和流畅度
和真实 IM 的关系
数据是 Mock（generateMockMessages），不接 WebSocket
主要目的是验证长列表渲染策略（虚拟列表）在极端数据量下是否可行
客服 IM 的 MessageList 也用 Virtuoso，历史页相当于一个可控制规模的性能回归测试环境
1. DOM 节点
每条消息大致会多出：
MessageItem  └─ MessageReactions       ├─ div.message-reactions（容器）       ├─ div.reaction-list（有反应时）       │    └─ button.reaction-chip × N（每个 emoji 一个，如 👍、❤️、😂）       │         ├─ span（emoji）       │         └─ span.reaction-count（人数）       └─ button.reaction-add-btn（+ 或 🙂）
无反应：至少 1 个按钮
有反应：每个 emoji 一个 chip + 人数，再加 1 个添加按钮
例如 1000 条消息、每条平均 2 个 reaction，就会多出约 3000 个按钮。
2. 样式与逻辑
每个 reaction-chip、reaction-add-btn、reaction-mine 都需要对应 CSS
hideReactions 时，这些 DOM 和样式都不渲染，Virtuoso 只测量消息主体，更少布局计算和重绘
Portal 是 React 提供的机制：把组件渲染到指定 DOM 节点，而不是当前父组件所在的 DOM 树里。
 */

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import { HistoryMessageList } from '@/components/HistoryMessageList';
import { HistoryInputArea } from '@/components/HistoryInputArea';
import { generateMockMessages, createUserMessage, createBotReply } from '@/lib/mockMessages';
import type { Message } from '@/sdk';

const PRESET_COUNTS = [
  { label: '500 条', value: 500 },
  { label: '1,000 条', value: 1000 },
  { label: '2,000 条', value: 2000 },
  { label: '5,000 条', value: 5000 },
  { label: '10,000 条', value: 10000 },
];

export default function HistoryPage() {
  const [messages, setMessages] = useState<Message[]>(() => generateMockMessages(1000));
  const [count, setCount] = useState(1000);
  const [hideReactions, setHideReactions] = useState(true);
  const [renderTime, setRenderTime] = useState<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  /** 每次点击预设数量：追加 n 条到现有列表，不清空 */
  const loadMessages = useCallback((n: number) => {
    setIsGenerating(true);
    const start = performance.now();
    setMessages((prev) => {
      const startSeqId = prev.length + 1;
      const appended = generateMockMessages(n, startSeqId);
      return [...prev, ...appended];
    });
    setCount(n); // 用于高亮当前点击的预设，总条数由 messages.length 显示
    requestAnimationFrame(() => {
      const end = performance.now();
      setRenderTime(Math.round(end - start));
      setIsGenerating(false);
    });
  }, []);

  const handleSendMessage = useCallback((content: string) => {
    const nextSeq = messages.length + 1;
    const userMsg = createUserMessage(content, nextSeq);
    const botMsg = createBotReply(
      '收到您的消息。这是历史页面的模拟回复，消息仅保存在本地。',
      nextSeq + 1
    );
    setMessages((prev) => [...prev, userMsg, botMsg]);
  }, [messages.length]);

  return (
    <div className="history-page">
      <header className="history-header">
        <div className="history-header-left">
          <Link href="/" className="history-back-btn">
            ← 返回
          </Link>
          <h1 className="history-title">会话历史</h1>
        </div>
        <div className="history-header-meta">
          <span className="history-count">{messages.length.toLocaleString()} 条消息</span>
          {renderTime != null && (
            <span className="history-perf">生成耗时 {renderTime}ms</span>
          )}
        </div>
      </header>

      <div className="history-toolbar">
        <div className="history-presets">
          <span className="history-label">消息数量：</span>
          {PRESET_COUNTS.map(({ label, value }) => (
            <button
              key={value}
              className={`history-preset-btn ${count === value ? 'active' : ''}`}
              onClick={() => loadMessages(value)}
              disabled={isGenerating}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="history-options">
          <label className="history-toggle">
            <input
              type="checkbox"
              checked={!hideReactions}
              onChange={(e) => setHideReactions(!e.target.checked)}
            />
            <span>显示表情反应</span>
          </label>
          <span className="history-hint">虚拟滚动</span>
        </div>
      </div>

      <main className="history-main">
        <div className="history-list-wrap">
          <HistoryMessageList messages={messages} hideReactions={hideReactions} />
        </div>
        <HistoryInputArea onSend={handleSendMessage} />
      </main>
    </div>
  );
}
