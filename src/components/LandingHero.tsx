'use client';

/**
 * 落地页主区域：Help & Support 按钮，点击打开聊天
 */

import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chatStore';

export const LandingHero = () => {
  // useShallow：selector 返回对象，浅比较避免每次 store 变化都重渲染；仅 isOpen/auth/authError 变化时更新
  const { isOpen, auth, authError, authConnecting, setShowWalletModal } = useChatStore(
    useShallow((s) => ({
      isOpen: s.isOpen,
      auth: s.auth,
      authError: s.authError,
      authConnecting: s.authConnecting,
      setShowWalletModal: s.setShowWalletModal,
    }))
  );

  const handleOpenChat = async (fresh = false) => {
    if (fresh && isOpen) {
      useChatStore.getState().destroy();
      useChatStore.getState().setWantFreshStart(true);
      useChatStore.getState().toggleOpen();
      useChatStore.getState().toggleOpen();
      return;
    }
    if (isOpen) return;
    if (!useChatStore.getState().auth) {
      const ok = await useChatStore.getState().connectAsGuest();
      if (!ok) return;
    }
    if (fresh) useChatStore.getState().setWantFreshStart(true);
    useChatStore.getState().toggleOpen();
  };

  return (
    <div className="landing-page">
      <div className="landing-content">
        <div className="landing-logo">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </div>
        <h1 className="landing-title">IM Demo</h1>
        <p className="landing-subtitle">
          Decentralized Trading Platform<br />
          Fast, Secure, Trustless
        </p>
        {authError && (
          <div className="landing-error" style={{ color: "#f6465d", fontSize: "13px", marginBottom: "0.5rem" }}>
            {authError}
          </div>
        )}
        <div className="landing-btns">
          <button
            className="landing-btn"
            onClick={() => handleOpenChat()}
            disabled={authConnecting}
          >
            {authConnecting ? (
              "连接中…"
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                访客进入
              </>
            )}
          </button>
          <button
            className="landing-btn landing-btn-outline"
            onClick={() => setShowWalletModal(true)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
              <path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z" />
            </svg>
            钱包登录
          </button>
        </div>
        <div className="landing-links">
          <a href="/shop" className="landing-link">淘宝商城</a>
          <a href="/ai" className="landing-link">AI 问答</a>
          <a href="/chat" className="landing-link">聊天（好友 / 群组）</a>
          <a href="/chat-room" className="landing-link">多人房间</a>
          <a href="/demo/ssr-traditional" className="landing-link">传统 SSR 演示</a>
          <a href="/demo/ssr-streaming" className="landing-link">流式 SSR 演示</a>
          <a href="/stream" className="landing-link">流式 SSR（Next.js）</a>
          <a href="http://127.0.0.1:3001/stream" className="landing-link" target="_blank" rel="noopener noreferrer">流式 SSR（Node）</a>
          <a href="/history" className="landing-history-link">会话历史 / 性能测试</a>
          <a href="/stress" className="landing-history-link">高 QPS 压测</a>
          <a href="/test-ws" className="landing-history-link">WS 联调测试</a>
        </div>
      </div>

      <div className="landing-features">
        <div className="feature-card" onClick={() => handleOpenChat(true)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && handleOpenChat(true)}>
          <div className="feature-icon">🤖</div>
          <div className="feature-title">Smart Assistant</div>
          <div className="feature-desc">Get instant answers to common questions 24/7</div>
        </div>
        <div className="feature-card" onClick={() => handleOpenChat(false)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && handleOpenChat(false)}>
          <div className="feature-icon">👨‍💼</div>
          <div className="feature-title">Human Support</div>
          <div className="feature-desc">Connect with live agents for complex issues</div>
        </div>
        <div className="feature-card" onClick={() => handleOpenChat(false)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && handleOpenChat(false)}>
          <div className="feature-icon">📎</div>
          <div className="feature-title">Rich Media</div>
          <div className="feature-desc">Share screenshots, documents and more</div>
        </div>
      </div>
    </div>
  );
};
