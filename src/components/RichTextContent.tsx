'use client';

/**
 * 富文本消息渲染：react-markdown + remark-gfm + remark-breaks
 * 支持粗体、斜体、删除线、链接（新标签打开）、行内/代码块、列表、换行
 */

import React from 'react';
import ReactMarkdown from 'react-markdown'; // 将 Markdown 字符串解析为 React 组件树
import remarkGfm from 'remark-gfm'; // GitHub 风格扩展：表格、删除线、任务列表、autolink 等
import remarkBreaks from 'remark-breaks'; // 单换行符变为 <br>，兼容「回车即换行」习惯

interface RichTextContentProps {
  content: string;
  className?: string;
}

export const RichTextContent = React.memo<RichTextContentProps>(function RichTextContent({ content, className }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          p: ({ children }) => <p className="rt-p">{children}</p>,
          strong: ({ children }) => <strong className="rt-strong">{children}</strong>,
          em: ({ children }) => <em className="rt-em">{children}</em>,
          s: ({ children }) => <s className="rt-del">{children}</s>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="rt-link"
            >
              {children}
            </a>
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = className?.includes('language-');
            if (isBlock) {
              return (
                <pre className="rt-pre">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              );
            }
            return (
              <code className="rt-inline-code" {...props}>
                {children}
              </code>
            );
          },
          ul: ({ children }) => <ul className="rt-ul">{children}</ul>,
          ol: ({ children }) => <ol className="rt-ol">{children}</ol>,
          li: ({ children }) => <li className="rt-li">{children}</li>,
          blockquote: ({ children }) => <blockquote className="rt-blockquote">{children}</blockquote>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
