'use client';

/**
 * 历史页消息列表：独立于 chatStore，接收 messages 作为 prop，用于性能测试
 *
 * 性能策略（见 docs/抖音商城风格电商页面方案.md 五）：
 * - 虚拟化：Virtuoso 仅渲染可见区，OVERSCAN 为缓冲区条数
 */

import React, { useRef, useState, useCallback, useMemo } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { MessageItem } from '@/components/MessageItem';
import type { Message } from '@/sdk';

/** 性能策略：虚拟化缓冲区 */
const OVERSCAN = 8;

interface HistoryMessageListProps {
  messages: Message[];
  /** Hide reactions for performance testing */
  hideReactions?: boolean;
}

export const HistoryMessageList: React.FC<HistoryMessageListProps> = ({
  messages,
  hideReactions = true,
}) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const scrollToBottom = useCallback((smooth = true) => {
    virtuosoRef.current?.scrollToIndex({
      index: messages.length - 1,
      behavior: smooth ? 'smooth' : 'auto',
    });
    setShowScrollBtn(false);
  }, [messages.length]);

  const atBottomStateChange = useCallback((atBottom: boolean) => {
    setShowScrollBtn(!atBottom);
  }, []);

  const showAvatarMap = useMemo(() => {
    const map = new Map<number, boolean>();
    for (let i = 0; i < messages.length; i++) {
      if (i === 0) {
        map.set(i, true);
      } else {
        const prev = messages[i - 1];
        const curr = messages[i];
        map.set(
          i,
          prev.senderType !== curr.senderType || (curr.timestamp - prev.timestamp) > 60000
        );
      }
    }
    return map;
  }, [messages]);

  const itemContent = useCallback(
    (index: number, message: Message) => {
      const showAvatar = showAvatarMap.get(index) ?? true;
      return (
        <MessageItem
          message={message}
          showAvatar={showAvatar}
          showName={showAvatar}
          hideReactions={hideReactions}
          hideReply
        />
      );
    },
    [showAvatarMap, hideReactions]
  );

  const initialTopMostItemIndex = Math.max(0, messages.length - 1);

  const components = useMemo(
    () => ({
      List: React.forwardRef<HTMLDivElement, { children?: React.ReactNode; style?: React.CSSProperties }>(
        function List({ children, style, ...rest }, ref) {
          return (
            <div ref={ref} style={style} className="message-list-inner history-list-inner" {...rest}>
              {children}
            </div>
          );
        }
      ),
    }),
    []
  );

  return (
    <div className="history-message-list">
      <Virtuoso
        ref={virtuosoRef}
        style={{ height: '100%' }}
        data={messages}
        initialTopMostItemIndex={initialTopMostItemIndex}
        atBottomStateChange={atBottomStateChange}
        followOutput="smooth"
        itemContent={itemContent}
        computeItemKey={(_, msg) => msg.id}
        overscan={OVERSCAN}
        components={components}
        className="history-message-virtuoso"
      />
      {showScrollBtn && (
        <button
          className="scroll-to-bottom-btn"
          onClick={() => scrollToBottom()}
          aria-label="Scroll to bottom"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}
    </div>
  );
};
