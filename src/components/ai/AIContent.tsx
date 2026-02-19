'use client';

/**
 * AI 内容渲染器
 * 将 Markdown 内容解析并渲染：富文本、代码块、图片
 * 使用 ReactMarkdown + 自定义 code/img 组件
 */
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { AICodeBlock } from './AICodeBlock';
import { AIImage } from './AIImage';

interface AIContentProps {
  content: string;
  className?: string;
}

export const AIContent = React.memo<AIContentProps>(function AIContent({ content, className }) {
  return (
    <div className={`ai-content ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          p: ({ children }) => <p className="ai-rt-p">{children}</p>,
          strong: ({ children }) => <strong className="ai-rt-strong">{children}</strong>,
          em: ({ children }) => <em className="ai-rt-em">{children}</em>,
          s: ({ children }) => <s className="ai-rt-del">{children}</s>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="ai-rt-link">
              {children}
            </a>
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = className?.includes('language-');
            const codeStr = String(children).replace(/\n$/, '');
            if (isBlock) {
              return (
                <AICodeBlock code={codeStr} language={className ?? ''} />
              );
            }
            return (
              <code className="ai-rt-inline-code" {...props}>
                {children}
              </code>
            );
          },
          ul: ({ children }) => <ul className="ai-rt-ul">{children}</ul>,
          ol: ({ children }) => <ol className="ai-rt-ol">{children}</ol>,
          li: ({ children }) => <li className="ai-rt-li">{children}</li>,
          blockquote: ({ children }) => <blockquote className="ai-rt-blockquote">{children}</blockquote>,
          img: ({ src, alt, title }) =>
            src ? <AIImage src={src} alt={alt ?? ''} title={title ?? undefined} /> : null,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
