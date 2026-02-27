'use client';

/**
 * 聊天主区域：消息列表（Virtuoso）+ 输入框
 * 展示当前选中会话的消息，支持虚拟化渲染
 *
 * 性能策略（见 docs/抖音商城风格电商页面方案.md 五）：
 * - 虚拟化：Virtuoso 仅渲染可见区，overscan 为缓冲区
 */
import React, { useMemo, useEffect, useRef } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useShallow } from 'zustand/react/shallow';
import { useChatSessionStore } from '@/store/chatSessionStore';
import { MessageItem } from '@/components/MessageItem';
import { ChatSessionInput } from '@/components/chat/ChatSessionInput';
import { CURRENT_USER_ID, getConversationKey } from '@/lib/chatSessionMock';
import type { Message } from '@/sdk';

export const ChatSessionMain: React.FC = () => {
  // useShallow：浅比较，仅 activeConversation/messagesByConv/typingByGroup/groups 变化时更新（切换会话、新消息、输入态）
  const { activeConversation, messagesByConv, typingByGroup, groups, editMessage, recallMessage, replyToMessage, addReaction, removeReaction, rehydrateActiveConversation } = useChatSessionStore(
    useShallow((s) => ({
      activeConversation: s.activeConversation,
      messagesByConv: s.messagesByConv,
      typingByGroup: s.typingByGroup,
      groups: s.groups,
      editMessage: s.editMessage,
      recallMessage: s.recallMessage,
      replyToMessage: s.replyToMessage,
      addReaction: s.addReaction,
      removeReaction: s.removeReaction,
      rehydrateActiveConversation: s.rehydrateActiveConversation,
    }))
  );

  // 刷新后从 sessionStorage 恢复当前会话，以便从 IndexedDB 恢复待发送草稿
  useEffect(() => {
    rehydrateActiveConversation();
  }, [rehydrateActiveConversation]);

  const conversationKey = useMemo(() => {
    if (!activeConversation) return '';
    return activeConversation.type === 'c2c'
      ? getConversationKey('c2c', activeConversation.id)
      : activeConversation.id;
  }, [activeConversation]);

  const messages = useMemo(() => {
    if (!activeConversation || !conversationKey) return [];
    const raw = messagesByConv[conversationKey] ?? [];
    return [...raw].sort((a, b) => (a.seqId ?? a.timestamp) - (b.seqId ?? b.timestamp));
  }, [activeConversation, conversationKey, messagesByConv]);
  const typingUserIds = activeConversation?.type === 'group'
    ? (typingByGroup[activeConversation.id] ?? [])
    : [];

  // 切换会话时保持每个会话的滚动位置：按会话 key 存「顶部可见条目的 index」
  const scrollTopIndexByKeyRef = useRef<Record<string, number>>({});
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  const scrollToIndex = useMemo(() => {
    if (!conversationKey || messages.length === 0) return Math.max(0, messages.length - 1);
    const saved = scrollTopIndexByKeyRef.current[conversationKey];
    if (saved !== undefined && saved >= 0 && saved < messages.length) return saved;
    return Math.max(0, messages.length - 1);
  }, [conversationKey, messages.length]);

  // initialTopMostItemIndex 只在首次挂载生效；切换会话后需主动 scrollToIndex 才能恢复位置
  useEffect(() => {
    if (!conversationKey || messages.length === 0) return;
    const t = setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({ index: scrollToIndex, align: 'start', behavior: 'auto' });
    }, 0);
    return () => clearTimeout(t);
  }, [conversationKey, scrollToIndex, messages.length]);

  if (!activeConversation) {
    return (
      <div className="chat-session-empty">
        <div className="chat-session-empty-icon">💬</div>
        <p>从左侧选择好友或群组开始聊天</p>
      </div>
    );
  }

  const itemContent = (_index: number, message: Message) => (
    <MessageItem
      message={message}
      currentUserId={CURRENT_USER_ID}
      onReply={replyToMessage}
      onAddReaction={addReaction}
      onRemoveReaction={removeReaction}
      onEdit={(m, content) => editMessage(m.id, content)}
      onRecall={(m) => recallMessage(m.id)}
    />
  );

  return (
    <div className="chat-session-main">
      <div className="chat-session-main-header">
        <h3>{activeConversation.name}</h3>
        {activeConversation.type === 'group' && (
          <span className="chat-session-main-sub">
            {groups.find((g) => g.id === activeConversation!.id)?.memberCount ?? 0} 人
          </span>
        )}
        <span className="chat-session-conv-id" title="会话 ID（用于拉取消息）">
          ID: {conversationKey}
        </span>
      </div>

      <div className="chat-session-messages">
        <Virtuoso
          ref={virtuosoRef}
          style={{ height: '100%' }}
          data={messages}
          initialTopMostItemIndex={scrollToIndex}
          followOutput="smooth"
          rangeChanged={(range) => {
            scrollTopIndexByKeyRef.current[conversationKey] = range.startIndex;
          }}
          itemContent={itemContent}
          computeItemKey={(_, m) => m.id}
          overscan={10}
          className="chat-session-virtuoso"
        />
        {typingUserIds.length > 0 && (
          <div className="chat-session-typing">
            <div className="typing-dots">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
            <span>正在输入...</span>
          </div>
        )}
      </div>

      <ChatSessionInput />
    </div>
  );
};
