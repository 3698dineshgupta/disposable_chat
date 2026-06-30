'use client';

import { useState } from 'react';
import { Check, CheckCheck, Reply, Trash2, Copy, Download, FileText, Mic } from 'lucide-react';
import type { LocalMessage } from '@/types';
import { formatMessageTime, formatFileSize, formatDuration, isImageUrl, isVideoUrl } from '@/lib/utils';

interface Props {
  msg: LocalMessage;
  isConsecutive?: boolean;
  onReply?: (msg: LocalMessage) => void;
  onDelete?: (msg: LocalMessage, forEveryone: boolean) => void;
  onReact?: (msg: LocalMessage, emoji: string) => void;
  onCopy?: (text: string) => void;
  prevMsg?: LocalMessage;
  nextMsg?: LocalMessage;
}

const QUICK_EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];

function StatusIcon({ status, overlay }: { status: LocalMessage['status']; overlay?: boolean }) {
  const muted = overlay ? 'rgba(255,255,255,0.88)' : 'rgb(var(--text-muted))';
  if (status === 'seen')      return <CheckCheck size={14} style={{ color: overlay ? '#87d3f2' : '#53bdeb' }} />;
  if (status === 'delivered') return <CheckCheck size={14} style={{ color: muted }} />;
  if (status === 'sent')      return <Check      size={14} style={{ color: muted }} />;
  if (status === 'failed')    return <span style={{ color: overlay ? '#ffaaaa' : '#ff3b3b', fontSize: 12, fontWeight: 700 }}>!</span>;
  return <Check size={14} style={{ color: muted }} />;
}

