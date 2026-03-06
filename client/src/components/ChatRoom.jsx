import { useState, useRef, useEffect } from 'react';
import { useRoom } from '../hooks/useRoom';
import { useAuth } from '../contexts/AuthContext';
import { formatDistanceToNow } from 'date-fns';

export default function ChatRoom({ roomId }) {
  const { user } = useAuth();
  const {
    messages,
    members,
    typingUsers,
    loading,
    error,
    encryptionReady,
    keyStatus,
    isOwner,
    roomInfo,
    membership,
    inviteInfo,
    sharingKey,
    roomSetupRequired,
    missingKeyMembersCount,
    loadInviteInfo,
    regenerateInvite,
    generateRoomAccessKey,
    joinWithAccessKey,
    shareRoomKeyWithMissingMembers,
    send,
    notifyTyping,
  } = useRoom(roomId);

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [generatingHash, setGeneratingHash] = useState(false);
  const [accessKeyInput, setAccessKeyInput] = useState('');
  const [joiningWithKey, setJoiningWithKey] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [roomId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || sending || !encryptionReady || roomSetupRequired) return;

    const text = input.trim();
    setInput('');
    setSending(true);

    try {
      await send(text);
    } catch (err) {
      setInput(text);
      console.error('[send]', err);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    notifyTyping();
  };

  const copyInviteLink = async () => {
    try {
      const data = inviteInfo || await loadInviteInfo();
      if (!data?.inviteLink) return;
      await navigator.clipboard.writeText(data.inviteLink);
      alert('Invite link copied');
    } catch {
      alert('Failed to copy invite link');
    }
  };

  const showRoomHash = async () => {
    try {
      const data = inviteInfo || await loadInviteInfo();
      if (!data?.inviteHash) return;
      alert(`Room hash: ${data.inviteHash}`);
    } catch {
      alert('Failed to load room hash');
    }
  };

  const handleRegenerateInvite = async () => {
    try {
      const data = await regenerateInvite();
      await navigator.clipboard.writeText(data.inviteLink);
      alert('Invite regenerated and copied');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to regenerate invite');
    }
  };

  const handleManualKeyShare = async () => {
    try {
      const result = await shareRoomKeyWithMissingMembers();
      alert(`Encryption key shared with ${result.distributed} member(s)`);
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to share keys');
    }
  };

  const handleGenerateAccessKey = async () => {
    setGeneratingHash(true);
    try {
      const data = await generateRoomAccessKey();
      await navigator.clipboard.writeText(data.inviteLink);
      alert('Room access key generated and invite copied');
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to generate room access key');
    } finally {
      setGeneratingHash(false);
    }
  };

  const handleJoinWithAccessKey = async () => {
    if (!accessKeyInput.trim()) return;
    setJoiningWithKey(true);
    try {
      await joinWithAccessKey(accessKeyInput.trim());
      setAccessKeyInput('');
      alert('Access granted');
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Invalid access key');
    } finally {
      setJoiningWithKey(false);
    }
  };

  const needsSetup = !roomInfo?.inviteHash;
  const isRoomReady = !!roomInfo?.inviteHash;
  const hasHashAccess = !!membership?.hasAccess;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          <p className="text-sm text-slate-400">Loading room...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-2">{error}</p>
          <p className="text-sm text-slate-500">You may not have access to this room.</p>
        </div>
      </div>
    );
  }

  if (roomSetupRequired || needsSetup) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md rounded-xl border border-white/[0.08] bg-surface-1 p-6 text-center">
          <h3 className="text-white text-base font-medium mb-2">Room setup incomplete</h3>
          <p className="text-sm text-slate-400 mb-4">Room setup pending - owner must generate access key.</p>
          {isOwner && (
            <button
              onClick={handleGenerateAccessKey}
              disabled={generatingHash}
              className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {generatingHash ? 'Generating...' : 'Generate Room Access Key'}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (isRoomReady && !hasHashAccess) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md rounded-xl border border-white/[0.08] bg-surface-1 p-6 text-center">
          <h3 className="text-white text-base font-medium mb-2">This room requires an access key.</h3>
          <p className="text-sm text-slate-400 mb-4">Paste room access key to continue.</p>
          <div className="flex items-center gap-2">
            <input
              value={accessKeyInput}
              onChange={(e) => setAccessKeyInput(e.target.value)}
              placeholder="Paste access key"
              className="flex-1 rounded-lg border border-white/[0.08] bg-surface-2 px-3 py-2 text-sm text-white outline-none"
            />
            <button
              onClick={handleJoinWithAccessKey}
              disabled={joiningWithKey || !accessKeyInput.trim()}
              className="rounded-lg bg-accent px-3 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {joiningWithKey ? 'Joining...' : 'Join Room'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4 shrink-0 gap-4">
        <div>
          <h2 className="font-medium text-white text-sm">
            {roomInfo?.isPrivate ? 'Private' : 'Public'} room: {roomInfo?.name || 'Room'}
          </h2>
          <p className="text-xs text-slate-500 font-mono mt-0.5">
            {members.length} member{members.length !== 1 ? 's' : ''} -{' '}
            <span className={encryptionReady ? 'text-accent' : 'text-yellow-400'}>
              {isRoomReady ? 'Secure room ready' : 'Room setup pending - owner must generate access key'}
            </span>
          </p>
        </div>

        {isOwner && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button onClick={copyInviteLink} className="rounded-lg border border-white/[0.12] px-3 py-1.5 text-xs text-slate-300 hover:text-white hover:border-white/[0.24] transition">
              Copy Invite Link
            </button>
            <button onClick={showRoomHash} className="rounded-lg border border-white/[0.12] px-3 py-1.5 text-xs text-slate-300 hover:text-white hover:border-white/[0.24] transition">
              Show Room Hash
            </button>
            <button onClick={handleRegenerateInvite} className="rounded-lg border border-white/[0.12] px-3 py-1.5 text-xs text-slate-300 hover:text-white hover:border-white/[0.24] transition">
              Regenerate Invite
            </button>
            {missingKeyMembersCount > 0 && (
              <button
                onClick={handleManualKeyShare}
                disabled={sharingKey}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover disabled:opacity-60 transition"
              >
                {sharingKey ? 'Sharing...' : 'Generate and Share Encryption Key'}
              </button>
            )}
          </div>
        )}
      </header>

      {!encryptionReady && (
        <div className="px-6 py-2 bg-yellow-500/5 border-b border-yellow-500/10 text-xs text-yellow-400 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse" />
          {keyStatus === 'waiting-owner' ? 'Waiting for owner to share key' : 'Loading encryption key...'}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-1">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="rounded-2xl border border-white/[0.06] bg-surface-1 p-6 max-w-sm">
              <p className="text-sm font-medium text-white mb-1">End-to-End Encrypted</p>
              <p className="text-xs text-slate-500">Messages are encrypted in your browser. The server can only see ciphertext.</p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble
            key={msg._id || i}
            message={msg}
            isOwn={msg.isOwn || msg.sender._id === user.id}
            showAvatar={i === 0 || messages[i - 1]?.sender?._id !== msg.sender?._id}
          />
        ))}

        {typingUsers.length > 0 && (
          <div className="text-xs text-slate-500">{typingUsers.join(', ')} typing</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-white/[0.06] px-6 py-4 shrink-0">
        <form onSubmit={handleSubmit} className="flex items-end gap-3">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
              maxLength={2000}
              disabled={!encryptionReady || roomSetupRequired}
              placeholder={
                encryptionReady
                  ? 'Type a message... (Enter to send)'
                  : keyStatus === 'waiting-owner'
                    ? 'Waiting for owner to share key...'
                    : 'Loading encryption key...'
              }
              className="w-full resize-none rounded-xl border border-white/[0.08] bg-surface-2 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/20 max-h-32 overflow-y-auto disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ lineHeight: '1.5' }}
            />
          </div>
          <button
            type="submit"
            disabled={!input.trim() || sending || !encryptionReady || roomSetupRequired}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending ? (
              <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            ) : (
              <SendIcon className="h-4 w-4" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ message, isOwn, showAvatar }) {
  const senderName = message.sender?.username || 'Unknown';
  const content = message.decryptedContent;
  const hasError = message.decryptError;
  const time = message.createdAt ? formatDistanceToNow(new Date(message.createdAt), { addSuffix: true }) : '';

  return (
    <div className={`flex gap-2.5 ${isOwn ? 'flex-row-reverse' : 'flex-row'} animate-slide-up`}>
      {!isOwn && (
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs text-slate-300 self-end ${showAvatar ? 'visible' : 'invisible'}`}>
          {senderName[0].toUpperCase()}
        </div>
      )}

      <div className={`max-w-[70%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
        {showAvatar && !isOwn && <span className="text-[11px] text-slate-500 px-1">{senderName}</span>}
        <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${isOwn ? 'bg-accent text-white rounded-br-md' : hasError ? 'bg-red-500/10 border border-red-500/20 text-red-400 rounded-bl-md' : 'bg-surface-2 text-slate-200 rounded-bl-md'}`}>
          <span className="whitespace-pre-wrap break-words">{content}</span>
        </div>
        <span className={`text-[10px] text-slate-600 px-1 ${isOwn ? 'text-right' : 'text-left'}`}>{time}</span>
      </div>
    </div>
  );
}

function SendIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>
  );
}
