import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow, format, isToday, isYesterday, parseISO } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMessageTime(timestamp: string): string {
  try {
    const date = parseISO(timestamp);
    return format(date, 'HH:mm');
  } catch {
    return '';
  }
}

export function formatConversationTime(timestamp: string): string {
  try {
    const date = parseISO(timestamp);
    if (isToday(date)) return format(date, 'HH:mm');
    if (isYesterday(date)) return 'Yesterday';
    return format(date, 'dd/MM/yy');
  } catch {
    return '';
  }
}

export function formatLastSeen(timestamp: string, isOnline: boolean): string {
  if (isOnline) return 'online';
  try {
    const date = parseISO(timestamp);
    return `last seen ${formatDistanceToNow(date, { addSuffix: true })}`;
  } catch {
    return 'last seen recently';
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function getFileIcon(mime: string): string {
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime.includes('pdf')) return '📄';
  if (mime.includes('zip') || mime.includes('archive')) return '🗜️';
  if (mime.includes('word')) return '📝';
  if (mime.includes('excel') || mime.includes('spreadsheet')) return '📊';
  return '📎';
}

export function generateId(): string {
  return crypto.randomUUID ? crypto.randomUUID() :
    'xxxx-xxxx-4xxx-yxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

export function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?.*)?$/i.test(url) || url.startsWith('data:image/');
}

export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url) || url.startsWith('data:video/');
}

export function isAudioUrl(url: string): boolean {
  return /\.(mp3|ogg|wav|m4a|webm)(\?.*)?$/i.test(url) || url.startsWith('data:audio/');
}

export function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len) + '…';
}

export function getConversationName(conv: { type: string; name?: string | null; other_display_name?: string }): string {
  if (conv.type === 'group') return conv.name || 'Group';
  return conv.other_display_name || 'Unknown';
}

export function getConversationAvatar(conv: { type: string; avatar_url?: string | null; other_avatar_url?: string | null }): string | null | undefined {
  if (conv.type === 'group') return conv.avatar_url;
  return conv.other_avatar_url;
}