export default function MessageBubble({ msg, isConsecutive, onReply, onDelete, onReact, onCopy }: Props) {
  const [hovered, setHovered]           = useState(false);
  const [showDeleteMenu, setDeleteMenu] = useState(false);

  if (msg.deletedForMe) return null;

  if (msg.type === 'system') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0' }}>
        <span style={{
          background: 'rgba(var(--chat-bg), 0.92)',
          backdropFilter: 'blur(8px)',
          color: 'rgb(var(--text-secondary))',
          fontSize: 12, borderRadius: 8, padding: '5px 14px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
        }}>
          {msg.text}
        </span>
      </div>
    );
  }

  const isMine    = msg.isMine;
  const isDeleted = msg.deletedForEveryone;

  // CSS-variable-based colours — work in both light and dark mode
  const bubbleBg   = isMine ? 'rgb(var(--chat-mine))' : 'rgb(var(--chat-theirs))';
  const textColor  = 'rgb(var(--text-primary))';
  const metaColor  = 'rgb(var(--text-muted))';

  // Tail using CSS variable colour in border trick
  const tailStyle: React.CSSProperties = {
    position: 'absolute', bottom: 0,
    width: 0, height: 0,
    ...(isMine
      ? { right: -7, borderTop: '10px solid transparent', borderLeft: `10px solid ${bubbleBg}` }
      : { left: -7, borderTop: '10px solid transparent', borderRight: `10px solid ${bubbleBg}` }),
  };

  const hasMedia   = !!(msg.mediaUrl || msg.type !== 'text');
  const isImageMsg = !msg.deletedForEveryone && !!msg.mediaUrl && (msg.type === 'image' || isImageUrl(msg.mediaUrl));

  return (
    <div
      style={{
        display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start',
        marginTop: isConsecutive ? 2 : 8,
        padding: '0 6% 0 5%',
        position: 'relative',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ maxWidth: '65%', display: 'flex', flexDirection: 'column', alignItems: isMine ? 'flex-end' : 'flex-start', gap: 2 }}>

        {/* Reply preview */}
        {msg.replyTo && (
          <div style={{
            fontSize: 12, padding: '4px 10px', borderRadius: 6,
            borderLeft: '3px solid #00a884',
            background: isMine ? 'rgba(0,0,0,0.07)' : 'rgba(0,0,0,0.04)',
            color: 'rgb(var(--text-secondary))',
            maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginBottom: 2,
          }}>
            ↩ Replying
          </div>
        )}

        {/* Bubble */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 4 }}>
          {/* Hover action toolbar */}
          {hovered && !isDeleted && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 1,
              order: isMine ? -1 : 1,
              background: 'rgb(var(--bg-elevated))',
              border: '1px solid rgba(var(--chat-border), 0.5)',
              borderRadius: 20, padding: '3px 5px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              zIndex: 10,
            }}>
              {QUICK_EMOJIS.slice(0, 4).map((e) => (
                <button key={e} onClick={() => onReact?.(msg, e)}
                  style={{ fontSize: 14, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 3px', borderRadius: 6, lineHeight: 1, transition: 'transform 0.1s' }}
                  onMouseEnter={(el) => (el.currentTarget.style.transform = 'scale(1.25)')}
                  onMouseLeave={(el) => (el.currentTarget.style.transform = 'scale(1)')}
                >{e}</button>
              ))}
              <div style={{ width: 1, height: 14, background: 'rgba(var(--chat-border), 0.6)', margin: '0 1px' }} />
              <ActionBtn onClick={() => onReply?.(msg)} title="Reply"><Reply size={13} /></ActionBtn>
              {msg.text && <ActionBtn onClick={() => { navigator.clipboard.writeText(msg.text!); onCopy?.(msg.text!); }} title="Copy"><Copy size={13} /></ActionBtn>}
              {isMine && <ActionBtn onClick={() => setDeleteMenu(true)} title="Delete" danger><Trash2 size={13} /></ActionBtn>}
            </div>
          )}

          <div style={{
            position: 'relative',
            background: bubbleBg,
            borderRadius: isConsecutive
              ? (isMine ? '12px 4px 4px 12px' : '4px 12px 12px 4px')
              : (isMine ? '12px 4px 12px 12px' : '4px 12px 12px 12px'),
            padding: isImageMsg ? '0' : (hasMedia ? '3px 3px 24px' : '7px 12px 22px'),
            boxShadow: '0 1px 1px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.06)',
            minWidth: isImageMsg ? undefined : 60,
            maxWidth: '100%',
          }}>
            {/* Tail — only on first bubble in a group */}
            {!isConsecutive && <div style={tailStyle} />}

            {isDeleted ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px', color: metaColor, fontStyle: 'italic', fontSize: 13 }}>
                <Trash2 size={13} />
                <span>This message was deleted</span>
              </div>
            ) : (
              <>
                {/* Image */}
                {isImageMsg && (
                  <ImageBubble
                    src={msg.mediaUrl!}
                    fileName={msg.fileName}
                    text={msg.text}
                    textColor={textColor}
                    isMine={isMine}
                    isConsecutive={isConsecutive}
                    timestamp={msg.timestamp}
                    status={msg.status}
                  />
                )}

                {/* Video */}
                {msg.mediaUrl && isVideoUrl(msg.mediaUrl) && (
                  <div style={{ borderRadius: 8, overflow: 'hidden', maxWidth: 280 }}>
                    <video src={msg.mediaUrl} controls style={{ width: '100%', maxHeight: 200, display: 'block' }} />
                  </div>
                )}

                {/* Voice */}
                {msg.type === 'voice' && msg.mediaUrl && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px 4px', minWidth: 200 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(0,168,132,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Mic size={16} color="#00a884" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <audio controls src={msg.mediaUrl} style={{ height: 28, width: '100%' }} />
                      {msg.duration && <span style={{ fontSize: 10, color: metaColor }}>{formatDuration(msg.duration)}</span>}
                    </div>
                  </div>
                )}

                {/* File */}
                {(msg.type === 'file' || (msg.fileName && !msg.mediaUrl?.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm|mov)$/i))) && (
                  <a href={msg.mediaUrl || '#'} download={msg.fileName}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px 4px', textDecoration: 'none', minWidth: 220 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(0,168,132,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <FileText size={20} color="#00a884" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msg.fileName || 'File'}</p>
                      {msg.fileSize && <p style={{ margin: 0, fontSize: 11, color: metaColor }}>{formatFileSize(msg.fileSize)}</p>}
                    </div>
                    <Download size={16} color="rgb(var(--text-muted))" />
                  </a>
                )}

                {/* Text */}
                {msg.text && msg.type === 'text' && (
                  <p style={{ margin: 0, fontSize: 14.5, color: textColor, lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                    {msg.text}
                    <span style={{ display: 'inline-block', width: 54 }} />
                  </p>
                )}
              </>
            )}

            {/* Timestamp + status — hidden for image messages (ImageBubble renders its own overlay) */}
            {!isImageMsg && (
              <div style={{
                position: 'absolute', bottom: 4, right: 8,
                display: 'flex', alignItems: 'center', gap: 3,
              }}>
                <span style={{ fontSize: 10.5, color: metaColor, whiteSpace: 'nowrap' }}>
                  {formatMessageTime(msg.timestamp)}
                </span>
                {isMine && <StatusIcon status={msg.status} />}
              </div>
            )}
          </div>
        </div>

        {/* Reactions */}
        {msg.reactions.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 2, justifyContent: isMine ? 'flex-end' : 'flex-start' }}>
            {Object.entries(
              msg.reactions.reduce<Record<string, number>>((acc, r) => { acc[r.emoji] = (acc[r.emoji] ?? 0) + 1; return acc; }, {})
            ).map(([emoji, count]) => (
              <button key={emoji} onClick={() => onReact?.(msg, emoji)} style={{
                background: 'rgb(var(--bg-elevated))',
                border: '1px solid rgba(var(--chat-border), 0.5)',
                borderRadius: 12, padding: '2px 7px', fontSize: 13, cursor: 'pointer',
                color: textColor, display: 'flex', alignItems: 'center', gap: 3,
                boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
              }}>
                {emoji}{count > 1 && <span style={{ fontSize: 11, opacity: 0.6 }}>{count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Delete dialog */}
      {showDeleteMenu && (
        <div
          onClick={() => setDeleteMenu(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'rgb(var(--bg-elevated))', borderRadius: 18, padding: '24px',
            width: 300, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            border: '1px solid rgba(var(--chat-border), 0.3)',
          }}>
            <p style={{ margin: '0 0 18px', fontWeight: 600, fontSize: 16, color: 'rgb(var(--text-primary))', textAlign: 'center' }}>Delete message?</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'Delete for me', action: () => { onDelete?.(msg, false); setDeleteMenu(false); }, bg: 'rgba(var(--chat-border), 0.4)', color: 'rgb(var(--text-primary))' },
                { label: 'Delete for everyone', action: () => { onDelete?.(msg, true); setDeleteMenu(false); }, bg: '#ff3b3b', color: '#fff' },
              ].map(({ label, action, bg, color }) => (
                <button key={label} onClick={action} style={{
                  padding: '13px', borderRadius: 12, border: 'none', cursor: 'pointer',
                  background: bg, color, fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
                }}>{label}</button>
              ))}
              <button onClick={() => setDeleteMenu(false)} style={{
                padding: '10px', borderRadius: 12, border: 'none', cursor: 'pointer',
                background: 'transparent', color: 'rgb(var(--text-muted))', fontSize: 14, fontFamily: 'inherit',
              }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ImageBubble({
  src, fileName, text, textColor, isMine, isConsecutive, timestamp, status,
}: {
  src: string; fileName?: string | null; text?: string | null; textColor: string;
  isMine: boolean; isConsecutive?: boolean;
  timestamp: LocalMessage['timestamp']; status: LocalMessage['status'];
}) {
  const [lightbox, setLightbox] = useState(false);
  const [loaded,   setLoaded]   = useState(false);
  const [failed,   setFailed]   = useState(false);

  const hasCaption = !!(text && text.trim());

  // The image container clips itself using border-radius + overflow:hidden.
  // The parent bubble must NOT have overflow:hidden so the CSS-border tail is not clipped.
  // When there's a caption the image only rounds the top corners; the bottom is straight.
  const bubbleRadius = isConsecutive
    ? (isMine ? '12px 4px 4px 12px' : '4px 12px 12px 4px')
    : (isMine ? '12px 4px 12px 12px' : '4px 12px 12px 12px');

  const imgRadius = hasCaption
    ? (isConsecutive
      ? (isMine ? '12px 4px 0 0' : '4px 12px 0 0')
      : (isMine ? '12px 4px 0 0' : '4px 12px 0 0'))
    : bubbleRadius;

  return (
    <>
      {/* ── Full-screen lightbox ── */}
      {lightbox && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.93)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setLightbox(false)}
        >
          <img
            src={src}
            alt={fileName || 'Image'}
            style={{ maxWidth: '95vw', maxHeight: '82vh', objectFit: 'contain', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
            onClick={(e) => e.stopPropagation()}
          />
          <div style={{ marginTop: 20 }}>
            <a
              href={src}
              download={fileName ?? 'image'}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 24px',
                background: 'rgba(255,255,255,0.16)', backdropFilter: 'blur(8px)',
                borderRadius: 24, textDecoration: 'none',
                color: '#fff', fontSize: 14, fontWeight: 500,
              }}
            >
              <Download size={16} /> Download
            </a>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 14 }}>Tap anywhere to close</p>
        </div>
      )}

      {/* ── Image thumbnail — self-clips to avoid clipping the parent bubble's tail ── */}
      <div
        style={{ position: 'relative', width: 260, borderRadius: imgRadius, overflow: 'hidden', cursor: 'pointer' }}
        onClick={() => setLightbox(true)}
      >
        {/* Skeleton / error placeholder */}
        {!loaded && (
          <div style={{
            width: 260, height: 200,
            background: failed ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.05)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            {failed ? (
              <span style={{ fontSize: 12, color: 'rgba(128,128,128,0.7)' }}>Image unavailable</span>
            ) : (
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                border: '3px solid rgba(0,0,0,0.08)',
                borderTopColor: '#00a884',
                animation: 'imgSpin 0.8s linear infinite',
              }} />
            )}
          </div>
        )}

        <img
          src={src}
          alt={fileName || 'Image'}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          style={{ width: '100%', maxHeight: 300, objectFit: 'cover', display: loaded ? 'block' : 'none' }}
        />

        {/* Gradient + timestamp overlaid on image when no caption */}
        {loaded && !hasCaption && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            background: 'linear-gradient(transparent, rgba(0,0,0,0.48))',
            padding: '28px 8px 5px',
            display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.92)', whiteSpace: 'nowrap' }}>
                {formatMessageTime(timestamp)}
              </span>
              {isMine && <StatusIcon status={status} overlay />}
            </div>
          </div>
        )}
      </div>

      {/* Caption + timestamp (sits below the image inside the same bubble) */}
      {hasCaption && (
        <div style={{
          padding: '6px 10px 26px',
          fontSize: 14.5, color: textColor, lineHeight: 1.5,
          wordBreak: 'break-word', whiteSpace: 'pre-wrap',
          position: 'relative', minWidth: 60,
        }}>
          {text}
          <span style={{ display: 'inline-block', width: 54 }} />
          <div style={{ position: 'absolute', bottom: 4, right: 8, display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 10.5, color: 'rgb(var(--text-muted))', whiteSpace: 'nowrap' }}>
              {formatMessageTime(timestamp)}
            </span>
            {isMine && <StatusIcon status={status} />}
          </div>
        </div>
      )}

      <style>{`@keyframes imgSpin { to { transform: rotate(360deg) } }`}</style>
    </>
  );
}

function ActionBtn({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title?: string; danger?: boolean }) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 26, height: 26, borderRadius: 7, background: 'none', border: 'none',
      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: danger ? '#ef4444' : 'rgb(var(--text-secondary))',
      transition: 'background 0.1s',
    }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(var(--chat-border), 0.5)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
    >{children}</button>
  );
}
