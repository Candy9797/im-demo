'use client';

/**
 * Emoji 选择器：网格布局，点击插入到输入框
 */

import React from 'react';
import { EMOJI_LIST } from '@/utils/constants';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelect, onClose }) => {
  return (
    <div className="emoji-picker" role="dialog" aria-label="Emoji picker">
      <div className="emoji-picker-header">
        <span>Emoji</span>
        <button className="emoji-close-btn" onClick={onClose} aria-label="Close emoji picker">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="emoji-grid">
        {EMOJI_LIST.map((emoji) => (
          <button
            key={emoji}
            className="emoji-item"
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
