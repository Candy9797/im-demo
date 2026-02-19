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
import { ACCEPTED_FILE_TYPES, MAX_FILE_SIZE } from '@/utils/constants';

export const InputArea: React.FC = () => {
  // ---------- Store ----------
  // useShallow：仅 connectionState/scrollToInputRequest 变化时重渲染
  const { sendMessage, sendFile, sendSticker, connectionState, scrollToInputRequest } = useChatStore(
    useShallow((s) => ({
      sendMessage: s.sendMessage,
      sendFile: s.sendFile,
      sendSticker: s.sendSticker,
      connectionState: s.connectionState,
      scrollToInputRequest: s.scrollToInputRequest,
    }))
  );
  const lastScrollRequestRef = useRef(0);

  // ---------- 状态与 ref ----------
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showSticker, setShowSticker] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });
  const isConnected = connectionState === 'connected';

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

  // 点击回复时 scrollToInputRequest 更新，聚焦输入框
  useEffect(() => {
    if (scrollToInputRequest && scrollToInputRequest !== lastScrollRequestRef.current) {
      lastScrollRequestRef.current = scrollToInputRequest;
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [scrollToInputRequest]);

  // ---------- 交互 ----------
  const handleSend = useCallback(() => {
    if (!text.trim() || !isConnected) return;
    sendMessage(text);
    setText('');
    setShowEmoji(false);
    inputRef.current?.focus();
  }, [text, isConnected, sendMessage]);

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

        {/* 隐藏的 file input，accept 含 image/*、video/*、application/pdf */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES.join(',')}
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
      </div>

      {/* 文本输入 + 发送按钮 */}
      <div className="input-row">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isConnected ? 'Type a message...' : 'Connecting...'}
          disabled={!isConnected}
          rows={1}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={!text.trim() || !isConnected}
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
