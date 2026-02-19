'use client';

/**
 * AI 代码块展示组件
 * 支持语言标签、复制按钮
 */
import React, { useState } from 'react';

interface AICodeBlockProps {
  code: string;
  language?: string;
}

export const AICodeBlock = React.memo<AICodeBlockProps>(function AICodeBlock({ code, language = '' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const lang = language?.replace(/^language-/, '') || '';

  return (
    <div className="ai-code-block">
      <div className="ai-code-block-header">
        {lang && <span className="ai-code-block-lang">{lang}</span>}
        <button
          type="button"
          className="ai-code-block-copy"
          onClick={handleCopy}
          aria-label="Copy code"
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="ai-code-block-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
});
