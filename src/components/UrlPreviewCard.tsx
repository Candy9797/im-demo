'use client';

/**
 * URL 预览卡片：消息中链接的富预览（标题、描述、图片）
 * extractUrls 从文本提取 URL；KNOWN_PREVIEWS 为预设元数据（演示用）
 */

import React from 'react';

export interface UrlPreviewMeta {
  url: string;
  title?: string;
  description?: string;
  image?: string;
}

interface UrlPreviewCardProps {
  url: string;
  title?: string;
  description?: string;
  image?: string;
}

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  return matches ? [...new Set(matches)] : [];
}

/** 已知 URL 的预设预览信息（演示用，生产可由后端 /api/preview 获取） */
const KNOWN_PREVIEWS: Record<string, UrlPreviewMeta> = {
  'https://ethereum.org': {
    url: 'https://ethereum.org',
    title: 'Ethereum.org',
    description: 'The community-run technology powering the cryptocurrency ether (ETH) and thousands of decentralized applications.',
    image: 'https://ethereum.org/static/0a7d83ec646d64ac7073e9c6d72c0156/ethereum-icon-purple.png',
  },
  'https://docs.ethers.org': {
    url: 'https://docs.ethers.org',
    title: 'ethers.js Documentation',
    description: 'The ethers.js library aims to be a complete and compact library for interacting with the Ethereum Blockchain.',
    image: 'https://ethers.org/favicon.ico',
  },
  'https://wagmi.sh': {
    url: 'https://wagmi.sh',
    title: 'wagmi',
    description: 'React Hooks for Ethereum. wagmi makes it easy to connect a wallet and display ENS and balance information.',
  },
  'https://viem.sh': {
    url: 'https://viem.sh',
    title: 'viem',
    description: 'TypeScript Interface for Ethereum. A fast, type-safe alternative to ethers.js and web3.js.',
  },
};

function getPreviewMeta(url: string, overrides?: Partial<UrlPreviewMeta>): UrlPreviewMeta {
  const normalized = url.replace(/\/$/, '');
  const known = KNOWN_PREVIEWS[normalized];
  return {
    url,
    title: overrides?.title ?? known?.title ?? new URL(url).hostname,
    description: overrides?.description ?? known?.description,
    image: overrides?.image ?? known?.image,
  };
}

export const UrlPreviewCard: React.FC<UrlPreviewCardProps> = ({
  url,
  title: titleProp,
  description: descProp,
  image: imageProp,
}) => {
  const meta = getPreviewMeta(url, {
    title: titleProp,
    description: descProp,
    image: imageProp,
  });

  return (
    <a
      href={meta.url}
      target="_blank"
      rel="noopener noreferrer"
      className="url-preview-card"
    >
      {meta.image && (
        <div className="url-preview-image">
          <img src={meta.image} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = 'none')} />
        </div>
      )}
      <div className="url-preview-body">
        <div className="url-preview-title">{meta.title}</div>
        {meta.description && (
          <div className="url-preview-desc">{meta.description}</div>
        )}
        <div className="url-preview-url">{meta.url}</div>
      </div>
    </a>
  );
};
