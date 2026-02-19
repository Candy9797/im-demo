/**
 * SIWE - Sign-In with Ethereum 客户端
 *
 * 钱包签名登录：getNonce → connectAndSign（MetaMask 签名）→ verifyAndGetToken
 * 使用 Next.js API 代理（同源），避免 CORS，与 demo 登录一致
 */
import { getAddress, BrowserProvider } from "ethers";
import { SiweMessage } from "siwe";

/** 向 Next.js API 代理请求 nonce（同源，无 CORS） */
export async function getNonce(address: string): Promise<string> {
  const res = await fetch(`/api/auth/nonce?address=${encodeURIComponent(address)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Failed to get nonce");
  }
  const { nonce } = await res.json();
  return nonce;
}

/** 连接钱包、构造 SIWE 消息、请求用户签名 */
export async function connectAndSign(): Promise<{ address: string; message: string; signature: string }> {
  const ethereum = (typeof window !== "undefined" && (window as unknown as { ethereum?: { request: (p: unknown) => Promise<string[]> } }).ethereum) || null;
  if (!ethereum) throw new Error("No wallet found. Please install MetaMask.");
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  const address = accounts[0];
  if (!address) throw new Error("No account selected");
  const nonce = await getNonce(address);
  const domain = typeof window !== "undefined" ? window.location.host : "localhost";
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  // EIP-55 checksum 必须，否则 SiweMessage.verify 会报 invalid EIP-55 address
  const checksumAddress = getAddress(address);

  const siweObj = {
    domain,
    address: checksumAddress,
    statement: "Sign in to IM Demo Support",
    uri: origin,
    version: "1",
    chainId: 1,
    nonce,
    issuedAt: new Date().toISOString(),
  };
  const siweMsg = new SiweMessage(siweObj);
  const messageToSign = siweMsg.prepareMessage();
  const provider = new BrowserProvider(ethereum);
  const signer = await provider.getSigner();
  const signature = await signer.signMessage(messageToSign);
  const message = JSON.stringify(siweObj);
  return { address, message, signature };
}

/** 提交 message + signature 到 Next.js API 代理校验，返回 JWT token */
export async function verifyAndGetToken(message: string, signature: string): Promise<{ token: string; userId: string; address: string }> {
  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Verification failed");
  }
  return res.json();
}

/** 一键钱包登录：connectAndSign + verifyAndGetToken */
export async function signInWithWallet(): Promise<{ token: string; userId: string; address: string }> {
  const { message, signature } = await connectAndSign();
  return verifyAndGetToken(message, signature);
}
