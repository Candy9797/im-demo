'use client';

/**
 * 聊天 Header：根据 phase 展示 Bot/排队/Agent 标题，连接状态，最小化/关闭
 */

import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chatStore';
import { ConversationPhase, ConnectionState } from '@/sdk';
import { PresenceIndicator } from '@/components/PresenceIndicator';
import { SearchBar } from '@/components/SearchBar';

export const Header: React.FC = () => {
  // useShallow：浅比较，仅 phase/agentInfo/connectionState 变化时更新（会话阶段、Agent 信息、连接态）
  const { phase, agentInfo, connectionState, toggleMinimize, toggleExpand, isExpanded, toggleOpen } = useChatStore(
    useShallow((s) => ({
      phase: s.phase,
      agentInfo: s.agentInfo,
      connectionState: s.connectionState,
      toggleMinimize: s.toggleMinimize,
      toggleExpand: s.toggleExpand,
      isExpanded: s.isExpanded,
      toggleOpen: s.toggleOpen,
    }))
  );
  const [showSearch, setShowSearch] = useState(false);

  const getStatusColor = () => {
    switch (connectionState) {
      case ConnectionState.CONNECTED:
        return '#0ecb81';
      case ConnectionState.CONNECTING:
      case ConnectionState.RECONNECTING:
        return '#f0b90b';
      case ConnectionState.DISCONNECTED:
        return '#f6465d';
      default:
        return '#848e9c';
    }
  };

  const getTitle = () => {
    switch (phase) {
      case ConversationPhase.BOT:
        return 'Smart Assistant';
      case ConversationPhase.QUEUING:
        return 'Connecting to Agent...';
      case ConversationPhase.AGENT:
        return agentInfo ? `${agentInfo.name} #${agentInfo.code}` : 'Customer Service';
      case ConversationPhase.CLOSED:
        return 'Chat Ended';
      default:
        return 'Support';
    }
  };

  const getSubtitle = () => {
    switch (phase) {
      case ConversationPhase.BOT:
        return 'Online • Instant Reply';
      case ConversationPhase.QUEUING:
        return 'Please wait...';
      case ConversationPhase.AGENT:
        return agentInfo?.department || 'General Support';
      case ConversationPhase.CLOSED:
        return 'Session closed';
      default:
        return '';
    }
  };

  const showPresence = phase === ConversationPhase.BOT || phase === ConversationPhase.AGENT;

  const getAvatar = () => {
    switch (phase) {
      case ConversationPhase.BOT:
        return (
          <div className="header-avatar bot-avatar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <circle cx="12" cy="5" r="4" />
              <line x1="8" y1="16" x2="8" y2="16" />
              <line x1="16" y1="16" x2="16" y2="16" />
            </svg>
          </div>
        );
      case ConversationPhase.AGENT:
        return (
          <div className="header-avatar agent-avatar">
            <span>{agentInfo?.name?.charAt(0) || 'C'}</span>
          </div>
        );
      default:
        return (
          <div className="header-avatar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
        );
    }
  };

  return (
    <div className="chat-header-wrapper">
    <div className="chat-header">
      <div className="header-left">
        {getAvatar()}
        <div className="header-info">
          <div className="header-title">
            <span className="connection-dot" style={{ backgroundColor: getStatusColor() }} />
            {getTitle()}
          </div>
          <div className="header-subtitle">
            {getSubtitle()}
            {showPresence && (
              <>
                <span className="header-subtitle-sep"> • </span>
                <PresenceIndicator />
              </>
            )}
          </div>
        </div>
      </div>
      <div className="header-actions">
        <button
          className="header-btn"
          onClick={() => setShowSearch((v) => !v)}
          title="Search"
          aria-label="Search messages"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        <button
          className="header-btn"
          onClick={toggleExpand}
          title={isExpanded ? '缩小' : '放大'}
          aria-label={isExpanded ? '缩小' : '放大'}
        >
          {isExpanded ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          )}
        </button>
        <button
          className="header-btn"
          onClick={toggleMinimize}
          title="Minimize"
          aria-label="Minimize chat"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button
          className="header-btn"
          onClick={toggleOpen}
          title="Close"
          aria-label="Close chat"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
    {showSearch && (
      <div className="header-search">
        <SearchBar onClose={() => setShowSearch(false)} />
      </div>
    )}
    </div>
  );
};
