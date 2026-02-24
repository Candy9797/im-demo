'use client';

/**
 * 消息列表：Virtuoso 虚拟化、顶部加载更多、新消息自动滚底、回到底部按钮
 *
 * 性能策略（见 docs/抖音商城风格电商页面方案.md 五）：
 * - 虚拟化：Virtuoso 仅渲染可见区，OVERSCAN 为上下缓冲区条数
 *
 * ## Virtuoso「在底部才滚底、看历史不打扰」的实现
 * 用户停留在底部时新消息平滑滚到底；用户在看历史（不在底部）时不自动滚动，减少无效滚动和重排。
 * 关键依赖两个 API：
 * 1. **followOutput**：`(isAtBottom) => isAtBottom ? 'smooth' : false`
 *    - Virtuoso 在列表末尾追加新项时会调用该函数，传入当前是否在底部。
 *    - 返回 'smooth' 时会对齐到底部并平滑滚动；返回 false 时不滚动。
 *    - 因此：在底部 → 新消息来 → 平滑滚底；不在底部 → 不滚，用户继续看历史。
 *    - 原理（更细）：
 *      (1) 「是否在底部」判定：Virtuoso 用滚动容器的 scrollTop、scrollHeight、clientHeight 计算——
 *          若 (scrollTop + clientHeight) 接近 scrollHeight（或在一个小阈值内），则认为 atBottom 为 true；
 *          用户向上翻看历史时 scrollTop 变小，就不满足，atBottom 为 false。
 *      (2) 调用时机：当我们的 data（messages）长度增加（新消息 push）导致 React 重渲染，Virtuoso 发现
 *          列表末尾多了项；它在内部先完成新项的占位/布局（可能先渲染到 DOM），然后调用 followOutput(当前是否在底部)。
 *      (3) 根据返回值行为：若返回 'smooth' 或 'auto'，Virtuoso 会执行一次滚动到底部（类似 scrollTo 最后一项），
 *          使视口紧跟新内容；若返回 false，不做任何滚动，视口保持原位置，用户看到的仍是之前的消息区域。
 *      (4) 效果：只有用户本来就在底部时 isAtBottom 为 true，才会在收到新消息时自动滚底；用户在看历史时
 *          isAtBottom 为 false，返回 false 不滚动，避免被新消息“拽下去”，减少无效滚动和重排。
 * 2. **atBottomStateChange**：`(atBottom) => { ... }`
 *    - 当用户滚动导致「是否在底部」变化时回调，用于更新「回到底部」按钮显隐和 isAtBottomRef。
 *    - 与 followOutput 配合：Virtuoso 内部用同一套「是否在底部」状态决定 followOutput 的 isAtBottom 参数。
 */

import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chatStore';
import { MessageItem } from '@/components/MessageItem';
import { TypingIndicator } from '@/components/TypingIndicator';
import type { Message } from '@/sdk';

/** 视口外多渲染条数，减少快速滚动时白屏（性能策略：虚拟化缓冲区） */
const OVERSCAN = 5;

/** 已读批量上报：收集间隔（ms） */
const MARK_READ_DEBOUNCE_MS = 200;
/** 已读批量上报：单次最大条数，达到即立即上报 */
const MARK_READ_BATCH_SIZE = 20;

