# 认证技术方案：SIWE 钱包签名 + 访客模式 JWT

> 用于 Web3 IM 客服系统的身份认证，支持「钱包登录」和「无钱包访客」两种方式。

---

## 一、概览

| 认证方式 | 触发场景 | 流程 | Token 来源 |
|----------|----------|------|------------|
| **SIWE 钱包签名** | 用户点击「Connect Wallet」 | getNonce → 钱包签名 → verify → JWT | 服务端校验签名后签发 |
| **访客模式** | 用户点击「Continue as Guest」 | GET /api/auth/demo | 服务端直接签发临时 JWT |

两种方式的 JWT 格式相同（payload 含 `userId`、`address`），后续 WebSocket、HTTP API 的鉴权逻辑完全一致。

---

## 二、SIWE（Sign-In with Ethereum）

### 2.1 背景

SIWE 是 EIP-4361 标准，用于「用钱包签名证明身份」，无需密码、不暴露私钥。用户用 MetaMask 等钱包对一条结构化消息签名，服务端用公钥恢复地址，验证签名有效即认为用户拥有该地址。

### 2.2 流程

```
┌─────────┐                    ┌─────────┐                    ┌─────────┐
│ 前端    │                    │ 服务端   │                    │ 钱包     │
└────┬────┘                    └────┬────┘                    └────┬────┘
     │ 1. GET /api/auth/nonce?address=0x...                        │
     │────────────────────────────►│                               │
     │                             │ createNonce(address)          │
     │                             │ → 生成 nonce，写入 nonces 表   │
     │ 2. { nonce }                │ 5min 过期                     │
     │◄────────────────────────────│                               │
     │ 3. eth_requestAccounts      │                               │
     │────────────────────────────────────────────────────────────►│
     │ 4. 获取 address             │                               │
     │◄───────────────────────────────────────────────────────────│
     │ 5. 构造 SiweMessage { domain, address, nonce, ... }         │
     │ 6. signMessage(messageToSign)                               │
     │────────────────────────────────────────────────────────────►│
     │ 7. 得到 signature           │                               │
     │◄───────────────────────────────────────────────────────────│
     │ 8. POST /api/auth/verify { message, signature }             │
     │────────────────────────────►│                               │
     │                             │ consumeNonce(nonce) 一次性消耗 │
     │                             │ SiweMessage.verify({ signature })│
     │                             │ ensureUser(address) 查/建用户   │
     │                             │ jwt.sign({ userId, address })  │
     │ 9. { token, userId, address }                               │
     │◄────────────────────────────│                               │
```

### 2.3 实现细节

#### 2.3.1 Nonce 机制

**作用**：防止重放攻击。每条 nonce 只能使用一次，且有过期时间。

**存储**：`nonces` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| nonce | TEXT PK | 随机字符串，格式 `web3-im-{timestamp}-{random}` |
| address | TEXT | 请求 nonce 时的地址 |
| expires_at | INTEGER | 过期时间戳，默认 5 分钟 |

**createNonce(address)**：
- 生成 `nonce = web3-im-${Date.now()}-${random}`
- `expires_at = Date.now() + 5 * 60 * 1000`
- `INSERT OR REPLACE`（同一 address 多次请求会覆盖，只保留最新 nonce）

**consumeNonce(nonce)**：
- 查询 `WHERE nonce = ? AND expires_at > Date.now()`
- 若存在，`DELETE` 并返回 address；否则返回 null
- **一次性消耗**：用过的 nonce 立即删除，不能再次使用

#### 2.3.2 SiweMessage 结构

```typescript
{
  domain: window.location.host,        // 如 "localhost:3000"
  address: address.toLowerCase(),     // 0x...
  statement: "Sign in to IM Demo Support",
  uri: window.location.origin,
  version: "1",
  chainId: 1,
  nonce,                               // 服务端下发
  issuedAt: new Date().toISOString(),  // 签发时间
}
```

- 前端用 `SiweMessage.prepareMessage()` 生成符合 EIP-4361 的可读文本
- 用户签名的就是这段文本
- 提交给服务端时传 `JSON.stringify(siweObj)` 作为 message，以及 `signature`

#### 2.3.3 服务端校验

1. **解析 message**：`JSON.parse(message)` 得到 `{ nonce, address, ... }`
2. **consumeNonce(nonce)**：验证 nonce 有效且未被用过，并拿到绑定的 address
3. **address 一致性**：`parsed.address.toLowerCase() === consumeNonce 返回的 address`
4. **签名验证**：`new SiweMessage(parsed).verify({ signature })`，用 ECDSA 恢复公钥并比对地址
5. **ensureUser(address)**：在 users 表中查找或创建用户，得到 userId
6. **签发 JWT**：`jwt.sign({ userId, address }, JWT_SECRET, { expiresIn: "24h" })`

