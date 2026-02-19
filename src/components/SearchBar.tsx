'use client';

/**
 * 消息搜索：输入关键词搜索，展示匹配结果
 */

import React, { useState, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chatStore';
import { formatTime } from '@/utils/helpers';
import type { Message } from '@/sdk';

interface SearchBarProps {
  onClose?: () => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({ onClose }) => {
  // useShallow：浅比较，仅 searchMessages/clearSearch/searchResults 变化时更新；searchResults 变化即搜索完成
  const { searchMessages, clearSearch, searchResults } = useChatStore(
    useShallow((s) => ({
      searchMessages: s.searchMessages,
      clearSearch: s.clearSearch,
      searchResults: s.searchResults,
    }))
  );
  const [query, setQuery] = useState('');

  const handleSearch = useCallback(() => {
    if (!query.trim()) return;
    searchMessages(query.trim());
  }, [query, searchMessages]);

  const handleClose = useCallback(() => {
    clearSearch();
    setQuery('');
    onClose?.();
  }, [clearSearch, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
    if (e.key === 'Escape') handleClose();
  };

  return (
    <div className="search-bar">
      <div className="search-input-row">
        <input
          type="text"
          className="search-input"
          placeholder="Search messages..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Search messages"
        />
        <button
          className="search-btn"
          onClick={handleSearch}
          disabled={!query.trim()}
          title="Search"
          aria-label="Search"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        <button
            className="search-close-btn"
            onClick={handleClose}
            title="Close"
            aria-label="Close search"
          >
            ✕
          </button>
      </div>
      {searchResults !== null && (
        <div className="search-results">
          {searchResults.length === 0 ? (
            <div className="search-empty">No messages found</div>
          ) : (
            <ul className="search-result-list">
              {searchResults.map((msg: Message) => (
                <li key={msg.id} className="search-result-item">
                  <span className="search-result-sender">{msg.senderName}</span>
                  <span className="search-result-content">{msg.content?.slice(0, 80)}{(msg.content?.length ?? 0) > 80 ? '…' : ''}</span>
                  <span className="search-result-time">{formatTime(msg.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
