'use client';

/**
 * 大批量消息分片 Demo（JSON 连接）
 *
 * 演示：请求大批量消息，服务端一次性下发 >64KB 时自动走分片（frag_meta + 多 chunk），接收端重组后展示
 *
 * 使用步骤：
 * 1. 点击「连接」→ 打开聊天并建立连接（JSON 格式）
 * 2. 连接成功后点击「请求大批量消息（触发分片）」→ 服务端推送约 150 条消息，编码后通常 >64KB，会以分片形式接收
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chatStore';
import { ConnectionState } from '@/sdk';

const SIMULATE_COUNT = 150; // 约 150 条消息时，单帧编码后通常 > 64KB，触发分片

export default function DemoProtobufPage() {
  const {
    connectionState,
    client,
    auth,
    connectAsGuest,
    initialize,
    destroy,
    toggleOpen,
    requestSimulatePush,
    messages,
  } = useChatStore(
    useShallow((s) => ({
      connectionState: s.connectionState,
      client: s.client,
      auth: s.auth,
      connectAsGuest: s.connectAsGuest,
      initialize: s.initialize,
      destroy: s.destroy,
      toggleOpen: s.toggleOpen,
      requestSimulatePush: s.requestSimulatePush,
      messages: s.messages,
    }))
  );

  const [step, setStep] = useState<'idle' | 'connecting' | 'done'>('idle');
  const [pushDone, setPushDone] = useState(false);
  const msgCountBeforeRef = React.useRef(0);

  const isConnected = connectionState === ConnectionState.CONNECTED;

  const handleConnect = async () => {
    setStep('connecting');
    if (client) {
      destroy();
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!auth) {
      const ok = await connectAsGuest();
      if (!ok) {
        setStep('idle');
        return;
      }
    }
    toggleOpen();
    await initialize();
    setStep('done');
  };

  const handleRequestLargeBatch = () => {
    msgCountBeforeRef.current = messages.length;
    setPushDone(false);
    requestSimulatePush(SIMULATE_COUNT);
    setTimeout(() => setPushDone(true), 2000);
  };

  const addedCount = pushDone ? messages.length - msgCountBeforeRef.current : 0;

  return (
    <div className="demo-protobuf-page" style={{ padding: 24, maxWidth: 560, margin: '0 auto' }}>
      <header style={{ marginBottom: 24 }}>
        <Link href="/" style={{ color: 'var(--brand)', marginRight: 12 }}>
          ← 返回
        </Link>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginTop: 8 }}>
          Protobuf + 大消息分片 Demo
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 8 }}>
          连接后请求大批量消息以触发 &gt;64KB 分片接收（JSON 格式）。
        </p>
      </header>

      <section style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>
          当前格式 / 连接状态
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            格式：<strong>{format}</strong>
          </span>
          <span>
            连接：
            <strong
              style={{
                color:
                  connectionState === ConnectionState.CONNECTED
                    ? 'var(--success)'
                    : connectionState === ConnectionState.CONNECTING ||
                        connectionState === 'reconnecting'
                      ? 'var(--warning)'
                      : 'var(--text-tertiary)',
              }}
            >
              {connectionState}
            </strong>
          </span>
          <span>当前消息数：{messages.length}</span>
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>步骤 1：使用 Protobuf 并连接</div>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
          会先将格式设为 Protobuf，若已连接则先断开再重连，然后打开聊天窗口并建立连接（URL 带
          <code style={{ marginLeft: 4 }}>?format=protobuf</code>）。
        </p>
        <button
          type="button"
          onClick={handleConnect}
          disabled={step === 'connecting'}
          style={{
            padding: '10px 16px',
            background: 'var(--brand)',
            color: 'var(--bubble-user-text)',
            border: 'none',
            borderRadius: 8,
            cursor: step === 'connecting' ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
        >
          {step === 'connecting' ? '连接中…' : '连接'}
        </button>
      </section>

      <section style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
          步骤 2：请求大批量消息（触发分片）
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
          向服务端请求一次性推送 <strong>{SIMULATE_COUNT}</strong> 条 Mock 消息。服务端会以单帧
          <code>message</code> 批量下发，编码后通常 &gt;64KB，将自动走分片（先发
          <code>frag_meta</code>，再发多段二进制 chunk），客户端接收后重组再展示。
        </p>
        <button
          type="button"
          onClick={handleRequestLargeBatch}
          disabled={!client || !isConnected}
          style={{
            padding: '10px 16px',
            background: isConnected ? 'var(--success)' : 'var(--bg-tertiary)',
            color: isConnected ? '#fff' : 'var(--text-tertiary)',
            border: 'none',
            borderRadius: 8,
            cursor: isConnected ? 'pointer' : 'not-allowed',
            fontWeight: 600,
          }}
        >
          请求 {SIMULATE_COUNT} 条消息（触发分片）
        </button>
        {pushDone && (
          <p style={{ fontSize: 12, color: 'var(--success)', marginTop: 12 }}>
            已请求。当前共 {messages.length} 条消息
            {addedCount >= 0 ? `（本批新增约 ${addedCount} 条）` : ''}，请到聊天窗口查看。
          </p>
        )}
      </section>

      <section style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
        <p>
          若已在聊天 Header 中选择「Protobuf」，也可直接在该页点击「请求大批量消息」；本页「步骤
          1」用于确保以 Protobuf 连接并打开聊天。
        </p>
        <p style={{ marginTop: 8 }}>
          分片阈值：64KB（<code>CHUNK_SIZE</code>）。详见 <code>docs/技术方案-详细版.md</code>。
        </p>
      </section>
    </div>
  );
}
