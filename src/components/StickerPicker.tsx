'use client';

/**
 * 贴纸选择器：网格展示，点击发送贴纸消息
 */

import React from 'react';
import { STICKER_LIST } from '@/utils/constants';

interface StickerPickerProps {
  onSelect: (stickerId: string) => void;
  onClose: () => void;
}

export const StickerPicker: React.FC<StickerPickerProps> = ({ onSelect, onClose }) => {
  return (
    <div className="sticker-picker" role="dialog" aria-label="Sticker picker">
      <div className="sticker-picker-header">
        <span>Stickers</span>
        <button className="sticker-close-btn" onClick={onClose} aria-label="Close sticker picker">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="sticker-grid">
        {STICKER_LIST.map((emoji) => (
          <button
            key={emoji}
            className="sticker-item"
            onClick={() => {
              onSelect(emoji);
              onClose();
            }}
            title={emoji}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
};
