/**
 * File upload handling - local storage (S3-compatible path ready)
 */
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || (file.mimetype?.includes("image") ? ".png" : ".pdf");
    cb(null, `${uuidv4()}${ext}`);
  },
});

const ALLOWED_MIMETYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/webm",
  "audio/ogg",
  "application/octet-stream", // 部分客户端会传此类型，靠扩展名兜底
]);

const ALLOWED_EXT = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf",
  ".mp4", ".webm", ".mp3", ".ogg", ".wav",
]);

export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const mimetype = file.mimetype?.toLowerCase();
    const ext = path.extname(file.originalname || "")?.toLowerCase();
    if (mimetype && ALLOWED_MIMETYPES.has(mimetype)) return cb(null, true);
    if (ext && ALLOWED_EXT.has(ext)) return cb(null, true); // mimetype 缺失或不准时按扩展名放行
    cb(new Error(`Unsupported file type: ${mimetype || "unknown"}${ext ? ` (${ext})` : ""}`));
  },
});

export function getFileUrl(filename: string): string {
  const baseUrl = process.env.API_URL || "http://localhost:3001";
  return `${baseUrl}/uploads/${filename}`;
}
