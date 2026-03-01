'use client';

/**
 * 多人房间页：真实 WebSocket /ws-room，加入同一 roomId 的用户可互相收发消息
 * 不单独要求登录：有 auth 则直接用（如首页已访客/钱包登录），没有则进入房间时自动访客登录
 */
import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useChatStore } from '@/store/chatStore';
import { useChatRoomStore } from '@/store/chatRoomStore';

export default function ChatRoomPage() {
  const { auth, connectAsGuest } = useChatStore();
  const {
    roomId: currentRoomId,
    roomName,
    messages,
    members,
    connectionState,
    error,
    connect,
    disconnect,
    sendMessage,
    clearError,
  } = useChatRoomStore();

  const [roomIdInput, setRoomIdInput] = useState('general');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [joining, setJoining] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const handleJoin = async () => {
    clearError();
    let token = auth?.token;
    if (!token) {
      setJoining(true);
      const ok = await connectAsGuest();
      setJoining(false);
      if (!ok) return;
      token = useChatStore.getState().auth?.token;
    }
    if (!token) return;
    connect(token, roomIdInput.trim() || 'general', displayNameInput.trim() || undefined);
  };

  const handleSend = () => {
    if (!inputValue.trim()) return;
    sendMessage(inputValue);
    setInputValue('');
  };

  if (connectionState !== 'connected') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-zinc-950 text-zinc-100">
        <h1 className="text-xl font-semibold mb-4">进入多人房间</h1>
        {error && (
          <p className="text-red-400 text-sm mb-3 max-w-md text-center">{error}</p>
        )}
        <div className="flex flex-col gap-3 w-full max-w-sm">
          <input
            type="text"
            value={roomIdInput}
            onChange={(e) => setRoomIdInput(e.target.value)}
            placeholder="房间 ID（如 general）"
            className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-500"
          />
          <input
            type="text"
            value={displayNameInput}
            onChange={(e) => setDisplayNameInput(e.target.value)}
            placeholder="显示名称（可选）"
            className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-500"
          />
          <button
            type="button"
            onClick={() => handleJoin()}
            disabled={joining || connectionState === 'connecting'}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
          >
            {joining ? '准备中…' : connectionState === 'connecting' ? '连接中…' : '进入房间'}
          </button>
        </div>
        <Link href="/" className="mt-6 text-zinc-500 hover:text-zinc-300 text-sm">
          返回首页
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div>
          <h1 className="font-semibold">{roomName || currentRoomId}</h1>
          <p className="text-xs text-zinc-500">
            {members.length} 人在线 · 房间 {currentRoomId}
          </p>
        </div>
        <button
          type="button"
          onClick={disconnect}
          className="px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm"
        >
          离开房间
        </button>
      </header>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0"
      >
        {messages.length === 0 && (
          <p className="text-zinc-500 text-sm text-center py-4">暂无消息，发一条试试</p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className="flex flex-col max-w-[85%] rounded-lg px-3 py-2 bg-zinc-800/80"
          >
            <span className="text-xs text-emerald-400/90">{msg.senderName}</span>
            <span className="text-zinc-200 break-words">{msg.content}</span>
            <span className="text-xs text-zinc-500 mt-0.5">
              {new Date(msg.timestamp).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-zinc-800 flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="输入消息…"
          className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-500"
        />
        <button
          type="button"
          onClick={handleSend}
          className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500"
        >
          发送
        </button>
      </div>
    </div>
  );
}