export const MessageList: React.FC = () => {
  // useShallow 浅比较：仅 messages/hasMoreHistory/scrollToInputRequest 等选中字段变化时重渲染
  // scrollToInputRequest：时间戳信号，replyToMessage 时更新，MessageList 滚底、InputArea 聚焦；用 ref 去重避免重复滚动
  // recallMessage：撤回消息，仅本人可撤，已同步服务端；超时则回滚并 Toast 提示
  const { messages: rawMessages, loadMoreHistory, hasMoreHistory, markAsRead, scrollToInputRequest, editMessage, recallMessage } = useChatStore(
    useShallow((s) => ({
      messages: s.messages,
      loadMoreHistory: s.loadMoreHistory,
      hasMoreHistory: s.hasMoreHistory,
      markAsRead: s.markAsRead,
      scrollToInputRequest: s.scrollToInputRequest,
      editMessage: s.editMessage,
      recallMessage: s.recallMessage,
    }))
  );
  /** 保证始终为数组，避免 rehydration 未完成或异常时 data 为 undefined 导致 Virtuoso 报错 */
  const messages = Array.isArray(rawMessages) ? rawMessages : [];
  const lastScrollRequestRef = useRef(0); // 已处理的 scrollToInputRequest，避免重复滚动
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const pendingReadRef = useRef<Set<string>>(new Set());
  const flushReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false); // 是否显示「回到底部」按钮
  const isAtBottomRef = useRef(true); // 是否在底部，供外部逻辑判断

  const scrollToBottom = useCallback((smooth = true) => {
    virtuosoRef.current?.scrollToIndex({
      index: messages.length - 1,
      behavior: smooth ? 'smooth' : 'auto',
    });
    isAtBottomRef.current = true;
    setShowScrollBtn(false);
  }, [messages.length]);

  /**
   * 关键 API 2/2：atBottomStateChange(atBottom)
   * 用户滚动导致「是否在底部」变化时调用，用于显隐「回到底部」按钮并同步 isAtBottomRef。
   */
  const atBottomStateChange = useCallback((atBottom: boolean) => {
    isAtBottomRef.current = atBottom;
    setShowScrollBtn(!atBottom);
  }, []);

  /** 滚动到顶部时加载更多历史消息 */
  const atTopStateChange = useCallback((atTop: boolean) => {
    if (atTop && hasMoreHistory) loadMoreHistory();
  }, [hasMoreHistory, loadMoreHistory]);

  /**
   * 关键 API 1/2：followOutput(isAtBottom)
   * 列表末尾追加新消息时 Virtuoso 会调用此函数。仅在 isAtBottom 为 true 时返回 'smooth' 才会自动滚底；
   * 用户在看历史（isAtBottom 为 false）时返回 false，不滚动，避免打扰。
   */
  const followOutput = useCallback((isAtBottom: boolean) => {
    return isAtBottom ? 'smooth' : false;
  }, []);

  /** 每条消息是否显示头像：首条必显；换人或时间差 >60s 时显，同人连续消息折叠 */
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

  /**
   * 批量上报已读：将 pendingReadRef 中收集的 messageId 一次性发送给服务端。
   * 会取消未执行的 debounce 定时器，清空 pending 队列。
   */
  const flushMarkAsRead = useCallback(() => {
    if (flushReadTimerRef.current) {
      clearTimeout(flushReadTimerRef.current);
      flushReadTimerRef.current = null;
    }
    const ids = Array.from(pendingReadRef.current);
    pendingReadRef.current.clear();
    if (ids.length > 0) markAsRead(ids);
  }, [markAsRead]);

  /**
   * 消息进入视口时回调（由 MessageItem IntersectionObserver 触发）。
   * 将 messageId 加入待上报队列，满足以下任一条件即批量 flush：
   * 1. 队列已达 MARK_READ_BATCH_SIZE 条 → 立即上报；
   * 2. 否则启动/续期 debounce 定时器，MARK_READ_DEBOUNCE_MS 后上报。
   */
  const onMessageVisible = useCallback(
    (messageId: string) => {
      pendingReadRef.current.add(messageId);
      if (pendingReadRef.current.size >= MARK_READ_BATCH_SIZE) {
        flushMarkAsRead();
        return;
      }
      if (!flushReadTimerRef.current) {
        flushReadTimerRef.current = setTimeout(flushMarkAsRead, MARK_READ_DEBOUNCE_MS);
      }
    },
    [flushMarkAsRead]
  );

  /**
   * 组件卸载时 flush 尚未上报的已读消息，避免漏报。
   * 使用 ref 保持最新 flushMarkAsRead，避免 effect 依赖变化导致 cleanup 重复执行引发栈溢出。
   */
  const flushRef = useRef(flushMarkAsRead);
  flushRef.current = flushMarkAsRead;
  useEffect(() => () => flushRef.current(), []);

  /** 响应 scrollToInputRequest：replyToMessage 等触发时 store 更新时间戳，此处滚到底部，ref 记录已处理避免重复 */
  useEffect(() => {
    if (scrollToInputRequest && scrollToInputRequest !== lastScrollRequestRef.current) {
      lastScrollRequestRef.current = scrollToInputRequest;
      virtuosoRef.current?.scrollToIndex({
        index: messages.length - 1,
        behavior: 'smooth',
      });
    }
  }, [scrollToInputRequest, messages.length]);

  /** Virtuoso 单条渲染：根据 showAvatarMap 控制头像/昵称，并注入 onVisible/onEdit/onRecall */
  const itemContent = useCallback(
    (index: number, message: Message) => {
      if (!message) return null;
      const showAvatar = showAvatarMap.get(index) ?? true;
      return (
        <MessageItem
          message={message}
          showAvatar={showAvatar}
          showName={showAvatar}
          onVisible={onMessageVisible}
          onEdit={(m, content) => editMessage(m.id, content)}
          onRecall={(m) => recallMessage(m.id)}
        />
      );
    },
    [showAvatarMap, onMessageVisible, editMessage, recallMessage]
  );

  /** 初始顶部可见索引：进入会话时从底部（最新消息）开始 */
  const initialTopMostItemIndex = Math.max(0, messages.length - 1);

  /** 自定义 List 容器 + Footer（打字指示器） */
  const components = useMemo(
    () => ({
      List: React.forwardRef<HTMLDivElement, { children?: React.ReactNode; style?: React.CSSProperties }>(
        function List({ children, style, ...rest }, ref) {
          return (
            <div ref={ref} style={style} className="message-list-inner" {...rest}>
              {children}
            </div>
          );
        }
      ),
      Footer: () => (
        <div className="message-list-footer">
          <TypingIndicator />
        </div>
      ),
    }),
    []
  );

  return (
    <div className="message-list message-list-virtualized">
      <Virtuoso
        ref={virtuosoRef}
        style={{ height: '100%', minHeight: 0 }}
        data={messages}
        initialTopMostItemIndex={initialTopMostItemIndex} // 进入会话时滚到底部
        followOutput={followOutput} // 关键 API1：在底部才滚底，看历史不自动滚动
        atBottomStateChange={atBottomStateChange} // 关键 API2：底部状态变化 → 回到底部按钮显隐
        atTopStateChange={atTopStateChange} // 向上滚动到顶时加载更多历史
        itemContent={itemContent} // 渲染 MessageItem，并传入 showAvatar、onVisible 等
        computeItemKey={(i, msg) => msg?.id ?? `msg-${i}`}
        overscan={OVERSCAN} // 视口外多渲染 5 条，减少白屏
        components={components} // 自定义列表容器和底部打字指示器
        className="message-list-virtuoso"
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
