'use client';

/**
 * 高 QPS 压测页：快速发送消息，观测批处理、限流、UI 响应
 *
 * 前置：需先进入聊天并连接（/chat 或弹窗打开并已连）
 * 服务端限流：20 条/秒（滑动窗口）
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/store/chatStore';

export default function StressPage() {
  const { client, sendMessage, connectionState, connectAsGuest, initialize } =
    useChatStore(
      useShallow((s) => ({
        client: s.client,
        sendMessage: s.sendMessage,
        connectionState: s.connectionState,
        connectAsGuest: s.connectAsGuest,
        initialize: s.initialize,
      }))
    );

  const [connectLoading, setConnectLoading] = useState(false);

  const [count, setCount] = useState(30);
  const [intervalMs, setIntervalMs] = useState(30);
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState<{
    requested: number;
    rateLimited: number;
  } | null>(null);
  const [rateLimitMap, setRateLimitMap] = useState<Record<string, number[]>>({});
  const [rateLimitConfig, setRateLimitConfig] = useState<{ limitPerSec: number } | null>(null);
  const [lastAckBatchSize, setLastAckBatchSize] = useState<number | null>(null);

  const rateLimitedRef = useRef(0);
  const unsubRef = useRef<(() => void) | null>(null);

  const isConnected = connectionState === 'connected';

  const runStress = useCallback(() => {
    if (!client || !isConnected || isRunning) return;

    rateLimitedRef.current = 0;
    setStats(null);
    setLastAckBatchSize(null);
    setIsRunning(true);

    const onServerError = (payload: unknown) => {
      const p = payload as { code?: string };
      if (p?.code === 'rate_limit') rateLimitedRef.current += 1;
    };

    client.on('server_error', onServerError);
    const onAckBatch = (n: unknown) => setLastAckBatchSize(typeof n === 'number' ? n : 0);
    client.on('message_ack_batch', onAckBatch);
    unsubRef.current = () => {
      client.off('server_error', onServerError);
      client.off('message_ack_batch', onAckBatch);
    };
    //按 i 递归发送，到 i === count 时停止并统计
// 还有下一条：setTimeout 在 intervalMs 后再调用 run(i + 1)。
// 已是最后一条：直接 run(count)，进入上面的结束逻辑，不再等待。
    const run = async (i: number) => {
      if (i >= count) {
        // 突发模式：立即 flush，不依赖 50ms 定时器，确保批量发送
        if (intervalMs === 0) {
          await client.forceFlushOutgoing();
        }
        setTimeout(() => {
          setStats({
            requested: count,
            rateLimited: rateLimitedRef.current,
          });
          setIsRunning(false);
          unsubRef.current?.();
          unsubRef.current = null;
        }, 500);
        return;
      }
      sendMessage(`[压测] 第 ${i + 1}/${count} 条`);
      if (intervalMs === 0) {
        if (i + 1 < count) await run(i + 1);
        else await run(i + 1);
      } else if (i + 1 < count) {
        setTimeout(() => run(i + 1), intervalMs);
      } else {
        await run(i + 1);
      }
    };
    // run 是高 QPS 压测的递归发送函数，负责按指定间隔逐条发送消息，并在结束时统计被限流条数。
    run(0);
  }, [client, isConnected, isRunning, count, intervalMs, sendMessage]);

  const handleQuickConnect = useCallback(async () => {
    if (isConnected) return;
    setConnectLoading(true);
    try {
      const ok = await connectAsGuest();
      if (ok) await initialize();
    } finally {
      setConnectLoading(false);
    }
  }, [isConnected, connectAsGuest, initialize]);

  const fetchRateLimitState = useCallback(async () => {
    try {
      // 使用同源代理避免扩展 Service Worker 拦截跨域请求导致 Failed to fetch
      const [stateRes, configRes] = await Promise.all([
        fetch('/api/rate-limit-state'),
        fetch('/api/rate-limit-config'),
      ]);
      if (stateRes.ok) {
        const data = (await stateRes.json()) as Record<string, number[]>;
        setRateLimitMap(data);
      }
      if (configRes.ok) {
        const config = (await configRes.json()) as { limitPerSec: number };
        setRateLimitConfig(config);
      }
    } catch {
      setRateLimitMap({});
    }
  }, []);

  useEffect(() => {
    fetchRateLimitState();
    const t = setInterval(fetchRateLimitState, 2000);
    return () => clearInterval(t);
  }, [fetchRateLimitState]);

  useEffect(() => {
    return () => unsubRef.current?.();
  }, []);

  return (
    <div className="stress-page">
      <header className="stress-header">
        <div className="stress-header-left">
          <Link href="/" className="stress-back-btn">
            ← 返回
          </Link>
          <h1 className="stress-title">高 QPS 压测</h1>
        </div>
        <div className="stress-header-meta">
          <span
            className={
              isConnected ? 'stress-status ok' : 'stress-status disconnected'
            }
          >
            {isConnected ? '已连接' : '未连接'}
          </span>
        </div>
      </header>

      <main className="stress-main">
        {!isConnected ? (
          <div className="stress-tip">
            <p>请先连接：</p>
            <button
              className="stress-btn stress-btn-connect"
              onClick={handleQuickConnect}
              disabled={connectLoading}
            >
              {connectLoading ? '连接中…' : '快速连接（访客）'}
            </button>
            <p className="stress-tip-alt">
              或 <Link href="/">返回落地页</Link> 使用访客/钱包登录
            </p>
          </div>
        ) : (
          <>
            <div className="stress-form">
              <div className="stress-form-row">
                <div className="stress-field">
                  <label>发送条数</label>
                  <input
                    type="number"
                    min={1}
                    value={count}
                    onChange={(e) =>
                      setCount(Math.max(1, Number(e.target.value) || 1))
                    }
                    disabled={isRunning}
                  />
                </div>
                <div className="stress-field">
                  <label>间隔 (ms)</label>
                  <input
                    type="number"
                    min={0}
                    value={intervalMs}
                    onChange={(e) =>
                      setIntervalMs(Math.max(0, Number(e.target.value) || 0))
                    }
                    disabled={isRunning}
                  />
                </div>
                <button
                  className="stress-btn"
                  onClick={runStress}
                  disabled={isRunning}
                >
                  {isRunning ? '压测中…' : '开始高 QPS 压测'}
                </button>
              </div>
              <p className="stress-form-hint">0=突发模式（批量发送）</p>
            </div>

            {stats && (
              <div className="stress-result">
                <div className="stress-result-row">
                  <span>已请求</span>
                  <strong>{stats.requested}</strong>
                  <span>条</span>
                </div>
                <div className="stress-result-row">
                  <span>限流</span>
                  <strong className={stats.rateLimited > 0 ? 'danger' : ''}>
                    {stats.rateLimited}
                  </strong>
                  <span>条</span>
                </div>
                <div className="stress-result-hint">
                  服务端限制 {rateLimitConfig?.limitPerSec ?? '—'} 条/秒，{intervalMs}ms 间隔约
                  {intervalMs > 0 ? Math.round(1000 / intervalMs) : '∞'} 条/秒
                </div>
                {stats.rateLimited === 0 && stats.requested > (rateLimitConfig?.limitPerSec ?? 0) && (
                  <p className="stress-ratelimit-hint" style={{ marginTop: 8 }}>
                    若限流一直为 0，请刷新页面后重新「快速连接」再压测（确保使用 JSON 连接）。
                  </p>
                )}
              </div>
            )}

            {lastAckBatchSize != null && (
              <div className="stress-ack-batch">
                最近批量 ack：<strong>{lastAckBatchSize}</strong> 条/帧
              </div>
            )}

            <div className="stress-docs">
              <p>相关：</p>
              <ul>
                <li>服务端：server/ws-handler.ts 滑动窗口 {rateLimitConfig?.limitPerSec ?? '—'} 条/秒（GET /api/rate-limit-config）</li>
                <li>客户端：MessageQueue 批处理 50ms、seenIds 5s 去重</li>
                <li>渲染：MessageList Virtuoso 虚拟列表</li>
                <li><Link href="/test-ws">WS 联调测试页</Link>（会话全走真实 WS，无 Mock）</li>
              </ul>
            </div>
          </>
        )}

        <div className="stress-ratelimit">
          <h3 className="stress-ratelimit-title">rateLimitMap（服务端滑动窗口）</h3>
          <p className="stress-ratelimit-hint">
            限流配置：{rateLimitConfig?.limitPerSec ?? '—'} 条/秒，Map&lt;userId, number[]&gt;，每 2s 刷新
          </p>
          {Object.keys(rateLimitMap).length === 0 ? (
            <p className="stress-ratelimit-empty">暂无数据（压测后或发消息后会填充）</p>
          ) : (
            <div className="stress-ratelimit-list">
              {Object.entries(rateLimitMap).map(([userId, timestamps]) => {
                const now = Date.now();
                const inWindow = timestamps.filter((t) => now - t < 1000);
                return (
                  <div key={userId} className="stress-ratelimit-item">
                    <div className="stress-ratelimit-user">{userId}</div>
                    <div className="stress-ratelimit-meta">
                      窗口内 {inWindow.length}/{rateLimitConfig?.limitPerSec ?? '—'} 条
                      {rateLimitConfig && inWindow.length >= rateLimitConfig.limitPerSec && (
                        <span className="stress-ratelimit-full">（已满）</span>
                      )}
                    </div>
                    <div className="stress-ratelimit-timestamps">
                      timestamps（距当前 ms）: [{inWindow.slice(-8).map((t) => now - t).join(', ')}
                      {inWindow.length > 8 && ` ... 共 ${inWindow.length} 条`}]
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