### 2.4 安全要点

| 风险 | 对策 |
|------|------|
| 重放攻击 | nonce 一次性消耗，用完即删 |
| nonce 过期 | expires_at 校验，超时则 consumeNonce 返回 null |
| 签名伪造 | SiweMessage.verify 用密码学验证，无法伪造 |
| 跨域/域名篡改 | message 含 domain、uri，服务端可校验与当前环境一致 |

---

## 三、访客模式 JWT

### 3.1 背景

用户不想连接钱包时，可「以访客身份继续」，无需 MetaMask，一键进入聊天。

### 3.2 流程

```
前端 connectAsGuest()
  → fetch("/api/auth/demo")   // Next.js 代理到 3001
  → IM Server GET /api/auth/demo
  → createDemoAuth()
  → 返回 { token, userId, address }
```

### 3.3 实现

```typescript
export function createDemoAuth(): { userId: string; address: string; token: string } {
  const address = `0x${Array.from({ length: 40 }, () => 
    Math.floor(Math.random() * 16).toString(16)).join("")}`;
  const userId = ensureUser(address);
  const token = createToken(userId, address);
  return { userId, address, token };
}
```

| 步骤 | 说明 |
|------|------|
| 1. 随机 address | 40 位十六进制，拼成 `0x...` 格式的以太坊地址 |
| 2. ensureUser(address) | 写入 users 表，address 作唯一键，返回 userId |
| 3. createToken(userId, address) | 与 SIWE 共用 `jwt.sign`，payload 含 userId、address |

### 3.4 与 SIWE 的差异

| 维度 | SIWE | 访客 |
|------|------|------|
| 身份证明 | 钱包签名 | 无，服务端随机生成 address |
| 安全性 | 高，私钥签名 | 低，任何人可获取 |
| 用户识别 | 同一钱包 → 同一 address → 同一用户 | 每次刷新/新设备可能新 address |
| Token 格式 | 相同 | 相同 |

### 3.5 访客的局限性

- 访客的 address 是随机的，刷新或换设备会变成「新用户」
- 不做持久化绑定，无法跨设备恢复会话
- 适合「快速体验、不绑钱包」的场景；若需长期身份，应引导连接钱包

---

## 四、JWT 规范

### 4.1 Payload

```json
{
  "userId": "user-1234567890-abc",
  "address": "0x..."
}
```

### 4.2 配置

| 配置 | 值 | 说明 |
|------|-----|------|
| 算法 | HS256（默认） | 对称签名 |
| 密钥 | JWT_SECRET 环境变量 | 生产环境必须自定义 |
| 过期 | 24h | expiresIn |

### 4.3 使用场景

| 场景 | 用法 |
|------|------|
| WebSocket 连接 | URL 参数 `ws://host:3001/ws?token=<JWT>` |
| HTTP API（搜索、上传） | Header `Authorization: Bearer <JWT>` |
| 服务端校验 | `verifyToken(token)` → `{ userId, address }` 或 null |

---

## 五、API 汇总

### 5.1 SIWE

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/auth/nonce | GET | `?address=0x...`，返回 `{ nonce }` |
| /api/auth/verify | POST | Body `{ message, signature }`，返回 `{ token, userId, address }` |

### 5.2 访客

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/auth/demo | GET | 无参数，返回 `{ token, userId, address }` |

### 5.3 前端调用

- SIWE：`signInWithWallet()` = `connectAndSign()` + `verifyAndGetToken()`
- 访客：`fetch("/api/auth/demo")`（Next.js 路由代理到 3001，避免 CORS）

---

## 六、数据库

### users 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | user-{timestamp}-{random} |
| address | TEXT UNIQUE | 以太坊地址，SIWE 为真实地址，访客为随机 |
| created_at | INTEGER | 创建时间戳 |

### nonces 表

| 字段 | 类型 | 说明 |
|------|------|------|
| nonce | TEXT PK | 随机字符串 |
| address | TEXT | 请求 nonce 时的地址 |
| expires_at | INTEGER | 过期时间戳 |

索引：`idx_nonces_expires` 便于定时清理过期 nonce。

---

## 七、部署注意

1. **JWT_SECRET**：生产环境必须设强随机密钥，切勿用默认值
2. **HTTPS**：生产环境 WebSocket 用 wss，API 用 https
3. **CORS**：确保 CLIENT_URL 等配置正确，允许前端域名
4. **nonce 清理**：可增加定时任务删除 `expires_at < Date.now()` 的 nonce，减少表体积
