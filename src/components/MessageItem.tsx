'use client';

/**
 * 单条消息气泡：头像、内容（文本/图片/PDF/贴纸等）、反应、时间、状态
 * 可见时触发 markAsRead（接收消息）
 */

import React, { useRef, useEffect, useState } from 'react';
import { type Message, type QuoteInfo, MessageType, MessageStatus, SenderType } from '@/sdk';
import { FilePreview } from '@/components/FilePreview';
import { RichTextContent } from '@/components/RichTextContent';
import { UrlPreviewCard, extractUrls } from '@/components/UrlPreviewCard';
import { TradeCard } from '@/components/TradeCard';
import { MessageReactions } from '@/components/MessageReactions';
import { MessageQuoteBlock } from '@/components/MessageQuoteBlock';
import { ConfirmModal } from '@/components/ConfirmModal';
import { formatTime, classNames } from '@/utils/helpers';
import { useChatStore } from '@/store/chatStore';

/** 消息气泡组件的 props */
interface MessageItemProps {
  message: Message;                           // 消息数据
  showAvatar?: boolean;                       // 是否显示头像
  showName?: boolean;                         // 是否显示发送者名称
  onVisible?: (messageId: string) => void;    // 进入视口时回调（用于 markAsRead）
  hideReactions?: boolean;                    // 隐藏表情反应（如历史页/性能测试）
  hideReply?: boolean;                        // 隐藏回复按钮（如历史页）
  currentUserId?: string;                     // 当前用户 ID，用于 C2C 判断「是否自己」
  hideEditRecall?: boolean;                   // 隐藏编辑/撤回按钮
  onEdit?: (message: Message, newContent: string) => void;  // 编辑回调
  /** 撤回回调；可选传入撤回前高度 previousHeight，供列表做滚动补偿 */
  onRecall?: (message: Message, previousHeight?: number) => void;
  /** 回复/引用回调，不传则用 chatStore.replyToMessage（客服 IM） */
  onReply?: (message: Message) => void;
  /** 表情反应：传入则用自定义实现（如 chatSessionStore），否则用 chatStore */
  onAddReaction?: (messageId: string, emoji: string) => void;
  onRemoveReaction?: (messageId: string, emoji: string) => void;
}

/** 消息状态图标：发送中/已发送/已送达/已读/失败 */
const StatusIcon: React.FC<{ status: MessageStatus }> = ({ status }) => {
  switch (status) {
    case MessageStatus.SENDING:   // 发送中
      return <span className="msg-status sending" title="Sending">○</span>;
    case MessageStatus.SENT:      // 已发送
      return <span className="msg-status sent" title="Sent">✓</span>;
    case MessageStatus.DELIVERED: // 已送达
      return <span className="msg-status delivered" title="Delivered">✓✓</span>;
    case MessageStatus.READ:      // 已读
      return <span className="msg-status read" title="Read">✓✓</span>;
    case MessageStatus.FAILED:    // 发送失败
      return <span className="msg-status failed" title="Failed">✕</span>;
    default:
      return null;
  }
};

