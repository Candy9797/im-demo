'use client';

/**
 * ChatSessionInput - 会话页面输入区（chat-session 路由用，非客服 IM）
 *
 * ## 功能
 * - 文本输入、Enter 发送、Shift+Enter 换行
 * - 表情：插入 emoji 到输入框
 * - 表情包：选择后直接发送
 * - 图片/视频上传
 *
 * ## 实现
 * - EmojiPicker/StickerPicker 用 createPortal 挂到 body，避免 overflow 裁剪
 * - Picker 用 position:fixed + bottom 定位在 anchor 上方，resize 时同步位置
 */
import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { useChatSessionStore } from '@/store/chatSessionStore';
import { EmojiPicker } from '@/components/EmojiPicker';
import { StickerPicker } from '@/components/StickerPicker';
import { ChatSessionQuotePreview } from '@/components/chat/ChatSessionQuotePreview';
import { HoldToTalkButton } from '@/components/HoldToTalkButton';
import { TradeCardShareModal } from '@/components/TradeCardShareModal';
import { getDraft, setDraft, clearDraft } from '@/lib/draftStorage';
import {
  ACCEPTED_IMAGE_TYPES,
  ACCEPTED_VIDEO_TYPES,
  MAX_FILE_SIZE,
} from '@/utils/constants';
import { CURRENT_USER_ID } from '@/lib/chatSessionMock';

const DRAFT_DEBOUNCE_MS = 500;
const TYPING_DEBOUNCE_MS = 2000; // 停止输入后多久清除「正在输入」

