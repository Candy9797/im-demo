'use client';

/**
 * AI 图片展示组件
 * 支持加载态、错误态、响应式
 */
import React, { useState } from 'react';

interface AIImageProps {
  src: string;
  alt?: string;
  title?: string;
}

export const AIImage = React.memo<AIImageProps>(function AIImage({ src, alt = '', title }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="ai-image ai-image-error">
        <span>图片加载失败</span>
      </div>
    );
  }

  return (
    <div className="ai-image-wrap">
      {!loaded && (
        <div className="ai-image-placeholder">加载中...</div>
      )}
      <img
        src={src}
        alt={alt}
        title={title}
        className={`ai-image ${loaded ? 'ai-image-loaded' : ''}`}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />
    </div>
  );
});
