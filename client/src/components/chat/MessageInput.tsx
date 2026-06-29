'use client';

import { useState, useRef } from 'react';
import { Smile, Paperclip, Mic, Send, X, Image as ImageIcon, FileText, Reply } from 'lucide-react';
import dynamic from 'next/dynamic';
import type { LocalMessage, MessageType } from '@/types';
import { useTyping } from '@/hooks/useSocket';
import { usersApi } from '@/lib/api';
import VoiceRecorder from './VoiceRecorder';
import toast from 'react-hot-toast';

const EmojiPickerComponent = dynamic(() => import('emoji-picker-react'), { ssr: false });

interface Props {
  conversationId: string;
  replyingTo: LocalMessage | null;
  onClearReply: () => void;
  onSend: (text: string, type?: MessageType, extra?: {
    mediaUrl?: string; storagePath?: string | null; fileName?: string; fileSize?: number; fileMime?: string; duration?: number; replyTo?: string;
  }) => void;
  disabled?: boolean;
}

export default function MessageInput({ conversationId, replyingTo, onClearReply, onSend, disabled }: Props) {
  const [text, setText]             = useState('');
  const [showEmoji, setShowEmoji]   = useState(false);
  const [showVoice, setShowVoice]   = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [uploadPct, setUploadPct]   = useState(0);
  const textareaRef                 = useRef<HTMLTextAreaElement>(null);
  const { startTyping, stopTyping } = useTyping(conversationId);

  const adjustHeight = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    adjustHeight();
    startTyping();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    if (e.key === 'Escape' && replyingTo) onClearReply();
  };

  const doSend = () => {
    const t = text.trim();
    if (!t) return;
    stopTyping();
    onSend(t, 'text', replyingTo ? { replyTo: replyingTo.localId } : undefined);
    setText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setShowEmoji(false);
    onClearReply();
  };

  const handleFile = async (file: File) => {
    setShowAttach(false);
    setUploading(true);
    setUploadPct(0);
    try {
      const res = await usersApi.uploadMedia(file, (pct) => setUploadPct(pct));
      const { url, storagePath, name, size, type: mime } = res.data;
      const msgType: MessageType = mime.startsWith('image') ? 'image' : mime.startsWith('video') ? 'video' : mime.startsWith('audio') ? 'audio' : 'file';
      onSend(name, msgType, { mediaUrl: url, storagePath, fileName: name, fileSize: size, fileMime: mime, replyTo: replyingTo?.localId });
      onClearReply();
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  };

  const handleVoiceSend = async (blob: Blob, duration: number) => {
    setShowVoice(false);
    setUploading(true);
    setUploadPct(0);
    try {
      const file = new File([blob], 'voice.webm', { type: 'audio/webm' });
      const res = await usersApi.uploadMedia(file, (pct) => setUploadPct(pct));
      onSend('Voice message', 'voice', { mediaUrl: res.data.url, storagePath: res.data.storagePath, fileName: 'voice.webm', fileSize: blob.size, fileMime: 'audio/webm', duration });
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  };

  const hasText = text.trim().length > 0;

  return (
    <div style={{
      position: 'relative',
      background: 'rgb(var(--chat-header))',
      borderTop: '1px solid rgba(var(--chat-border), 0.6)',
    }}>

      {/* Upload progress */}
      {uploading && (
        <>
          {/* thin progress bar at top */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'rgba(var(--chat-border), 0.3)' }}>
            <div style={{
              height: '100%',
              width: `${uploadPct}%`,
              background: 'rgb(var(--brand))',
              borderRadius: 2,
              transition: 'width 0.2s ease',
            }} />
          </div>
          {/* percentage label */}
          <div style={{
            position: 'absolute', top: 3, left: 0, right: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '6px 16px',
            background: 'rgba(var(--bg-elevated), 0.95)',
            backdropFilter: 'blur(4px)',
            borderBottom: '1px solid rgba(var(--chat-border), 0.3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 120, height: 4, borderRadius: 4, background: 'rgba(var(--chat-border), 0.4)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${uploadPct}%`, background: 'rgb(var(--brand))', borderRadius: 4, transition: 'width 0.2s ease' }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'rgb(var(--brand))', minWidth: 38 }}>
                {uploadPct}%
              </span>
              <span style={{ fontSize: 11, color: 'rgb(var(--text-muted))' }}>Uploading…</span>
            </div>
          </div>
          {/* spacer so content doesn't overlap the label */}
          <div style={{ height: 34 }} />
        </>
      )}

      {/* Reply strip */}
      {replyingTo && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 16px',
          background: 'rgba(var(--brand), 0.06)',
          borderLeft: '4px solid rgb(var(--brand))',
        }}>
          <Reply size={15} style={{ color: 'rgb(var(--brand))', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'rgb(var(--brand))' }}>
              {replyingTo.isMine ? 'You' : 'User'}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: 'rgb(var(--text-secondary))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {replyingTo.text ?? 'Media'}
            </p>
          </div>
          <button onClick={onClearReply} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgb(var(--text-muted))', flexShrink: 0, display: 'flex', padding: 4, borderRadius: 50 }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(var(--chat-border), 0.5)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
            <X size={15} />
          </button>
        </div>
      )}

      {/* Voice recorder */}
      {showVoice ? (
        <div style={{ padding: '8px 12px' }}>
          <VoiceRecorder onSend={handleVoiceSend} onCancel={() => setShowVoice(false)} />
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, padding: '8px 10px' }}>

          {/* Emoji picker */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <InputIconBtn onClick={() => setShowEmoji((v) => !v)} active={showEmoji} title="Emoji">
              <Smile size={22} />
            </InputIconBtn>
            {showEmoji && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setShowEmoji(false)} />
                <div style={{ position: 'absolute', bottom: 52, left: 0, zIndex: 50, borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.15)', border: '1px solid rgba(var(--chat-border), 0.5)' }}>
                  <EmojiPickerComponent
                    onEmojiClick={(e) => { setText((t) => t + e.emoji); textareaRef.current?.focus(); }}
                    height={360} width={320}
                  />
                </div>
              </>
            )}
          </div>

          {/* Attach menu */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <InputIconBtn onClick={() => setShowAttach((v) => !v)} active={showAttach} title="Attach">
              <Paperclip size={21} />
            </InputIconBtn>
            {showAttach && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setShowAttach(false)} />
                <div style={{
                  position: 'absolute', bottom: 52, left: 0, zIndex: 50,
                  background: 'rgb(var(--bg-elevated))',
                  borderRadius: 16, padding: '8px',
                  border: '1px solid rgba(var(--chat-border), 0.4)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                  display: 'flex', gap: 4,
                }}>
                  {[
                    { icon: ImageIcon, label: 'Photos & Videos', accept: 'image/*,video/*' },
                    { icon: FileText,  label: 'Document',        accept: '*' },
                  ].map(({ icon: Icon, label, accept }) => (
                    <button key={label}
                      onClick={() => {
                        const inp = document.createElement('input');
                        inp.type = 'file'; inp.accept = accept;
                        inp.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleFile(f); };
                        inp.click(); setShowAttach(false);
                      }}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '10px 14px', borderRadius: 12, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.1s' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(var(--chat-border), 0.4)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                    >
                      <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(var(--brand), 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon size={20} color="rgb(var(--brand))" />
                      </div>
                      <span style={{ fontSize: 11, color: 'rgb(var(--text-secondary))', whiteSpace: 'nowrap' }}>{label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Text input pill */}
          <div style={{
            flex: 1,
            background: 'rgb(var(--bg-elevated))',
            borderRadius: 24,
            border: '1px solid rgba(var(--chat-border), 0.4)',
            display: 'flex', alignItems: 'flex-end',
            padding: '0 12px',
            minHeight: 42,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onBlur={stopTyping}
              placeholder={disabled ? 'Waiting for encryption keys…' : 'Type a message'}
              disabled={disabled}
              rows={1}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                resize: 'none', color: 'rgb(var(--text-primary))',
                fontSize: 14.5, lineHeight: 1.5,
                padding: '10px 0',
                maxHeight: 120,
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Send / Mic button */}
          <button
            onClick={hasText ? doSend : () => setShowVoice(true)}
            disabled={disabled}
            title={hasText ? 'Send' : 'Voice message'}
            style={{
              width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
              background: 'rgb(var(--brand))',
              border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(var(--brand), 0.35)',
              opacity: disabled ? 0.5 : 1,
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.transform = 'scale(1.07)'; } }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
          >
            {hasText ? <Send size={18} color="#fff" /> : <Mic size={18} color="#fff" />}
          </button>
        </div>
      )}

      <style>{`textarea::placeholder { color: rgb(var(--text-muted)); }`}</style>
    </div>
  );
}

function InputIconBtn({ children, onClick, active, title }: { children: React.ReactNode; onClick: () => void; active?: boolean; title?: string }) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 40, height: 40, borderRadius: '50%',
      background: active ? 'rgba(var(--brand), 0.1)' : 'none',
      border: 'none', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: active ? 'rgb(var(--brand))' : 'rgb(var(--text-secondary))',
      transition: 'background 0.15s, color 0.15s',
    }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(var(--chat-border), 0.5)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = active ? 'rgba(var(--brand), 0.1)' : 'none'; }}
    >{children}</button>
  );
}
