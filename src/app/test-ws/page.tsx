'use client';

/**
 * WebSocket 联调测试页：会话、消息全部走真实 WS，无 Mock
 *
 * 用途：验证 IM 完整流程（连接、auth_ok、发送、接收、批量 ack）
 * 数据源：server/ws-handler、SQLite，全部真实
 */

import React, { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chatStore';
import { MessageList } from '@/components/MessageList';
import { InputArea } from '@/components/InputArea';
import { QueueBanner } from '@/components/QueueBanner';
import { SmartAssistant } from '@/components/SmartAssistant';

export default function TestWsPage() {
  const {
    client,
    connectionState,
    connectAsGuest,
    initialize,
    auth,
    conversationId,
    phase,
    messages,
  } = useChatStore(
    useShallow((s) => ({
      client: s.client,
      connectionState: s.connectionState,
      connectAsGuest: s.connectAsGuest,
      initialize: s.initialize,
      auth: s.auth,
      conversationId: s.conversationId,
      phase: s.phase,
      messages: s.messages,
    }))
  );

  const [connectLoading, setConnectLoading] = useState(false);

  const isConnected = connectionState === 'connected';

  const handleConnect = useCallback(async () => {
    if (isConnected) return;
    setConnectLoading(true);
    try {
      if (!auth) {
        const ok = await connectAsGuest();
        if (!ok) return;
      }
      await initialize();
    } finally {
      setConnectLoading(false);
    }
  }, [isConnected, auth, connectAsGuest, initialize]);

  return (
    <div className="test-ws-page">
      <header className="test-ws-header">
        <div className="test-ws-header-left">
          <Link href="/" className="test-ws-back">
            ← 返回
          </Link>
          <h1 className="test-ws-title">WS 联调测试</h1>
        </div>
        <div className="test-ws-header-meta">
          <span
            className={
              isConnected ? 'test-ws-status ok' : 'test-ws-status disconnected'
            }
          >
            {isConnected ? '已连接' : '未连接'}
          </span>
          {!isConnected && (
            <button
              className="test-ws-btn"
              onClick={handleConnect}
              disabled={connectLoading}
            >
              {connectLoading ? '连接中…' : '连接（访客）'}
            </button>
          )}
        </div>
      </header>

      <div className="test-ws-debug">
        {isConnected && (
          <div className="test-ws-debug-actions">
            <span className="test-ws-debug-label">模拟推送：</span>
            {[50, 100, 200].map((n) => (
              <button
                key={n}
                type="button"
                className="test-ws-debug-btn"
                onClick={() => client?.requestSimulatePush(n)}
              >
                对方发 {n} 条
              </button>
            ))}
          </div>
        )}
        <div className="test-ws-debug-row">
          <span>connectionState</span>
          <code>{connectionState}</code>
        </div>
        <div className="test-ws-debug-row">
          <span>conversationId</span>
          <code>{conversationId || '—'}</code>
        </div>
        <div className="test-ws-debug-row">
          <span>phase</span>
          <code>{phase}</code>
        </div>
        <div className="test-ws-debug-row">
          <span>messages</span>
          <code>{messages.length} 条</code>
        </div>
      </div>

      {!isConnected ? (
        <div className="test-ws-tip">
          <p>请先点击「连接（访客）」建立 WebSocket 连接</p>
          <p className="test-ws-tip-alt">
            会话、消息均从服务端 auth_ok / SYNC 获取，无 Mock
          </p>
        </div>
      ) : (
        <div className="test-ws-chat">
          <QueueBanner />
          <div className="test-ws-body">
            <MessageList />
            <SmartAssistant />
          </div>
          <InputArea />
        </div>
      )}

      <div className="test-ws-footer">
        <p>数据流：connect → auth_ok（conversationId + messages）→ send_message → message_ack / message</p>
        <p>「模拟推送」：通过 WS 请求服务端推送 N 条 Mock 消息，验证虚拟列表、大量消息下的 UI 表现</p>
        <p>
          <Link href="/stress">压测页</Link>
          {' · '}
          <Link href="/">首页</Link>
        </p>
      </div>
    </div>
  );
}
