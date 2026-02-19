/**
 * SIWE authentication & JWT
 */
import jwt from "jsonwebtoken";
import { SiweMessage } from "siwe";
import { consumeNonce, ensureUser } from "./db";

const JWT_SECRET = process.env.JWT_SECRET || "web3-im-dev-secret-change-in-production";
const JWT_EXPIRES = "24h";

export async function verifySiweAndIssueToken(
  message: string,
  signature: string
): Promise<{ userId: string; address: string; token: string } | null> {
  let parsed: { nonce?: string; address?: string };
  try {
    parsed = JSON.parse(message) as { nonce?: string; address?: string };
  } catch {
    return null;
  }
  const address = consumeNonce(parsed.nonce ?? "");
  if (!address || !parsed.address || parsed.address.toLowerCase() !== address.toLowerCase()) return null;

  try {
    const siweMessage = new SiweMessage(parsed);
    const result = await siweMessage.verify({ signature });
    if (!result.success) return null;
  } catch {
    return null;
  }

  const userId = ensureUser(address);
  const token = jwt.sign({ userId, address }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  return { userId, address, token };
}

export function verifyToken(token: string): { userId: string; address: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; address: string };
    return decoded;
  } catch {
    return null;
  }
}

export function createToken(userId: string, address: string): string {
  return jwt.sign({ userId, address }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function createDemoAuth(): { userId: string; address: string; token: string } {
  const address = `0x${Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
  const userId = ensureUser(address);
  const token = createToken(userId, address);
  return { userId, address, token };
}
