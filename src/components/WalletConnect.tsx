"use client";

/**
 * 钱包连接弹窗：SIWE 签名登录，成功后关闭并初始化 IM
 */
import React, { useState } from "react";
import { useChatStore } from "@/store/chatStore";

interface WalletConnectProps {
  onSuccess: () => void;
  onClose?: () => void;
}

export const WalletConnect: React.FC<WalletConnectProps> = ({ onSuccess, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const ok = await useChatStore.getState().connectWallet();
      if (ok) onSuccess();
      else setError(useChatStore.getState().authError || "Connection failed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="wallet-connect-overlay">
      <div className="wallet-connect-modal">
        <h3>Connect Wallet</h3>
        <p>Sign in with your wallet to access support chat</p>
        <p className="wallet-network-warning">⚠️ Make sure to select the correct network to avoid loss of funds.</p>
        {error && <div className="wallet-error">{error}</div>}
        <button
          className="landing-btn"
          onClick={handleConnect}
          disabled={loading}
          style={{ marginTop: "1rem", width: "100%" }}
        >
          {loading ? "Connecting..." : "Connect MetaMask"}
        </button>
        {onClose && (
          <button className="wallet-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>
    </div>
  );
};

