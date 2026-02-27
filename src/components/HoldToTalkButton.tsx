'use client';

/**
 * 按住说话：按下开始语音识别，松手结束并把识别文本通过 onResult 回传
 */
import React, { useCallback } from 'react';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';

export interface HoldToTalkButtonProps {
  /** 识别语言，如 zh-CN、en-US */
  lang?: string;
  /** 松手后回调，传入本次识别的完整文本 */
  onResult: (text: string) => void;
  /** 可选：识别中实时回调（中间结果），用于实时显示说的话 */
  onInterim?: (text: string) => void;
  /** 可选：识别结束（松手）时回调，用于清空实时显示 */
  onEnd?: () => void;
  /** 不支持时的提示 */
  unsupportedTitle?: string;
  /** 按住时的 title */
  holdTitle?: string;
  className?: string;
  disabled?: boolean;
}

export function HoldToTalkButton({
  lang = 'zh-CN',
  onResult,
  onInterim,
  onEnd: onEndProp,
  unsupportedTitle = '当前浏览器不支持语音输入',
  holdTitle = '按住说话',
  className = '',
  disabled = false,
}: HoldToTalkButtonProps) {
  const { supported, isListening, error, start, stop, getFinalTranscript } = useSpeechRecognition({
    lang,
    continuous: true,
    interimResults: true,
    onResult: (transcript, isFinal) => {
      if (!isFinal) onInterim?.(transcript);
    },
    onEnd: () => {
      const text = getFinalTranscript();
      if (text) onResult(text);
      onEndProp?.();
    },
  });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || !supported) return;
      e.preventDefault();
      start();
    },
    [disabled, supported, start]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      stop();
    },
    [stop]
  );

  const handlePointerLeave = useCallback(
    (e: React.PointerEvent) => {
      if (e.buttons === 1) stop();
    },
    [stop]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => e.preventDefault(), []);

  if (!supported) {
    return (
      <button
        type="button"
        className={`hold-to-talk-btn unsupported ${className}`.trim()}
        title={unsupportedTitle}
        disabled
        aria-label={unsupportedTitle}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`hold-to-talk-btn ${isListening ? 'listening' : ''} ${className}`.trim()}
      title={error ?? holdTitle}
      disabled={disabled}
      aria-label={holdTitle}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerUp}
      onContextMenu={handleContextMenu}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
      {error && <span className="hold-to-talk-error" role="status">{error}</span>}
    </button>
  );
}
