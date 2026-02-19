'use client';

/**
 * 消息反应（Reactions）组件
 *
 * ## 功能
 * - 展示消息上已有的 emoji 反应（如 👍❤️😂），点击可添加/移除自己的反应
 * - 无反应时：仅显示「🙂」添加按钮，点击打开 Picker
 * - 有反应时：显示 reaction-chip 列表（emoji + 人数）+「+」添加按钮，点击 chip 可切换自己是否已点
 *
 * ## 实现要点
 * - Picker 用 createPortal 渲染到 document.body，避免被消息列表 overflow 裁剪
 * - Picker 用 position:fixed + bottom 定位在 anchor 上方，滚动时通过 scroll 监听同步位置
 * Portal 是 React 提供的机制：把组件渲染到指定 DOM 节点，而不是当前父组件所在的 DOM 树里。
 */

import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chatStore';
import type { MessageMetadata } from '@/sdk';

interface MessageReactionsProps {
  messageId: string;
  metadata?: MessageMetadata;
  isUserMessage?: boolean;
  /** 传入则用自定义实现（如 chatSessionStore），否则用 chatStore */
  addReaction?: (messageId: string, emoji: string) => void;
  removeReaction?: (messageId: string, emoji: string) => void;
  userId?: string;
}

/** 快捷反应 emoji 列表，Picker 中按此顺序展示 */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

export const MessageReactions: React.FC<MessageReactionsProps> = ({
  messageId,
  metadata,
  addReaction: addReactionProp,
  removeReaction: removeReactionProp,
  userId: userIdProp,
}) => {
  // ---------- 状态与 ref ----------
  const [showPicker, setShowPicker] = useState(false); // Picker 显隐
  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 }); // Picker 定位（基于视口）
  const anchorRef = useRef<HTMLDivElement>(null); // 锚点元素，Picker 在其上方展示

  // ---------- Store / Props ----------
  // 传入 addReaction/removeReaction/userId 则用自定义（chatSession）；否则用 chatStore
  const { addReaction: chatAddReaction, removeReaction: chatRemoveReaction, auth } = useChatStore(
    useShallow((s) => ({
      addReaction: s.addReaction,
      removeReaction: s.removeReaction,
      auth: s.auth,
    }))
  );
  const addReaction = addReactionProp ?? chatAddReaction;
  const removeReaction = removeReactionProp ?? chatRemoveReaction;
  const userId = userIdProp ?? auth?.userId;
  // metadata.reactions 结构：{ '👍': ['uid1','uid2'], '❤️': ['uid1'] }，key 为 emoji，value 为点过该 emoji 的用户 id 数组
  const reactions = metadata?.reactions ?? {};

  // ---------- Picker 定位 ----------
  // 根据 anchorRef 的 getBoundingClientRect 更新 pickerPosition，Picker 用 fixed + bottom 贴在 anchor 上方
  const updatePosition = useCallback(() => {
    const el = anchorRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setPickerPosition({ top: rect.top, left: rect.left });
    }
  }, []);

  // Picker 打开时：同步布局阶段立即更新位置，避免首次渲染时位置错误导致闪烁
  useLayoutEffect(() => {
    if (showPicker) updatePosition();
  }, [showPicker, updatePosition]);

  // 页面/列表滚动时：Picker 需要跟随 anchor 移动，addEventListener 第三个参数 true 表示 capture 阶段，可捕获嵌套 scroll 容器内的滚动
  useEffect(() => {
    if (!showPicker) return;
    window.addEventListener('scroll', updatePosition, true);
    return () => window.removeEventListener('scroll', updatePosition, true);
  }, [showPicker, updatePosition]);

  // ---------- 交互 ----------
  // 点击某个 emoji：若当前用户已点过则 removeReaction，否则 addReaction；点击后关闭 Picker
  const handleReactionClick = (emoji: string) => {
    if (!userId) return;
    const users = reactions[emoji] ?? [];
    if (users.includes(userId)) {
      removeReaction(messageId, emoji);
    } else {
      addReaction(messageId, emoji);
    }
    setShowPicker(false);
  };

  // 过滤掉 users 为空的 emoji，仅渲染有人点过的 reaction
  const reactionEntries = Object.entries(reactions).filter(([, users]) => users.length > 0);

  // ---------- Picker 渲染 ----------
  // 用 createPortal 把 Picker 挂到 body，避免被消息气泡/列表的 overflow 裁剪；style 用 bottom = 视口高度 - anchor.top 实现「在 anchor 上方」定位
  const renderPickerPortal = () => {
    if (!showPicker || typeof document === 'undefined') return null;
    const style: React.CSSProperties = {
      position: 'fixed',
      bottom: typeof window !== 'undefined' ? window.innerHeight - pickerPosition.top : 0,
      left: pickerPosition.left,
      zIndex: 10010,
    };
    return createPortal(
      <div style={style} className="reaction-picker-portal">
        <div className="reaction-picker">
          {QUICK_REACTIONS.map((emoji) => {
            const users = reactions[emoji] ?? [];
            const isMine = userId && users.includes(userId);
            return (
              <button
                key={emoji}
                className={`reaction-picker-item ${isMine ? 'reaction-mine' : ''}`}
                onClick={() => handleReactionClick(emoji)}
              >
                {emoji}
              </button>
            );
          })}
          {/* 关闭按钮：不选任何反应，仅关闭 Picker */}
          <button
            className="reaction-picker-more"
            onClick={() => setShowPicker(false)}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>,
      document.body
    );
  };

  // ---------- 渲染分支 ----------
  // 分支 1：无任何反应时，只显示添加按钮（🙂），点击打开 Picker
  if (reactionEntries.length === 0) {
    return (
      <div ref={anchorRef} className="message-reactions">
        <button
          className="reaction-add-btn"
          onClick={() => setShowPicker(true)}
          title="Add reaction"
          aria-label="Add reaction"
        >
          <span className="reaction-add-icon">🙂</span>
        </button>
        {renderPickerPortal()}
      </div>
    );
  }

  // 分支 2：有反应时，显示 reaction-chip 列表（emoji + 人数，自己点过的加 reaction-mine 样式）+ 添加按钮（+）+ Picker
  return (
    <div ref={anchorRef} className="message-reactions">
      <div className="reaction-list">
        {reactionEntries.map(([emoji, users]) => {
          const count = users.length; // 该 emoji 被多少人点过
          const isMine = userId && users.includes(userId); // 当前用户是否点过，用于高亮样式
          return (
            <button
              key={emoji}
              className={`reaction-chip ${isMine ? 'reaction-mine' : ''}`}
              onClick={() => handleReactionClick(emoji)}
              title={`${emoji} ${count}`}
            >
              <span>{emoji}</span>
              {count > 1 && <span className="reaction-count">{count}</span>}
            </button>
          );
        })}
      </div>
      <button
        className="reaction-add-btn"
        onClick={() => setShowPicker(!showPicker)}
        title="Add reaction"
        aria-label="Add reaction"
      >
        <span className="reaction-add-icon">+</span>
      </button>
      {renderPickerPortal()}
    </div>
  );
};
