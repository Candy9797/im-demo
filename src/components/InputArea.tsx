'use client';

/**
 * InputArea - 客服 IM 输入区（ChatWindow 内，非 chat-session）
 *
 * ## 功能
 * - 文本输入、Enter 发送、Shift+Enter 换行
 * - 表情：插入 emoji 到输入框
 * - 贴纸：选择后直接发送
 * - 文件上传：图片/视频/PDF，通过 sendFile → IMClient 上传到 /api/upload，拿到服务端 URL 后发消息
 * - 引用回复：QuotePreview 展示被引用消息，发送时带 metadata.quote
 *
 * ## 图片/视频/PDF 上传位置
 * - 工具栏按钮：点击触发 fileInputRef.current?.click()
 * - 隐藏 file input：accept 为 ACCEPTED_FILE_TYPES（image/*、video/*、application/pdf）
 * - 处理逻辑：handleFileSelect → 校验大小(≤10MB)/类型 → sendFile(file)
 * - 上传实现：chatStore.sendFile → IMClient.sendFile → POST /api/upload
 *
 * ## 实现
 * - Emoji/Sticker Picker 用 createPortal 挂到 body，避免 overflow 裁剪
 * - Picker 用 position:fixed + bottom 定位在 anchor 上方
 */

import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chatStore';
import { EmojiPicker } from '@/components/EmojiPicker';
import { StickerPicker } from '@/components/StickerPicker';
import { QuotePreview } from '@/components/QuotePreview';
import { HoldToTalkButton } from '@/components/HoldToTalkButton';
import { TradeCardShareModal } from '@/components/TradeCardShareModal';
import { getDraft, setDraft, clearDraft } from '@/lib/draftStorage';
import { ACCEPTED_FILE_TYPES, MAX_FILE_SIZE } from '@/utils/constants';
import { ConnectionState } from '@/sdk';

const DRAFT_DEBOUNCE_MS = 500;
const DRAFT_ID_CUSTOMER_SERVICE = 'customer-service';

