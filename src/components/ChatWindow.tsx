'use client';

/**
 * 聊天主容器：Header、QueueBanner、MessageList、SmartAssistant、InputArea
 * 未登录时显示 SmartAssistant，已登录显示消息列表
 */
import React, { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore, countUnread } from '@/store/chatStore';
import { Header } from '@/components/Header';
import { QueueBanner } from '@/components/QueueBanner';
import { SmartAssistant } from '@/components/SmartAssistant';
import { MessageList } from '@/components/MessageList';
import { InputArea } from '@/components/InputArea';
import { Toast } from '@/components/Toast';

export const ChatWindow: React.FC = () => {
  // useShallow：浅比较，仅 isOpen/isMinimized/messages/auth 变化时更新（开关、折叠、未读数、登录态）
  const { isOpen, isMinimized, isExpanded, initialize, messages, auth, simulateIncomingMessages, client } = useChatStore(
    useShallow((s) => ({
      isOpen: s.isOpen,
      isMinimized: s.isMinimized,
      isExpanded: s.isExpanded,
      initialize: s.initialize,
      messages: s.messages,
      auth: s.auth,
      simulateIncomingMessages: s.simulateIncomingMessages,
      client: s.client,
    }))
  );
  const [simulateCount, setSimulateCount] = useState(10);
  const unreadCount = countUnread(messages, auth?.userId);

  useEffect(() => {
    if (isOpen && !useChatStore.getState().client) initialize();
  }, [isOpen, initialize]);

  // client 就绪后同步连接状态，解决刷新后已连上但 UI 仍显示未连接
  useEffect(() => {
    if (isOpen && client) useChatStore.getState().syncConnectionState();
  }, [isOpen, client]);

  if (!isOpen) return null;

  if (isMinimized) {
    return (
      <div className="chat-window minimized" onClick={() => useChatStore.getState().toggleMinimize()}>
        <div className="minimized-bar">
          <span className="minimized-title">Support Chat</span>
          <span className="minimized-right">
            {unreadCount > 0 && <span className="unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </span>
        </div>
      </div>
    );
  }

  const handleSimulateSend = () => {
    const n = Math.min(100, Math.max(1, Number(simulateCount) || 10));
    setSimulateCount(n);
    simulateIncomingMessages(n);
  };

  return (
    <div className={`chat-window${isExpanded ? ' expanded' : ''}`}>
      <Header />
      <QueueBanner />
      {auth && (
        <div className="chat-window-simulate-bar">
          <input
            type="number"
            min={1}
            max={100}
            value={simulateCount}
            onChange={(e) => setSimulateCount(Number(e.target.value) || 10)}
            className="chat-window-simulate-input"
            aria-label="模拟条数"
          />
          <span className="chat-window-simulate-label">条</span>
          <button type="button" onClick={handleSimulateSend} className="chat-window-simulate-btn">
            模拟对方连发
          </button>
        </div>
      )}
      <div className="chat-body">
        <MessageList />
        <SmartAssistant />
      </div>
      <InputArea />
      <Toast />
    </div>
  );
};

/**
 * Chat Trigger Button
 * Floating button that opens the chat when clicked
 */
export const ChatTrigger: React.FC = () => {
  // useShallow：浅比较，仅 isOpen/auth/messages 变化时更新（用于未读数角标）
  const { isOpen, auth, messages } = useChatStore(
    useShallow((s) => ({ isOpen: s.isOpen, auth: s.auth, messages: s.messages }))
  );
  const unreadCount = countUnread(messages, auth?.userId);

  const handleClick = async () => {
    if (isOpen) return;
    if (!auth) {
      const ok = await useChatStore.getState().connectAsGuest();
      if (!ok) return;
    }
    useChatStore.getState().toggleOpen();
  };

  if (isOpen) return null;

  return (
    <button
      className="chat-trigger"
      onClick={handleClick}
      aria-label="Open support chat"
    >
      <span className="chat-trigger-icon-wrap">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {unreadCount > 0 && <span className="unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </span>
      <span className="trigger-label">Help & Support</span>
    </button>
  );
};
