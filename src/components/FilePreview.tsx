'use client';

/**
 * 文件预览：图片（缩略图 + 点击放大）、PDF（文件名和大小）
 *
 * 滚动防闪：图片容器预留宽高比、加载前占位、decoding="async"，减少虚拟列表滚动时白屏/闪动。
 */

import React, { useState } from 'react';
import { type Message, MessageType } from '@/sdk';
import { formatFileSize } from '@/utils/helpers';

interface FilePreviewProps {
  message: Message;
}

export const FilePreview: React.FC<FilePreviewProps> = ({ message }) => {
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  if (message.type === MessageType.IMAGE) {
    return (
      <>
        <div
          className="file-preview image-preview"
          onClick={() => setIsLightboxOpen(true)}
          style={{ aspectRatio: '4/3', minHeight: 80, maxWidth: 220, position: 'relative', backgroundColor: 'var(--tb-bg-secondary, #1e2329)' }}
        >
          {!imageLoaded && (
            <div
              className="image-preview-placeholder"
              style={{ position: 'absolute', inset: 0, background: 'var(--tb-bg-secondary, #1e2329)' }}
              aria-hidden
            />
          )}
          <img
            src={message.content}
            alt="Shared image"
            loading="lazy"
            decoding="async"
            onLoad={() => setImageLoaded(true)}
            onError={(e) => {
              (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect fill="%231e2329" width="120" height="80"/><text x="60" y="45" fill="%23848e9c" text-anchor="middle" font-size="12">Image</text></svg>';
              setImageLoaded(true);
            }}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              opacity: imageLoaded ? 1 : 0,
              transition: 'opacity 0.15s ease-out',
            }}
          />
        </div>
        {isLightboxOpen && (
          <div className="lightbox" onClick={() => setIsLightboxOpen(false)}>
            <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
              <button className="lightbox-close" onClick={() => setIsLightboxOpen(false)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <img src={message.content} alt="Full size" />
            </div>
          </div>
        )}
      </>
    );
  }

  if (message.type === MessageType.VIDEO) {
    const videoUrl = message.content || (message.metadata?.videoUrl as string);
    if (!videoUrl) return null;
    return (
      <div className="file-preview video-preview">
        <video
          src={videoUrl}
          controls
          playsInline
          preload="metadata"
          className="msg-video-player"
        >
          Your browser does not support the video tag.
        </video>
      </div>
    );
  }

  if (message.type === MessageType.PDF) {
    const fileName = (message.metadata?.fileName as string) || 'document.pdf';
    const fileSize = (message.metadata?.fileSize as number) || 0;

    return (
      <div className="file-preview pdf-preview">
        <div className="pdf-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        </div>
        <div className="pdf-info">
          <span className="pdf-name">{fileName}</span>
          {fileSize > 0 && <span className="pdf-size">{formatFileSize(fileSize)}</span>}
        </div>
      </div>
    );
  }

  return null;
};