export const InputArea: React.FC = () => {
  // ---------- Store ----------
  // useShallow：仅 connectionState/scrollToInputRequest 变化时重渲染
  const { sendMessage, sendFile, sendSticker, sendTradeCard, connectionState, scrollToInputRequest } = useChatStore(
    useShallow((s) => ({
      sendMessage: s.sendMessage,
      sendFile: s.sendFile,
      sendSticker: s.sendSticker,
      sendTradeCard: s.sendTradeCard,
      connectionState: s.connectionState,
      scrollToInputRequest: s.scrollToInputRequest,
    }))
  );
  const lastScrollRequestRef = useRef(0);
  const textRef = useRef('');

  // ---------- 状态与 ref ----------
  const [text, setText] = useState('');
  const [voiceInterim, setVoiceInterim] = useState('');
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showSticker, setShowSticker] = useState(false);
  const [showTradeShare, setShowTradeShare] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });
  const isConnected = connectionState === ConnectionState.CONNECTED;

  // ---------- Picker 定位 ----------
  const updatePickerPosition = useCallback(() => {
    const el = anchorRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setPickerPosition({ top: rect.top - 8, left: rect.left });
    }
  }, []);

  // Picker 打开时立即更新位置
  useLayoutEffect(() => {
    if (!showSticker && !showEmoji) return;
    updatePickerPosition();
  }, [showSticker, showEmoji, updatePickerPosition]);

  // 窗口 resize 时同步 Picker 位置
  useEffect(() => {
    if (!showSticker && !showEmoji) return;
    window.addEventListener('resize', updatePickerPosition);
    return () => window.removeEventListener('resize', updatePickerPosition);
  }, [showSticker, showEmoji, updatePickerPosition]);

  // ---------- 草稿：与 ref 同步 ----------
  useEffect(() => {
    textRef.current = text;
  }, [text]);

  // ---------- 草稿：挂载时恢复未发送内容 ----------
  useEffect(() => {
    getDraft(DRAFT_ID_CUSTOMER_SERVICE).then((saved) => {
      if (saved && saved.trim()) {
        setText(saved);
        setRestoredFromDraft(true);
      }
    });
  }, []);

  // ---------- 草稿：防抖写入 IndexedDB ----------
  useEffect(() => {
    const t = setTimeout(() => {
      if (textRef.current.trim()) setDraft(DRAFT_ID_CUSTOMER_SERVICE, textRef.current);
      else clearDraft(DRAFT_ID_CUSTOMER_SERVICE);
    }, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  // 点击回复时 scrollToInputRequest 更新，聚焦输入框
  useEffect(() => {
    if (scrollToInputRequest && scrollToInputRequest !== lastScrollRequestRef.current) {
      lastScrollRequestRef.current = scrollToInputRequest;
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [scrollToInputRequest]);

  // ---------- 交互 ----------
  const handleSend = useCallback(() => {
    if (!text.trim()) return;
    // if (!isConnected) {
    //   const msg =
    //     connectionState === ConnectionState.CONNECTING ||
    //     connectionState === ConnectionState.RECONNECTING
    //       ? '连接中，请稍候'
    //       : '连接断开，请稍后再试';
    //   useChatStore.getState().showToast?.(msg);
    //   return;
    // }
    sendMessage(text);
    setText('');
    setShowEmoji(false);
    setRestoredFromDraft(false);
    clearDraft(DRAFT_ID_CUSTOMER_SERVICE);
    inputRef.current?.focus();
  }, [text, isConnected, connectionState, sendMessage]);

  // Enter 发送，Shift+Enter 换行
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 选中 emoji 追加到输入框
  const handleEmojiSelect = (emoji: string) => {
    setText((prev) => prev + emoji);
    inputRef.current?.focus();
  };

  // 图片/视频/PDF 选择：校验大小(≤10MB)、类型(ACCEPTED_FILE_TYPES) → sendFile → IMClient 上传
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      alert('File size exceeds 10MB limit');
      return;
    }

    if (!ACCEPTED_FILE_TYPES.includes(file.type)) {
      alert('Unsupported file type. Please upload images, videos or PDF.');
      return;
    }

    sendFile(file);
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 选中贴纸直接发送
  const handleStickerSelect = (stickerId: string) => {
    sendSticker(stickerId);
    setShowSticker(false);
  };

  // ---------- Picker Portal ----------
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
          <EmojiPicker
            onSelect={handleEmojiSelect}
            onClose={() => setShowEmoji(false)}
          />
        </div>,
        document.body
      );
    }
    if (showSticker) {
      return createPortal(
        <div style={style} className="picker-portal-wrap">
          <StickerPicker
            onSelect={handleStickerSelect}
            onClose={() => setShowSticker(false)}
          />
        </div>,
        document.body
      );
    }
    return null;
  };

  // ---------- 渲染 ----------
  return (
    <div ref={anchorRef} className="input-area">
      {renderPickerPortal()}

      <QuotePreview />

      <div className="input-toolbar">
        {/* 表情 / 贴纸 互斥 */}
        <button
          className={`toolbar-btn ${showEmoji ? 'active' : ''}`}
          onClick={() => { setShowEmoji(!showEmoji); setShowSticker(false); }}
          title="Emoji"
          aria-label="Open emoji picker"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
        </button>

        <button
          className={`toolbar-btn ${showSticker ? 'active' : ''}`}
          onClick={() => { setShowSticker(!showSticker); setShowEmoji(false); }}
          title="Sticker"
          aria-label="Open sticker picker"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="4" ry="4" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </button>
        {/* 图片/视频/PDF 上传：点击触发下方隐藏的 file input */}
        <button
          className="toolbar-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Upload file"
          aria-label="Upload image, video or PDF"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <button
          className="toolbar-btn"
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

        {/* 隐藏的 file input，accept 含 image/*、video/*、application/pdf */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES.join(',')}
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
      </div>
      <TradeCardShareModal
        open={showTradeShare}
        onClose={() => setShowTradeShare(false)}
        onShare={(payload) => { sendTradeCard(payload); setShowTradeShare(false); }}
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
      {/* 实时语音识别提示 */}
      {voiceInterim && (
        <div className="chat-session-voice-interim" role="status">
          <span className="chat-session-voice-interim-label">正在识别：</span>
          {voiceInterim}
        </div>
      )}
      {/* 文本输入 + 按住说话 + 发送按钮 */}
      <div className="input-row">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息，或按住麦克风说话..."
          rows={1}
        />
        <HoldToTalkButton
          lang="zh-CN"
          onResult={(voiceText) => {
            setText((prev) => (prev ? prev + voiceText : voiceText));
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
          onInterim={setVoiceInterim}
          onEnd={() => setVoiceInterim('')}
          holdTitle="按住说话"
          unsupportedTitle="当前浏览器不支持语音输入"
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={!text.trim()}
          aria-label="Send message"
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
