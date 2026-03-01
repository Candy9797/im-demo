'use client';

/**
 * 按住说话：Web Speech API 语音识别
 * - 支持 continuous + interimResults，松手后返回完整识别文本
 * - 浏览器需支持 SpeechRecognition（Chrome/Edge/Safari 等）
 */
import { useState, useRef, useCallback, useEffect } from 'react';

const SpeechRecognitionCtor =
  typeof window !== 'undefined'
    ? (window as unknown as { SpeechRecognition?: new () => SpeechRecognition; webkitSpeechRecognition?: new () => SpeechRecognition }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognition }).webkitSpeechRecognition
    : undefined;

export interface UseSpeechRecognitionOptions {
  /** 识别语言，默认 zh-CN */
  lang?: string;
  /** 是否返回中间结果（边说边出字） */
  interimResults?: boolean;
  /** 持续识别直到 stop（按住期间持续） */
  continuous?: boolean;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
}

export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}) {
  const {
    lang = 'zh-CN',
    interimResults = true,
    continuous = true,
    onResult,
    onEnd,
    onError,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const finalTranscriptRef = useRef<string[]>([]);

  /** 用户松手时调用：rec.stop() 结束识别并会触发 onresult（最终段）+ onend，在 onend 里再清理并回调 onEnd */
  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.stop(); // 用 stop 而非 abort，松手后能拿到识别结果；清理和 onEnd 由 rec.onend 统一处理
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      onEnd?.();
    }
  }, [onEnd]);

  /**
   * 开始语音识别（按住时调用）。
   * 创建 SpeechRecognition 实例、注册事件、调用 start()；成功返回 true，失败返回 false。
   */
  const start = useCallback(() => {
    // 浏览器不支持语音识别时直接报错并返回
    if (!SpeechRecognitionCtor) {
      setError('当前浏览器不支持语音识别');
      return false;
    }
    setError(null);
    // 清空本次按住期间的最终结果列表，供 getFinalTranscript 松手后拼接
    finalTranscriptRef.current = [];

    const rec = new SpeechRecognitionCtor();
    rec.continuous = continuous;   // true：单次 start→stop 间持续识别多段；false：说一句就停
    rec.interimResults = interimResults; // true：返回中间结果，用于「边说边出字」
    rec.lang = lang;               // 识别语言，如 zh-CN、en-US

    // 每次有识别结果时触发（可能包含多条：中间结果 + 最终结果）
    rec.onresult = (event: SpeechRecognitionEvent) => {
      let lastFinal = '';
      let lastInterim = '';
      // 从 resultIndex 开始遍历本次事件新增的结果，避免重复处理
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          // 最终结果：追加到 lastFinal，push 进 ref 供 getFinalTranscript 汇总，并回调 onResult(_, true)
          lastFinal += text;
          finalTranscriptRef.current.push(lastFinal);
          onResult?.(lastFinal, true);
        } else {
          // 中间结果：仅回调 onResult(_, false)，供 UI 展示「正在识别：xxx」，不写入 ref
          lastInterim = text;
          onResult?.(text, false);
        }
      }
    };

    // 识别会话结束（stop() 触发或异常结束）时统一清理并通知上层
    rec.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
      onEnd?.(); // 上层在此回调里调用 getFinalTranscript() 取完整文本并写入输入框
    };

    // 错误：未授权、无语音、网络等；清理状态并通知 onError / onEnd
    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      const msg = event.error === 'not-allowed' ? '未授权麦克风或已取消' : event.error;
      setError(String(msg));
      recognitionRef.current = null;
      setIsListening(false);
      onError?.(String(msg));
      onEnd?.();
    };

    try {
      rec.start(); // 开始识别，会请求麦克风权限（若未授权）
      recognitionRef.current = rec;
      setIsListening(true);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '启动失败');
      onError?.(e instanceof Error ? e.message : '启动失败');
      return false;
    }
  }, [lang, continuous, interimResults, onResult, onEnd, onError]);

  // 组件卸载时若仍在识别，立即 abort 终止（不等待最终结果），避免 onend 里操作已卸载的 state
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  /** 获取本次按住期间所有「最终」识别结果拼接成的文本 */
  const getFinalTranscript = useCallback(() => {
    return finalTranscriptRef.current.join('').trim();
  }, []);

  return {
    supported: !!SpeechRecognitionCtor,
    isListening,
    error,
    start,
    stop,
    getFinalTranscript,
  };
}
