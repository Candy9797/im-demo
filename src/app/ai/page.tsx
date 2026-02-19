'use client';

/**
 * AI 问答页
 * SSE 流式响应，支持富文本、代码块、图片展示
 * 优化：rAF 批处理更新、useDeferredValue 降低渲染压力
 */
import React, { useState, useRef, useCallback, useEffect, useDeferredValue } from 'react';
import Link from 'next/link';
import { AIContent, AICotDisplay } from '@/components/ai';

/** 流式时用 useDeferredValue 降低 Markdown 解析对主线程的阻塞 */
function DeferredAIContent({ content }: { content: string }) {
  const deferred = useDeferredValue(content);
  return <AIContent content={deferred} />;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 思维链内容，流式追加 */
  thought?: string;
  isStreaming?: boolean;
}

export default function AIPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, []);

  // 流式时节流滚动，避免每次 chunk 都触发 layout
  const lastScrollRef = useRef(0);
  useEffect(() => {
    const now = Date.now();
    if (now - lastScrollRef.current < 50) return;
    lastScrollRef.current = now;
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', isStreaming: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setIsLoading(true);

    abortRef.current = new AbortController();

    // 批处理：thought/answer 分别累积，rAF 合并为单次 setState
    const pendingThought = { current: '' };
    const pendingAnswer = { current: '' };
    let rafScheduled = false;
    const flushPending = () => {
      rafScheduled = false;
      const toAddThought = pendingThought.current;
      const toAddAnswer = pendingAnswer.current;
      pendingThought.current = '';
      pendingAnswer.current = '';
      if (!toAddThought && !toAddAnswer) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId) return m;
          return {
            ...m,
            thought: (m.thought ?? '') + toAddThought,
            content: m.content + toAddAnswer,
          };
        })
      );
    };
    const scheduleFlush = () => {
      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(flushPending);
      }
    };

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data) as { type?: string; content?: string };
                const content = parsed.content ?? '';
                if (!content || content === '[DONE]') continue;
                if (parsed.type === 'thought') {
                  pendingThought.current += content;
                } else {
                  pendingAnswer.current += content;
                }
                scheduleFlush();
              } catch {
                // 兼容旧格式 { content }
                const parsed = JSON.parse(data) as { content?: string };
                const content = parsed.content ?? '';
                if (content) {
                  pendingAnswer.current += content;
                  scheduleFlush();
                }
              }
            }
          }
        }
      }

      // 结束前同步 flush 未写入的 chunk
      const finalThought = pendingThought.current;
      const finalAnswer = pendingAnswer.current;
      pendingThought.current = '';
      pendingAnswer.current = '';
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId) return m;
          return {
            ...m,
            thought: (m.thought ?? '') + finalThought,
            content: m.content + finalAnswer,
            isStreaming: false,
          };
        })
      );
    } catch (e) {
      const err = e instanceof Error ? e.message : '请求失败';
      const finalThought = pendingThought.current;
      const finalAnswer = pendingAnswer.current;
      pendingThought.current = '';
      pendingAnswer.current = '';
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId) return m;
          const content = (m.content + finalAnswer) || `[Error: ${err}]`;
          return {
            ...m,
            thought: (m.thought ?? '') + finalThought,
            content,
            isStreaming: false,
          };
        })
      );
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [input, isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const suggestions = ['展示效果', 'hello', '展示一段代码', 'image', 'markdown 示例'];

  return (
    <div className="ai-page">
      <div className="ai-page-bg" aria-hidden />

      <header className="ai-header">
        <Link href="/" className="ai-back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          返回
        </Link>
        <div className="ai-header-content">
          <div className="ai-header-icon">✨</div>
          <div>
            <h1 className="ai-title">AI 问答</h1>
            <span className="ai-subtitle">流式响应 · 支持代码、富文本、图片</span>
          </div>
        </div>
      </header>

      <div className="ai-main">
        <div className="ai-list" ref={listRef}>
          {messages.length === 0 && (
            <div className="ai-empty">
              <div className="ai-empty-icon">💬</div>
              <h2 className="ai-empty-title">开始对话</h2>
              <p className="ai-empty-desc">输入问题，AI 将流式回复</p>
              <div className="ai-empty-suggestions">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="ai-suggestion-chip"
                    onClick={() => setInput(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={m.id}
              className={`ai-message ai-message-${m.role}`}
              style={{ animationDelay: `${Math.min(i, 5) * 15}ms` }}
            >
              <div className={`ai-message-avatar ai-avatar-${m.role}`}>
                {m.role === 'user' ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
                  </svg>
                )}
              </div>
              <div className="ai-message-body">
                {m.role === 'user' ? (
                  <div className="ai-message-text">{m.content}</div>
                ) : (
                  <>
                    {((m.thought ?? '') || m.isStreaming) && (
                      <AICotDisplay thought={m.thought ?? ''} isStreaming={m.isStreaming} />
                    )}
                    <DeferredAIContent content={m.content} />
                    {m.isStreaming && (
                      <span className="ai-cursor" aria-hidden>▋</span>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="ai-input-wrap">
          <textarea
            className="ai-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，按 Enter 发送..."
            rows={2}
            disabled={isLoading}
          />
          <button
            type="button"
            className="ai-send"
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            title="发送"
          >
            {isLoading ? (
              <span className="ai-send-loading">
                <span className="ai-send-dot" />
                <span className="ai-send-dot" />
                <span className="ai-send-dot" />
              </span>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
