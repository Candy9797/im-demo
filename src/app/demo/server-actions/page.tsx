'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { greet, addNumbers, submitMessage } from '@/app/actions/demo';

export default function ServerActionsDemoPage() {
  const [name, setName] = useState('');
  const [greeting, setGreeting] = useState('');
  const [sumResult, setSumResult] = useState<number | null>(null);
  const [formResult, setFormResult] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleGreet = () => {
    startTransition(async () => {
      const msg = await greet(name);
      setGreeting(msg);
    });
  };

  const handleAdd = () => {
    startTransition(async () => {
      const { sum } = await addNumbers(10, 20);
      setSumResult(sum);
    });
  };

  const handleFormSubmit = async (formData: FormData) => {
    const result = await submitMessage(formData);
    setFormResult(result.ok ? result.message : result.message);
  };

  return (
    <main style={{ maxWidth: 600, margin: '2rem auto', padding: '0 1rem', fontFamily: 'sans-serif' }}>
      <h1>Server Actions Demo</h1>
      <p style={{ color: '#666', marginBottom: '2rem' }}>
        以下操作都在服务端执行，通过 <code>&quot;use server&quot;</code> 定义。
      </p>

      <section style={{ marginBottom: '2rem' }}>
        <h2>1. 调用 greet(name)</h2>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入名字"
          style={{ marginRight: 8, padding: '6px 10px' }}
        />
        <button type="button" onClick={handleGreet} disabled={isPending}>
          {isPending ? '请求中…' : '打招呼'}
        </button>
        {greeting && <p style={{ marginTop: 8 }}>{greeting}</p>}
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2>2. 调用 addNumbers(10, 20)</h2>
        <button type="button" onClick={handleAdd} disabled={isPending}>
          {isPending ? '计算中…' : '10 + 20 = ?'}
        </button>
        {sumResult !== null && <p style={{ marginTop: 8 }}>结果：{sumResult}</p>}
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2>3. Form 提交（submitMessage）</h2>
        <form action={handleFormSubmit}>
          <input
            name="message"
            type="text"
            placeholder="输入一段话"
            style={{ marginRight: 8, padding: '6px 10px', minWidth: 200 }}
          />
          <button type="submit">提交</button>
        </form>
        {formResult && <p style={{ marginTop: 8 }}>{formResult}</p>}
      </section>

      <p>
        <Link href="/" style={{ color: '#0070f3' }}>
          ← 返回首页
        </Link>
      </p>
    </main>
  );
}
