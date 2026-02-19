'use client';

/**
 * 聊天会话页：侧边栏（好友/群组）+ 主区域（消息列表 + 输入）
 */
import React from 'react';
import { ChatSessionSidebar } from '@/components/chat/ChatSessionSidebar';
import { ChatSessionMain } from '@/components/chat/ChatSessionMain';

export default function ChatPage() {
  return (
    <div className="chat-session-page">
      <ChatSessionSidebar />
      <ChatSessionMain />
    </div>
  );
}
