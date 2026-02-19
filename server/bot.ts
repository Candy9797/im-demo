/**
 * Bot responses and agent simulation
 */
import type { Message } from "../src/sdk/types";

export const FAQ_ITEMS = [
  { id: "faq-1", question: "How to deposit crypto?", answer: "To deposit crypto:\n1. Go to **Wallet** → **Deposit**\n2. Select the token and network\n3. Copy the deposit address\n\n⚠️ Make sure to select the *correct network* to avoid loss of funds.", category: "Wallet", icon: "💰" },
  { id: "faq-2", question: "How to reset 2FA?", answer: "To reset 2FA, go to Security Settings → Two-Factor Authentication → Reset. You will need to complete identity verification. The process takes 24-48 hours for security reasons.", category: "Security", icon: "🔐" },
  { id: "faq-3", question: "Why is my withdrawal pending?", answer: "Withdrawals may be pending due to: 1) Network congestion 2) Security review for large amounts 3) Incomplete KYC verification. Most withdrawals complete within 30 minutes.", category: "Wallet", icon: "⏳" },
  { id: "faq-4", question: "How to enable Futures trading?", answer: "To enable Futures trading: 1) Complete identity verification 2) Go to Derivatives → Futures 3) Pass the quiz 4) Fund your Futures wallet. Please note leveraged trading involves significant risk.", category: "Trading", icon: "📈" },
  { id: "faq-5", question: "KYC verification failed, what to do?", answer: "If KYC verification failed: 1) Ensure document photos are clear and unobstructed 2) Check that your name matches exactly 3) Try using a different document type. If issues persist, please contact human support.", category: "Account", icon: "🪪" },
  { id: "faq-6", question: "Transfer to human support", answer: "", category: "Support", icon: "👤" },
];

const AGENT_RESPONSES = [
  "I understand your concern. Let me look into this for you.",
  "Thank you for providing that information. I'm checking our system now.",
  "I can see the issue on our end. Let me help you resolve this.",
  "For security purposes, could you please verify your account email?",
  "I've escalated this to our specialist team. You should receive an update within 24 hours.",
  "Is there anything else I can help you with today?",
  "I've applied the fix to your account. Please try again in a few minutes.",
  "That's a great question. Let me explain how this works...",
];

export function getBotReply(userContent: string): string | null {
  const content = userContent.toLowerCase();
  if (content.includes("deposit") || content.includes("充值")) return FAQ_ITEMS[0].answer;
  if (content.includes("2fa") || content.includes("security")) return FAQ_ITEMS[1].answer;
  if (content.includes("withdraw") || content.includes("提现")) return FAQ_ITEMS[2].answer;
  if (content.includes("human") || content.includes("agent") || content.includes("人工")) return null; // trigger agent
  return "I'm not sure I understand. Please select from the common questions above, or type 'agent' to connect with a human representative.";
}

export function getRandomAgentResponse(): string {
  return AGENT_RESPONSES[Math.floor(Math.random() * AGENT_RESPONSES.length)];
}

export function createBotMessage(id: string, convId: string, content: string): Omit<Message, "status"> & { status: string } {
  return {
    id,
    conversationId: convId,
    content,
    type: "text",
    status: "delivered",
    senderType: "bot",
    senderId: "bot-1",
    senderName: "Smart Assistant",
    timestamp: Date.now(),
  };
}

export function createAgentMessage(
  id: string,
  convId: string,
  content: string,
  agentId: string,
  agentName: string
): Omit<Message, "status"> & { status: string } {
  return {
    id,
    conversationId: convId,
    content,
    type: "text",
    status: "delivered",
    senderType: "agent",
    senderId: agentId,
    senderName: agentName,
    timestamp: Date.now(),
  };
}
