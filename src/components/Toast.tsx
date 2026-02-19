'use client';

/**
 * 轻量 Toast：展示临时提示（如撤回失败、操作错误）
 */
import React, { useEffect } from 'react';
import { useChatStore } from '@/store/chatStore';

const TOAST_DURATION_MS = 3000;

export const Toast: React.FC = () => {
  const toast = useChatStore((s) => s.toast);
  const clearToast = useChatStore((s) => s.clearToast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clearToast, TOAST_DURATION_MS);
    return () => clearTimeout(t);
  }, [toast, clearToast]);

  if (!toast) return null;

  return (
    <div className="chat-toast" role="alert">
      {toast}
    </div>
  );
};
