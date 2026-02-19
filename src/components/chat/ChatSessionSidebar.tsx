'use client';

/**
 * 聊天侧边栏 - 会话列表与切换
 *
 * ## 功能
 * - 展示好友列表、群组列表
 * - 点击切换当前会话（activeConversation），主区域显示对应消息
 * - 显示在线状态、最后一条消息预览、未读数
 *
 * ## 结构
 * - 顶部：返回首页链接 + 标题「聊天」
 * - 好友区：头像（首字 + 在线绿点）+ 名称 + 预览（lastMessagePreview 或 在线/离线）+ 未读角标（>99 显示 99+）
 * - 群组区：群头像（# 前缀）+ 名称 + 预览（lastMessagePreview 或 人数）+ 未读角标
 *
 * ## Store 依赖
 * - selectFriend / selectGroup：切换 activeConversation，主区域 ChatSessionMain 据此拉取 messagesByConv
 * - friends / groups：Mock 数据，含 lastMessagePreview、unreadCount、online
 */
import React from 'react';
import Link from 'next/link';
import { useShallow } from 'zustand/react/shallow';
import { useChatSessionStore } from '@/store/chatSessionStore';
import type { Friend, Group } from '@/lib/chatSessionMock';

export const ChatSessionSidebar: React.FC = () => {
  // useShallow：仅 friends/groups/activeConversation 变化时重渲染
  const { friends, groups, activeConversation, selectFriend, selectGroup } = useChatSessionStore(
    useShallow((s) => ({
      friends: s.friends,
      groups: s.groups,
      activeConversation: s.activeConversation,
      selectFriend: s.selectFriend,
      selectGroup: s.selectGroup,
    }))
  );

  return (
    <aside className="chat-session-sidebar">
      <div className="chat-session-sidebar-header">
        <Link href="/" className="chat-session-back">← 返回</Link>
        <h2 className="chat-session-title">聊天</h2>
      </div>

      <div className="chat-session-tabs">
        <div className="chat-session-tab-content">
          <div className="chat-session-section">
            <div className="chat-session-section-title">好友</div>
            <ul className="chat-session-list">
              {friends.map((f) => {
                const isActive = activeConversation?.type === 'c2c' && activeConversation?.id === f.id; // 当前选中该好友
                return (
                  <li key={f.id}>
                    <button
                      className={`chat-session-item ${isActive ? 'active' : ''}`}
                      onClick={() => selectFriend(f)}
                    >
                      <span className="chat-session-item-avatar">
                        {f.online && <span className="chat-session-online-dot" />}
                        {(f.name || '?').charAt(0)}
                      </span>
                      <span className="chat-session-item-body">
                        <span className="chat-session-item-name">{f.name}</span>
                        <span className="chat-session-item-preview">
                          {f.lastMessagePreview || (f.online ? '在线' : '离线')}
                        </span>
                      </span>
                      {f.unreadCount > 0 && (
                        <span className="chat-session-unread">{f.unreadCount > 99 ? '99+' : f.unreadCount}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="chat-session-section">
            <div className="chat-session-section-title">群组</div>
            <ul className="chat-session-list">
              {groups.map((g) => {
                const isActive = activeConversation?.type === 'group' && activeConversation?.id === g.id; // 当前选中该群
                return (
                  <li key={g.id}>
                    <button
                      className={`chat-session-item ${isActive ? 'active' : ''}`}
                      onClick={() => selectGroup(g)}
                    >
                      <span className="chat-session-item-avatar group-avatar">
                        #{(g.name || 'G').charAt(0)}
                      </span>
                      <span className="chat-session-item-body">
                        <span className="chat-session-item-name">{g.name}</span>
                        <span className="chat-session-item-preview">
                          {g.lastMessagePreview || `${g.memberCount} 人`}
                        </span>
                      </span>
                      {g.unreadCount > 0 && (
                        <span className="chat-session-unread">{g.unreadCount > 99 ? '99+' : g.unreadCount}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </aside>
  );
};
