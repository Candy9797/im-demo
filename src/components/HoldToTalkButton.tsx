'use client';

/**
 * 按住说话按钮
 *
 * 按下时开始语音识别（useSpeechRecognition.start），松手或指针移出时结束（stop），
 * 在 Hook 的 onEnd 里通过 getFinalTranscript() 取完整文本并回传 onResult；
 * 识别中的中间结果通过 onInterim 回传，用于 UI 展示「正在识别：xxx」。
 */
import React, { useCallback } from 'react';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';

/** 按住说话按钮的 props */
export interface HoldToTalkButtonProps {
  /** 识别语言，如 zh-CN、en-US */
  lang?: string;
  /** 松手后回调，传入本次识别的完整文本（由 getFinalTranscript 汇总） */
  onResult: (text: string) => void;
  /** 可选：识别中实时回调（中间结果），用于实时显示「正在识别：xxx」 */
  onInterim?: (text: string) => void;
  /** 可选：识别结束（松手）时回调，用于清空「正在识别」等 UI */
  onEnd?: () => void;
  /** 浏览器不支持语音识别时按钮的 title / 提示文案 */
  unsupportedTitle?: string;
  /** 按住时的 title；有 error 时优先显示 error */
  holdTitle?: string;
  className?: string;
  /** 为 true 时按钮禁用，不响应按下 */
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
    continuous: true,   // 按住期间持续识别多段
    interimResults: true, // 返回中间结果，供 onInterim 实时展示
    onResult: (transcript, isFinal) => {
      // 仅中间结果转给 onInterim；最终结果由 Hook 内部写入 ref，松手后在 onEnd 里用 getFinalTranscript 取
      if (!isFinal) onInterim?.(transcript);
    },
    onEnd: () => {
      // 松手后在此取完整文本并回传；再调用父级 onEnd 清空「正在识别」等
      const text = getFinalTranscript();
      if (text) onResult(text);
      onEndProp?.();
    },
  });

  /** 按下：在支持且未禁用时开始识别 */
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || !supported) return;
      e.preventDefault();
      start();
    },
    [disabled, supported, start]
  );

  /** 松手：结束识别，Hook 的 onend 里会调 onEnd，进而 getFinalTranscript + onResult */
  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      stop();
    },
    [stop]
  );

  /** 指针移出按钮且仍按住（buttons === 1）时也结束识别，避免拖出后一直录 */
  const handlePointerLeave = useCallback(
    (e: React.PointerEvent) => {
      if (e.buttons === 1) stop();
    },
    [stop]
  );

  /** 禁止右键菜单，避免与「按住」手势冲突 */
  const handleContextMenu = useCallback((e: React.MouseEvent) => e.preventDefault(), []);

  // 浏览器不支持语音识别时渲染禁用态按钮
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

  // 支持时：按下 start、松手/移出 stop，录音中加 listening 类名，有 error 时展示
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
