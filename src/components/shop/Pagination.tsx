'use client';

import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

export interface PaginationProps {
  page: number;
  total: number;
  pageSize: number;
  /** 分页链接前缀，默认 /shop */
  basePath?: string;
  /** 客户端分页：点击页码时调用，不跳转 */
  onPageChange?: (page: number) => void;
}

export function Pagination({
  page,
  total,
  pageSize,
  basePath = '/shop',
  onPageChange,
}: PaginationProps) {
  const searchParams = useSearchParams();
  const totalPages = Math.ceil(total / pageSize) || 1;
  if (totalPages <= 1) return null;

  const buildUrl = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (p <= 1) params.delete('page');
    else params.set('page', String(p));
    const s = params.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  const isClientMode = Boolean(onPageChange);

  const pages: number[] = [];
  const delta = 2;
  for (let i = Math.max(1, page - delta); i <= Math.min(totalPages, page + delta); i++) {
    pages.push(i);
  }

  const PageLink = ({ p, children }: { p: number; children: React.ReactNode }) => {
    if (isClientMode) {
      return (
        <button
          type="button"
          onClick={() => onPageChange?.(p)}
          className={`wf-page-num ${p === page ? 'active' : ''}`}
          style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}
        >
          {children}
        </button>
      );
    }
    return (
      <Link href={buildUrl(p)} className={`wf-page-num ${p === page ? 'active' : ''}`}>
        {children}
      </Link>
    );
  };

  return (
    <nav className="wf-pagination" aria-label="分页">
      {page > 1 ? (
        isClientMode ? (
          <button
            type="button"
            onClick={() => onPageChange?.(page - 1)}
            className="wf-page-btn"
            style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}
          >
            上一页
          </button>
        ) : (
          <Link href={buildUrl(page - 1)} className="wf-page-btn">
            上一页
          </Link>
        )
      ) : (
        <span className="wf-page-btn disabled">上一页</span>
      )}

      <div className="wf-page-nums">
        {pages[0] > 1 && (
          <>
            <PageLink p={1}>1</PageLink>
            {pages[0] > 2 && <span className="wf-page-ellipsis">...</span>}
          </>
        )}
        {pages.map((p) => (
          <PageLink key={p} p={p}>
            {p}
          </PageLink>
        ))}
        {pages[pages.length - 1] < totalPages && (
          <>
            {pages[pages.length - 1] < totalPages - 1 && (
              <span className="wf-page-ellipsis">...</span>
            )}
            <PageLink p={totalPages}>{totalPages}</PageLink>
          </>
        )}
      </div>

      {page < totalPages ? (
        isClientMode ? (
          <button
            type="button"
            onClick={() => onPageChange?.(page + 1)}
            className="wf-page-btn"
            style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}
          >
            下一页
          </button>
        ) : (
          <Link href={buildUrl(page + 1)} className="wf-page-btn">
            下一页
          </Link>
        )
      ) : (
        <span className="wf-page-btn disabled">下一页</span>
      )}
    </nav>
  );
}
