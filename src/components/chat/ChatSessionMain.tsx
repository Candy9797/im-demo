'use client';

/**
 * 聊天主区域：消息列表（Virtuoso）+ 输入框
 * 展示当前选中会话的消息，支持虚拟化渲染
 */
import React, { useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useShallow } from 'zustand/react/shallow';
import { useChatSessionStore } from '@/store/chatSessionStore';
import { MessageItem } from '@/components/MessageItem';
import { ChatSessionInput } from '@/components/chat/ChatSessionInput';
import { CURRENT_USER_ID, getConversationKey } from '@/lib/chatSessionMock';
import type { Message } from '@/sdk';

export const ChatSessionMain: React.FC = () => {
  // useShallow：浅比较，仅 activeConversation/messagesByConv/typingByGroup/groups 变化时更新（切换会话、新消息、输入态）
  const { activeConversation, messagesByConv, typingByGroup, groups, editMessage, recallMessage, replyToMessage, addReaction, removeReaction } = useChatSessionStore(
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
    }))
  );

  const messages = useMemo(() => {
    if (!activeConversation) return [];
    const key = activeConversation.type === 'c2c'
      ? getConversationKey('c2c', activeConversation.id)
      : activeConversation.id;
    const raw = messagesByConv[key] ?? [];
    return [...raw].sort((a, b) => (a.seqId ?? a.timestamp) - (b.seqId ?? b.timestamp));
  }, [activeConversation, messagesByConv]);
  const typingUserIds = activeConversation?.type === 'group'
    ? (typingByGroup[activeConversation.id] ?? [])
    : [];

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
      </div>

      <div className="chat-session-messages">
        <Virtuoso
          style={{ height: '100%' }}
          data={messages}
          initialTopMostItemIndex={Math.max(0, messages.length - 1)}
          followOutput="smooth"
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
