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

  const start = useCallback(() => {
    if (!SpeechRecognitionCtor) {
      setError('当前浏览器不支持语音识别');
      return false;
    }
    setError(null);
    finalTranscriptRef.current = [];

    const rec = new SpeechRecognitionCtor();
    rec.continuous = continuous;
    rec.interimResults = interimResults;
    rec.lang = lang;

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let lastFinal = '';
      let lastInterim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          lastFinal += text;
          finalTranscriptRef.current.push(lastFinal);
          onResult?.(lastFinal, true);
        } else {
          lastInterim = text;
          onResult?.(text, false);
        }
      }
    };

    rec.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
      onEnd?.();
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      const msg = event.error === 'not-allowed' ? '未授权麦克风或已取消' : event.error;
      setError(String(msg));
      recognitionRef.current = null;
      setIsListening(false);
      onError?.(String(msg));
      onEnd?.();
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      setIsListening(true);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '启动失败');
      onError?.(e instanceof Error ? e.message : '启动失败');
      return false;
    }
  }, [lang, continuous, interimResults, onResult, onEnd, onError]);

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
