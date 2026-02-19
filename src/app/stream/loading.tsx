/**
 * 流式渲染 - 骨架屏（秒开）
 * Next.js 会优先流式输出此 loading UI，实现首屏秒开
 */
export default function StreamLoading() {
  return (
    <main className="stream-page">
      <header className="stream-header">
        <div className="stream-skeleton stream-skeleton-title" />
        <div className="stream-skeleton stream-skeleton-subtitle" style={{ width: "60%" }} />
      </header>
      <div className="stream-content">
        <div className="stream-block">
          <div className="stream-skeleton stream-skeleton-block" />
          <div className="stream-skeleton stream-skeleton-line" />
          <div className="stream-skeleton stream-skeleton-line" style={{ width: "80%" }} />
          <div className="stream-skeleton stream-skeleton-line" style={{ width: "95%" }} />
        </div>
        <div className="stream-block">
          <div className="stream-skeleton stream-skeleton-block" />
          <div className="stream-skeleton stream-skeleton-stats" />
        </div>
        <div className="stream-grid">
          <div className="stream-block">
            <div className="stream-skeleton stream-skeleton-block" />
            <div className="stream-skeleton stream-skeleton-line" />
            <div className="stream-skeleton stream-skeleton-line" style={{ width: "90%" }} />
            <div className="stream-skeleton stream-skeleton-line" style={{ width: "70%" }} />
            <div className="stream-skeleton stream-skeleton-line" style={{ width: "85%" }} />
          </div>
          <div className="stream-block">
            <div className="stream-skeleton stream-skeleton-block" />
            <div className="stream-skeleton stream-skeleton-code" />
          </div>
        </div>
        <div className="stream-block">
          <div className="stream-skeleton stream-skeleton-block" />
          <div className="stream-skeleton stream-skeleton-line" style={{ width: "40%" }} />
          <div className="stream-skeleton stream-skeleton-line" style={{ width: "55%" }} />
          <div className="stream-skeleton stream-skeleton-line" style={{ width: "60%" }} />
        </div>
        <div className="stream-block">
          <div className="stream-skeleton stream-skeleton-block" />
          <div className="stream-skeleton stream-skeleton-line" />
          <div className="stream-skeleton stream-skeleton-line" style={{ width: "95%" }} />
        </div>
        <div className="stream-block">
          <div className="stream-skeleton stream-skeleton-block" />
          <div className="stream-skeleton stream-skeleton-usecases" />
        </div>
        <div className="stream-block">
          <div className="stream-skeleton stream-skeleton-block" />
          <div className="stream-skeleton stream-skeleton-line" />
          <div className="stream-skeleton stream-skeleton-line" style={{ width: "88%" }} />
        </div>
      </div>
    </main>
  );
}
