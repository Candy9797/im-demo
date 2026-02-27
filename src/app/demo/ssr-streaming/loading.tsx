/**
 * 流式 SSR：路由级 loading，会先于 page 流式输出，实现「秒开骨架」
 */
export default function StreamingLoading() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'system-ui, -apple-system, sans-serif', minHeight: '100vh', background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)', color: '#0f172a' }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '2rem 2rem 2.5rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.05)' }}>
        <div style={{ height: 28, width: '50%', background: 'linear-gradient(90deg, #f1f5f9 0%, #e2e8f0 100%)', borderRadius: 8, marginBottom: 12 }} />
        <div style={{ height: 18, width: '85%', background: 'linear-gradient(90deg, #e2e8f0 0%, #cbd5e1 100%)', borderRadius: 6, marginBottom: '1.75rem' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                padding: '1.25rem 1.5rem',
                background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                borderRadius: 12,
                height: 100,
                border: '1px dashed #cbd5e1',
              }}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
