'use client';

/**
 * 在线状态指示：显示当前在线用户数量
 */

import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chatStore';

export const PresenceIndicator: React.FC = () => {
  // useShallow：浅比较，仅 onlineUsers/auth 变化时更新（在线人数、登录态变更）
  const { onlineUsers, auth } = useChatStore(
    useShallow((s) => ({ onlineUsers: s.onlineUsers, auth: s.auth }))
  );
  const userId = auth?.userId;
  const others = onlineUsers.filter((id) => id !== userId);
  const count = others.length;

  if (count === 0) return null;

  return (
    <span className="presence-indicator" title={`${count} online`}>
      <span className="presence-dot" />
      <span className="presence-text">
        {count} {count === 1 ? 'user' : 'users'} online
      </span>
    </span>
  );
};