export const MessageItem = React.memo<MessageItemProps>(function MessageItem({
  message,
  showAvatar = true,
  showName = true,
  onVisible,
  hideReactions = false,
  hideReply = false,
  currentUserId,
  hideEditRecall = false,
  onEdit,
  onRecall,
  onReply,
  onAddReaction,
  onRemoveReaction,
}) {
  const chatReplyToMessage = useChatStore((s) => s.replyToMessage);
  const replyToMessage = onReply ?? chatReplyToMessage;
  const rootRef = useRef<HTMLDivElement>(null);                  // 用于 IntersectionObserver 监听
  const [isEditing, setIsEditing] = useState(false);             // 是否处于编辑模式
  const [editValue, setEditValue] = useState('');                // 编辑框内容
  const [showRecallConfirm, setShowRecallConfirm] = useState(false);

  // 判断是否为自己发的消息（用于样式、已读逻辑、编辑/撤回显示）
  const isUser = currentUserId !== undefined
    ? message.senderId === currentUserId
    : message.senderType === SenderType.USER;

   /**
   * 可见性监听：Bot/Agent 消息进入视口 ≥50% 时，回调 onVisible(messageId)。
   * MessageList 收到后会将 id 加入批量已读队列，debounce 后统一上报。
   * - isUser：自己的消息不触发已读
   * - threshold: 0.5：至少 50% 可见才视为「已读」
   * - cleanup：obs.disconnect 移除监听，避免内存泄漏
   */
  useEffect(() => {
    if (!onVisible || isUser) return;
    const el = rootRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onVisible(message.id);
      },
      { threshold: 0.5 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [message.id, isUser, onVisible]);

  // 系统消息（如排队、转人工提示）单独渲染，无头像/气泡样式
  const isSystem = message.senderType === SenderType.SYSTEM || message.type === MessageType.SYSTEM;

  if (isSystem) {
    return (
      <div className="message-item system-message">
        <div className="system-content">
          <RichTextContent content={message.content} />
        </div>
      </div>
    );
  }

  /** 根据 senderType 返回头像内容（用户首字母/Bot 图标/Agent 缩写） */
  const getAvatarContent = () => {
    switch (message.senderType) {
      case SenderType.USER:
        return <span>{(message.senderName || 'U').charAt(0).toUpperCase()}</span>;
      case SenderType.BOT:
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <circle cx="12" cy="5" r="4" />
          </svg>
        );
      case SenderType.AGENT:
        return <span>CS</span>;
      default:
        return <span>?</span>;
    }
  };

  /** 进入编辑模式 */
  const handleStartEdit = () => {
    setEditValue(message.content);
    setIsEditing(true);
  };

  /** 确认编辑：有内容且与原文不同时调用 onEdit */
  const handleConfirmEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && onEdit && trimmed !== message.content) {
      onEdit(message, trimmed);
    }
    setIsEditing(false);
  };

  /** 取消编辑 */
  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const isRecalled = !!(message.metadata as { recalled?: boolean })?.recalled;
  const RECALL_LIMIT_MS = 2 * 60 * 1000; // 2 分钟内可撤回，与服务端一致
  const canRecall = Date.now() - message.timestamp <= RECALL_LIMIT_MS;

  /** 撤回消息：2 分钟内可撤，弹出确认后调用 onRecall */
  const handleRecall = () => {
    if (onRecall && canRecall) setShowRecallConfirm(true);
  };
  const handleRecallConfirm = () => {
    setShowRecallConfirm(false);
    const previousHeight = rootRef.current ? rootRef.current.getBoundingClientRect().height : undefined;
    onRecall?.(message, previousHeight);
  };

  /** 根据消息类型渲染内容：撤回提示/编辑框/图片/贴纸/语音/视频/文本 */
  const renderContent = () => {
    if (isRecalled) {
      return <span className="msg-recalled">已撤回</span>;
    }
    if (isEditing) {  // 编辑模式：textarea + 取消/确定
      return (
        <div className="msg-edit-wrap">
          <textarea
            className="msg-edit-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleConfirmEdit();
              } else if (e.key === 'Escape') handleCancelEdit();
            }}
            autoFocus
            rows={3}
          />
          <div className="msg-edit-actions">
            <button type="button" className="msg-edit-btn cancel" onClick={handleCancelEdit}>
              取消
            </button>
            <button type="button" className="msg-edit-btn confirm" onClick={handleConfirmEdit}>
              确定
            </button>
          </div>
        </div>
      );
    }
    switch (message.type) {
      case MessageType.IMAGE:  // 图片
      case MessageType.PDF:
        return <FilePreview message={message} />;
      case MessageType.STICKER:  // 贴纸
        return (
          <div className="msg-sticker">
            <span className="sticker-emoji" role="img">{message.content || '🙂'}</span>
          </div>
        );
      case MessageType.VOICE:  // 语音（占位：支持 metadata.duration、metadata.url 展示）
        const voiceMeta = message.metadata as { duration?: number; url?: string } | undefined;
        const duration = voiceMeta?.duration;
        const durationStr = typeof duration === 'number'
          ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`
          : null;
        return (
          <div className="msg-voice">
            <span className="voice-icon" role="img" aria-label="语音">🎤</span>
            <div className="voice-wave" aria-hidden>
              {[1, 2, 3, 4, 5].map((i) => (
                <span key={i} className="voice-bar" style={{ height: `${20 + Math.sin(i) * 12}px` }} />
              ))}
            </div>
            <span className="voice-label">
              {durationStr ?? 'Voice message'}
            </span>
            {voiceMeta?.url && (
              <a href={voiceMeta.url} target="_blank" rel="noopener noreferrer" className="voice-play">
                播放
              </a>
            )}
          </div>
        );
      case MessageType.VIDEO:  // 视频
        return <FilePreview message={message} />;
      case MessageType.TRADE_CARD:  // 交易卡片（分享到群）
        const tradeCard = message.metadata?.tradeCard;
        return tradeCard ? (
          <div className="msg-trade-card-wrap">
            <TradeCard payload={tradeCard} />
          </div>
        ) : (
          <span className="msg-text">[交易卡片]</span>
        );
      case MessageType.TEXT:  // 文本：富文本 + URL 预览
      default: {
        const urls = extractUrls(message.content);  // 从文本提取链接
        const urlPreview = message.metadata?.urlPreview as { url: string; title?: string; description?: string; image?: string } | undefined;  // 预设预览
        return (
          <div className="msg-text-wrap">
            <RichTextContent content={message.content} className="msg-text" />
            {urlPreview ? (
              <UrlPreviewCard
                url={urlPreview.url}
                title={urlPreview.title}
                description={urlPreview.description}
                image={urlPreview.image}
              />
            ) : (
              urls.map((url) => <UrlPreviewCard key={url} url={url} />)
            )}
          </div>
        );
      }
    }
  };

  return (
    <>
    <div
      ref={rootRef}
      data-message-id={message.id}
      className={classNames(
        'message-item',
        isUser ? 'message-user' : 'message-other',  // 左右布局
        message.status === MessageStatus.FAILED && 'message-failed'  // 失败样式
      )}
    >
      {!isUser && showAvatar && (  // 他人消息显示头像
        <div className={classNames('msg-avatar', `avatar-${message.senderType}`)}>
          {getAvatarContent()}
        </div>
      )}
      <div className="msg-body">
        {!isUser && showName && (  // 他人消息显示发送者名
          <div className="msg-sender">{message.senderName}</div>
        )}
        <div className={classNames('msg-bubble', isUser ? 'bubble-user' : 'bubble-other')}>
          {message.metadata?.quote && (  // 引用回复块
            <MessageQuoteBlock quote={message.metadata.quote as QuoteInfo} />
          )}
          {renderContent()}
        </div>
        <div className="msg-meta">
          <span className="msg-time">{formatTime(message.timestamp)}</span>
          <span className="msg-debug-id" title="列表 key 用 id；顺序用 seqId（单调递增）">
            id: {message.id} · seqId: {message.seqId ?? '—'}
          </span>
          {!hideReply && (  // 回复按钮
            <button
              className="msg-reply-btn"
              onClick={() => replyToMessage(message)}
              title="回复"
              aria-label="回复此消息"
            >
              回复
            </button>
          )}
          {isUser && !hideEditRecall && !isRecalled && (  // 自己的消息显示编辑/撤回
            <>
              {message.type === MessageType.TEXT && onEdit && (
                <button
                  className="msg-action-btn"
                  onClick={handleStartEdit}
                  title="编辑"
                  aria-label="编辑"
                >
                  编辑
                </button>
              )}
              {onRecall && canRecall && (
                <button
                  className="msg-action-btn"
                  onClick={handleRecall}
                  title="撤回（2 分钟内有效）"
                  aria-label="撤回"
                >
                  撤回
                </button>
              )}
            </>
          )}
          {isUser && <StatusIcon status={message.status} />}  {/* 发送状态图标 */}
        </div>
        {!hideReactions && (  // 表情反应
          <MessageReactions
            messageId={message.id}
            metadata={message.metadata}
            isUserMessage={isUser}
            addReaction={onAddReaction}
            removeReaction={onRemoveReaction}
            userId={currentUserId}
          />
        )}
      </div>
    </div>
    <ConfirmModal
      open={showRecallConfirm}
      title="撤回消息"
      message="确定要撤回此消息？撤回后内容将无法恢复。"
      confirmText="确定撤回"
      cancelText="取消"
      variant="danger"
      onConfirm={handleRecallConfirm}
      onCancel={() => setShowRecallConfirm(false)}
    />
    </>
  );
});
