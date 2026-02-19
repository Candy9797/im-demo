/**
 * 应用常量
 *
 * Emoji 列表、文件类型/大小限制、贴纸 ID 等
 */

/** Emoji 选择器可选表情 */
export const EMOJI_LIST = [
  "😀",
  "😃",
  "😄",
  "😁",
  "😅",
  "😂",
  "🤣",
  "😊",
  "😇",
  "🙂",
  "😉",
  "😌",
  "😍",
  "🥰",
  "😘",
  "😗",
  "😋",
  "😛",
  "😜",
  "🤪",
  "😝",
  "🤑",
  "🤗",
  "🤭",
  "🤔",
  "🤨",
  "😐",
  "😑",
  "😶",
  "😏",
  "😒",
  "🙄",
  "😬",
  "😮",
  "😯",
  "😲",
  "😳",
  "🥺",
  "😢",
  "😭",
  "😤",
  "😠",
  "😡",
  "🤬",
  "😈",
  "👿",
  "💀",
  "☠️",
  "👍",
  "👎",
  "👋",
  "🤝",
  "🙏",
  "❤️",
  "🔥",
  "⭐",
  "🎉",
  "💯",
  "✅",
  "❌",
  "⚠️",
  "💰",
  "🚀",
  "💎",
];

/** 单文件最大 10MB */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];
export const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
export const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_VIDEO_TYPES, "application/pdf"];

export const USER_ID = `user-${Math.random().toString(36).slice(2, 10)}`;

/** Sticker IDs for sticker picker (emoji used as sticker content) */
export const STICKER_LIST = [
  "👍", "❤️", "😂", "😭", "😡", "🤔", "🎉", "🔥",
  "💯", "✅", "👋", "🙏", "💀", "🤣", "😍", "🥺",
];