export const ChatSessionInput: React.FC = () => {
  // ---------- Store ----------
  // useShallow：仅 activeConversation 变化时重渲染（切换会话）；actions 引用稳定
  // 引用相同（例如切到同一个会话，或 store 没变）：不会重渲染。
  // 引用不同（例如切换会话，store 换了一个新对象）：会触发重渲染。
  // useShallow 检测到引用变化，组件就会重渲染。
  const { activeConversation, sendMessage, sendImage, sendVideo, sendSticker, sendTradeCard, scrollToInputRequest, setTyping } =
    useChatSessionStore(
      useShallow((s) => ({
        activeConversation: s.activeConversation,
        sendMessage: s.sendMessage,
        sendImage: s.sendImage,
        sendVideo: s.sendVideo,
        sendSticker: s.sendSticker,
        sendTradeCard: s.sendTradeCard,
        scrollToInputRequest: s.scrollToInputRequest,
        setTyping: s.setTyping,
      }))
    );

  const lastScrollRequestRef = useRef(0);
  const inputTextRef = useRef('');
  const prevDraftIdRef = useRef<string | null>(null);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draftId = activeConversation ? `chat:${activeConversation.id}` : null;

  // ---------- 状态与 ref ----------
  const [inputText, setInputText] = useState('');
  const [voiceInterim, setVoiceInterim] = useState('');
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showSticker, setShowSticker] = useState(false);
  const [showTradeShare, setShowTradeShare] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null); // Picker 锚点，Portal 基于此定位
  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });

  // ---------- Picker 定位 ----------
  // 根据 anchorRef 的 getBoundingClientRect 计算 Picker 位置，rect.top - 8 留出间距
  const updatePickerPosition = useCallback(() => {
    const el = anchorRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setPickerPosition({ top: rect.top - 8, left: rect.left });
    }
  }, []);

  /**
   * 为何用 useLayoutEffect 而非 useEffect？
   * - useLayoutEffect 在 DOM 更新后、浏览器绘制前**同步**执行
   * - 打开 Emoji/Sticker Picker 时，Picker 依赖 pickerPosition 渲染；若用 useEffect，位置计算在绘制之后才跑，
   *   首帧会先用旧的 (0,0) 渲染，再下一帧才跳到正确位置，出现闪烁
   * - useLayoutEffect 确保在首帧绘制前就更新 pickerPosition，Picker 一次到位，无闪烁
   */
  useLayoutEffect(() => {
    if (!showSticker && !showEmoji) return;
    updatePickerPosition();
  }, [showSticker, showEmoji, updatePickerPosition]);

  // 窗口 resize 时同步 Picker 位置；不依赖首帧时序，用 useEffect 即可
  useEffect(() => {
    if (!showSticker && !showEmoji) return;
    window.addEventListener('resize', updatePickerPosition);
    return () => window.removeEventListener('resize', updatePickerPosition);
  }, [showSticker, showEmoji, updatePickerPosition]);

  // 点击回复时：scrollToInputRequest 更新，聚焦输入框
  useEffect(() => {
    if (scrollToInputRequest && scrollToInputRequest !== lastScrollRequestRef.current) {
      lastScrollRequestRef.current = scrollToInputRequest;
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [scrollToInputRequest]);

  // 正在输入：输入时上报，防抖 2s 后清除（Mock：本方输入时模拟对方/群内「正在输入」）
  const reportTyping = useCallback(
    (isTyping: boolean) => {
      if (!activeConversation) return;
      if (activeConversation.type === 'c2c') {
        setTyping(activeConversation.id, isTyping);
      } else {
        setTyping(CURRENT_USER_ID, isTyping, activeConversation.id);
      }
    },
    [activeConversation, setTyping]
  );

  const scheduleTypingStop = useCallback(() => {
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = setTimeout(() => {
      typingStopTimerRef.current = null;
      reportTyping(false);
    }, TYPING_DEBOUNCE_MS);
  }, [reportTyping]);

  // ---------- 草稿：与 ref 同步 ----------
  useEffect(() => {
    inputTextRef.current = inputText;
  }, [inputText]);

  // 切换会话或卸载时清除「正在输入」定时器，避免在错误会话上清除
  useEffect(() => {
    return () => {
      if (typingStopTimerRef.current) {
        clearTimeout(typingStopTimerRef.current);
        typingStopTimerRef.current = null;
      }
    };
  }, [draftId]);

  // ---------- 草稿：切换会话时保存旧会话、加载新会话草稿 ----------
  useEffect(() => {
    if (!draftId) {
      prevDraftIdRef.current = null;
      return;
    }
    const prevId = prevDraftIdRef.current;
    prevDraftIdRef.current = draftId;
    if (prevId && prevId !== draftId && inputTextRef.current) {
      setDraft(prevId, inputTextRef.current);
    }
    getDraft(draftId).then((text) => {
      setInputText(text ?? '');
      setRestoredFromDraft(!!(text && text.trim()));
    });
  }, [draftId]);

  // ---------- 草稿：防抖写入 IndexedDB ----------
  useEffect(() => {
    if (!draftId) return;
    const t = setTimeout(() => {
      const text = inputTextRef.current;
      if (text.trim()) setDraft(draftId, text);
      else clearDraft(draftId);
    }, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draftId, inputText]);

  // ---------- 交互 ----------
  const handleSend = useCallback(() => {
    if (!inputText.trim()) return;
    if (typingStopTimerRef.current) {
      clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }
    reportTyping(false);
    sendMessage(inputText.trim());
    setInputText('');
    setShowEmoji(false);
    setRestoredFromDraft(false);
    if (draftId) clearDraft(draftId);
    inputRef.current?.focus();
  }, [inputText, sendMessage, draftId, reportTyping]);

  // Enter 发送，Shift+Enter 换行（不阻止默认即换行）
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 选中 emoji：追加到输入框并聚焦
  const handleEmojiSelect = (emoji: string) => {
    setInputText((prev) => prev + emoji);
    inputRef.current?.focus();
  };

  // 选中表情包：直接发送，关闭 Picker
  const handleStickerSelect = (stickerId: string) => {
    sendSticker(stickerId);
    setShowSticker(false);
  };

  // 图片选择：校验大小/类型后发送，清空 input.value 以便重复选同一文件
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      alert('文件大小不能超过 10MB');
      return;
    }
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      alert('请上传图片格式：JPEG、PNG、GIF、WebP');
      return;
    }
    sendImage(file);
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  // 视频选择：校验大小/类型后发送，清空 input.value
  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      alert('文件大小不能超过 10MB');
      return;
    }
    if (!ACCEPTED_VIDEO_TYPES.includes(file.type)) {
      alert('请上传视频格式：MP4、WebM');
      return;
    }
    sendVideo(file);
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  // ---------- Picker Portal ----------
  // 用 createPortal 挂到 body，position:fixed，bottom = 视口高度 - anchor.top 实现「在 anchor 上方」
  const renderPickerPortal = () => {
    if (typeof document === 'undefined') return null;
    const style: React.CSSProperties = {
      position: 'fixed',
      bottom: typeof window !== 'undefined' ? window.innerHeight - pickerPosition.top : 0,
      left: pickerPosition.left,
      zIndex: 10010,
    };
    if (showEmoji) {
      return createPortal(
        <div style={style} className="picker-portal-wrap">
          <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmoji(false)} />
        </div>,
        document.body
      );
    }
    if (showSticker) {
      return createPortal(
        <div style={style} className="picker-portal-wrap">
          <StickerPicker onSelect={handleStickerSelect} onClose={() => setShowSticker(false)} />
        </div>,
        document.body
      );
    }
    return null;
  };

  if (!activeConversation) return null;

  const canSend = !!inputText.trim();

  // ---------- 渲染 ----------
  return (
    <div ref={anchorRef} className="chat-session-input-wrap">
      <ChatSessionQuotePreview />
      {renderPickerPortal()}

      <div className="chat-session-toolbar">
        {/* 表情 / 表情包 互斥，点击一个会关闭另一个 */}
        <button
          className={`chat-toolbar-btn ${showEmoji ? 'active' : ''}`}
          onClick={() => {
            setShowEmoji(!showEmoji);
            setShowSticker(false);
          }}
          title="表情"
          aria-label="表情"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
        </button>
        {/* 表情包按钮 */}
        <button
          className={`chat-toolbar-btn ${showSticker ? 'active' : ''}`}
          onClick={() => {
            setShowSticker(!showSticker);
            setShowEmoji(false);
          }}
          title="表情包"
          aria-label="表情包"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="4" ry="4" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </button>
        <button
          className="chat-toolbar-btn"
          onClick={() => imageInputRef.current?.click()}
          title="上传图片"
          aria-label="上传图片"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </button>
        <button
          className="chat-toolbar-btn"
          onClick={() => videoInputRef.current?.click()}
          title="上传视频"
          aria-label="上传视频"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </button>
        <button
          className="chat-toolbar-btn"
          onClick={() => { setShowEmoji(false); setShowSticker(false); setShowTradeShare(true); }}
          title="分享交易卡片"
          aria-label="分享交易卡片"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="4" width="20" height="14" rx="2" ry="2" />
            <path d="M2 10h20" />
            <path d="M6 14h4" />
          </svg>
        </button>
      </div>
      <TradeCardShareModal
        open={showTradeShare}
        onClose={() => setShowTradeShare(false)}
        onShare={(payload) => sendTradeCard(payload)}
      />

      {/* 隐藏的 file input，通过 toolbar 按钮 click 触发 */}
      <input
        ref={imageInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        onChange={handleImageSelect}
        style={{ display: 'none' }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept={ACCEPTED_VIDEO_TYPES.join(',')}
        onChange={handleVideoSelect}
        style={{ display: 'none' }}
      />

      {/* 已恢复未发送内容提示 */}
      {restoredFromDraft && (
        <div className="draft-restored-banner" role="status">
          <span>已恢复未发送内容，可继续编辑或发送</span>
          <button type="button" className="draft-restored-dismiss" onClick={() => setRestoredFromDraft(false)} aria-label="关闭">
            ×
          </button>
        </div>
      )}
      {/* 实时语音识别提示：按住说话时显示 */}
      {voiceInterim && (
        <div className="chat-session-voice-interim" role="status">
          <span className="chat-session-voice-interim-label">正在识别：</span>
          {voiceInterim}
        </div>
      )}
      {/* 文本输入 + 按住说话 + 发送按钮 */}
      <div className="chat-session-input-row">
        <textarea
          ref={inputRef}
          className="chat-input chat-session-input"
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value);
            reportTyping(true);
            scheduleTypingStop();
          }}
          onKeyDown={handleKeyDown}
          placeholder="输入消息，或按住右侧麦克风说话..."
          rows={1}
        />
        <HoldToTalkButton
          lang="zh-CN"
          onResult={(text) => {
            setInputText((prev) => (prev ? prev + text : text));
            reportTyping(true);
            scheduleTypingStop();
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
          onInterim={setVoiceInterim}
          onEnd={() => setVoiceInterim('')}
          holdTitle="按住说话"
          unsupportedTitle="当前浏览器不支持语音输入"
          className="chat-session-voice-btn"
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="发送"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
};
