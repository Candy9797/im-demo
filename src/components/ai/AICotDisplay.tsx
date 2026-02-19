'use client';

/**
 * 高性能实时思维链（Chain of Thought）展示
 *
 * 优化点：
 * - 纯文本渲染，无 Markdown 解析开销
 * - useDeferredValue 降低流式更新对主线程的影响
 * - 流式结束后可折叠，节省空间
 */
import React, { useState, useDeferredValue, useCallback } from 'react';

interface AICotDisplayProps {
  /** 思维链内容，流式追加 */
  thought: string;
  /** 是否仍在流式输出 */
  isStreaming?: boolean;
  /** 折叠时的最大预览行数 */
  collapsedLines?: number;
}

export const AICotDisplay = React.memo<AICotDisplayProps>(function AICotDisplay({
  thought,
  isStreaming = false,
  collapsedLines = 3,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const deferredThought = useDeferredValue(thought);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  if (!deferredThought && !isStreaming) return null;

  const lines = (deferredThought || '').split('\n');
  const hasMore = lines.length > collapsedLines;
  const displayLines = collapsed && !isStreaming && hasMore
    ? lines.slice(0, collapsedLines)
    : lines;
  const displayText = displayLines.join('\n');

  return (
    <div className="ai-cot-wrap">
      <div className="ai-cot-header" onClick={hasMore ? toggleCollapsed : undefined}>
        <span className="ai-cot-icon">💭</span>
        <span className="ai-cot-title">思维链</span>
        {isStreaming && <span className="ai-cot-badge ai-cot-badge-streaming">输出中</span>}
        {hasMore && !isStreaming && (
          <span className="ai-cot-toggle">
            {collapsed ? '展开' : '收起'}
          </span>
        )}
      </div>
      <div
        className={`ai-cot-content ${collapsed ? 'ai-cot-collapsed' : ''}`}
        style={collapsed ? { ['--ai-cot-collapsed-lines' as string]: collapsedLines } : undefined}
      >
        <pre className="ai-cot-text">{displayText}</pre>
      </div>
    </div>
  );
});
