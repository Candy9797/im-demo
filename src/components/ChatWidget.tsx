'use client';

/**
 * IM 入口：悬浮触发按钮、聊天窗口、钱包连接弹窗
 */
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chatStore';
import { ChatWindow, ChatTrigger } from './ChatWindow';
import { WalletConnect } from './WalletConnect';

export const ChatWidget = () => {
  // useShallow：浅比较，仅 showWalletModal 变化时更新（弹窗开关）
  const { showWalletModal, setShowWalletModal, initialize, rehydrateChatWindowState } = useChatStore(
    useShallow((s) => ({
      showWalletModal: s.showWalletModal,
      setShowWalletModal: s.setShowWalletModal,
      initialize: s.initialize,
      rehydrateChatWindowState: s.rehydrateChatWindowState,
    }))
  );

  // 挂载后从 sessionStorage 恢复聊天窗口开关状态，避免 SSR 与客户端 hydration 不一致
  useEffect(() => {
    rehydrateChatWindowState();
  }, [rehydrateChatWindowState]);

  const onWalletSuccess = () => {
    setShowWalletModal(false);
    initialize(); // initialize 内部会 set isOpen: true，无需再 toggleOpen（否则会关掉）
  };

  return (
    <>
      <ChatTrigger />
      <ChatWindow />
      {showWalletModal && (
        <WalletConnect onSuccess={onWalletSuccess} onClose={() => setShowWalletModal(false)} />
      )}
    </>
  );
};
