import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import api from '../utils/api';
import { generateRoomKey, encryptMessage, safeDecrypt } from '../crypto/encryption';
import { unwrapAesKey, wrapAesKey, importRsaPublicKey } from '../crypto/keyManager';
import { getRoomKey, setRoomKey, hasRoomKey } from '../crypto/roomKeyStore';

const joinedRoomRefCounts = new Map();
const leaveRoomTimers = new Map();

export function useRoom(roomId) {
  const { user, rsaKeyPair } = useAuth();
  const {
    joinRoom,
    leaveRoom,
    sendMessage,
    sendTyping,
    onMessage,
    onTyping,
    onUserJoined,
    onMemberJoined,
    onUserLeft,
    onRoomKeyReceived,
    onRoomKeyShared,
    distributeRoomKey,
  } = useSocket();

  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [encryptionReady, setEncryptionReady] = useState(false);
  const [keyStatus, setKeyStatus] = useState('loading');
  const [sharingKey, setSharingKey] = useState(false);
  const [roomInfo, setRoomInfo] = useState(null);
  const [inviteInfo, setInviteInfo] = useState(null);
  const [roomSetupRequired, setRoomSetupRequired] = useState(false);
  const [membership, setMembership] = useState(null);

  const typingTimeoutRef = useRef(null);
  const isTypingRef = useRef(false);
  const roomIdRef = useRef(roomId);
  const rsaKeyPairRef = useRef(rsaKeyPair);
  const userRef = useRef(user);
  const distributedKeyTargetsRef = useRef(new Set());

  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);
  useEffect(() => { rsaKeyPairRef.current = rsaKeyPair; }, [rsaKeyPair]);
  useEffect(() => { userRef.current = user; }, [user]);

  const getCurrentUserId = useCallback(
    () => (userRef.current?.id || userRef.current?._id || '').toString(),
    []
  );

  const ensureJoinedRealtime = useCallback(async () => {
    const rid = roomIdRef.current;
    const prevCount = joinedRoomRefCounts.get(rid) || 0;
    if (prevCount > 0) return;
    await joinRoom(rid);
    joinedRoomRefCounts.set(rid, 1);
  }, [joinRoom]);

  const fetchMessages = useCallback(async () => {
    const { data: msgData } = await api.get(`/rooms/${roomIdRef.current}/messages?page=1&limit=50`);
    const rk = getRoomKey(roomIdRef.current);
    const uid = getCurrentUserId();

    const decrypted = await Promise.all(msgData.messages.map(async (m) => {
      const sId = m.sender?._id?.toString?.() || m.sender?._id || m.sender;
      if (!rk) return { ...m, decryptedContent: '[Key loading...]', isOwn: sId === uid };
      const pt = await safeDecrypt(rk, m.encryptedContent, m.iv);
      return { ...m, decryptedContent: pt || '[Decryption failed]', isOwn: sId === uid, decryptError: !pt };
    }));

    setMessages(decrypted);
    setHasMore(msgData.hasMore);
  }, [getCurrentUserId]);

  const refreshRoomInfo = useCallback(async () => {
    const { data } = await api.get(`/rooms/${roomIdRef.current}`);
    setRoomInfo(data.room);
    setMembership(data.membership || null);
    return data;
  }, []);

  const loadInviteInfo = useCallback(async () => {
    const { data } = await api.get(`/rooms/${roomIdRef.current}/invite`);
    setInviteInfo(data);
    return data;
  }, []);

  const generateRoomAccessKey = useCallback(async () => {
    const { data } = await api.post(`/rooms/${roomIdRef.current}/generate-hash`);
    setInviteInfo(data);
    setRoomInfo((prev) => ({ ...(prev || {}), inviteHash: data.inviteHash }));
    setRoomSetupRequired(false);
    setKeyStatus('missing');
    setMembership((prev) => ({ ...(prev || {}), hasAccess: true, role: prev?.role || 'admin' }));
    return data;
  }, []);

  const joinWithAccessKey = useCallback(async (inviteHash) => {
    const { data } = await api.post(`/rooms/${roomIdRef.current}/join-with-hash`, { inviteHash });
    if (data?.membership) {
      setMembership({ role: data.membership.role, hasAccess: !!data.membership.hasAccess });
    }
    setRoomSetupRequired(false);
    return data;
  }, []);

  const regenerateInvite = useCallback(async () => {
    const { data } = await api.post(`/rooms/${roomIdRef.current}/invite/regenerate`);
    setInviteInfo(data);
    setRoomInfo((prev) => ({ ...(prev || {}), inviteHash: data.inviteHash }));
    return data;
  }, []);

  const fetchAndStoreMyRoomKey = useCallback(async (attempts = 4) => {
    const privateKey = rsaKeyPairRef.current?.privateKey;
    if (!privateKey) return false;

    for (let i = 0; i < attempts; i += 1) {
      try {
        const { data } = await api.get(`/rooms/${roomIdRef.current}/keys/me`);
        if (data?.encryptedKey) {
          const aesKey = await unwrapAesKey(data.encryptedKey, privateKey);
          setRoomKey(roomIdRef.current, aesKey);
          setEncryptionReady(true);
          setKeyStatus('available');
          return true;
        }
        if (!data?.pending) break;
      } catch (err) {
        if (err?.response?.status !== 404) break;
      }

      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    return false;
  }, []);

  const distributeToKeylessMembers = useCallback(async (currentMembers) => {
    const roomKey = getRoomKey(roomIdRef.current);
    if (!roomKey) return;

    for (const member of currentMembers) {
      const dedupeKey = `${roomIdRef.current}:${member._id}`;
      if (!member.hasKey && member.publicKey && !distributedKeyTargetsRef.current.has(dedupeKey)) {
        distributedKeyTargetsRef.current.add(dedupeKey);
        try {
          const pubKey = await importRsaPublicKey(member.publicKey);
          const encryptedKey = await wrapAesKey(roomKey, pubKey);
          await distributeRoomKey(roomIdRef.current, member._id, encryptedKey);
          member.hasKey = true;
        } catch (err) {
          distributedKeyTargetsRef.current.delete(dedupeKey);
        }
      }
    }
  }, [distributeRoomKey]);

  const refreshMembers = useCallback(async () => {
    const { data } = await api.get(`/rooms/${roomIdRef.current}/members`);
    setMembers(data.members);

    const meId = getCurrentUserId();
    const me = data.members.find((m) => m._id?.toString() === meId);

    if (hasRoomKey(roomIdRef.current)) {
      setKeyStatus('available');
      setEncryptionReady(true);
    } else {
      setEncryptionReady(false);
      setKeyStatus(me?.role === 'admin' ? 'missing' : 'waiting-owner');
    }

    const canAutoShare = me?.role === 'admin' && hasRoomKey(roomIdRef.current);
    if (canAutoShare) {
      distributeToKeylessMembers(data.members);
    }

    return data.members;
  }, [distributeToKeylessMembers, getCurrentUserId]);

  const shareRoomKeyWithMissingMembers = useCallback(async () => {
    if (roomSetupRequired) {
      throw new Error('Room setup incomplete. Generate room access key first.');
    }

    setSharingKey(true);
    try {
      let roomKey = getRoomKey(roomIdRef.current);
      if (!roomKey) {
        roomKey = await generateRoomKey();
        setRoomKey(roomIdRef.current, roomKey);
      }

      const currentMembers = await refreshMembers();
      const entries = [];
      for (const member of currentMembers) {
        if (!member.hasKey && member.publicKey) {
          const pubKey = await importRsaPublicKey(member.publicKey);
          const encryptedKey = await wrapAesKey(roomKey, pubKey);
          entries.push({ userId: member._id, encryptedKey });
        }
      }

      if (entries.length > 0) {
        await api.post(`/rooms/${roomIdRef.current}/keys/distribute`, { keys: entries });
      }

      setKeyStatus('available');
      setEncryptionReady(true);
      await ensureJoinedRealtime();
      await fetchMessages();
      await refreshMembers();

      return { distributed: entries.length };
    } finally {
      setSharingKey(false);
    }
  }, [ensureJoinedRealtime, fetchMessages, refreshMembers, roomSetupRequired]);

  useEffect(() => {
    if (!roomId || !rsaKeyPair) return;

    let mounted = true;

    const init = async () => {
      const pendingLeaveTimer = leaveRoomTimers.get(roomId);
      if (pendingLeaveTimer) {
        clearTimeout(pendingLeaveTimer);
        leaveRoomTimers.delete(roomId);
      }

      setLoading(true);
      setError(null);
      setMessages([]);
      setMembers([]);
      setInviteInfo(null);
      setEncryptionReady(false);
      setKeyStatus('loading');
      distributedKeyTargetsRef.current = new Set();

      try {
        const roomData = await refreshRoomInfo();
        const room = roomData?.room;

        if (!room?.inviteHash) {
          setRoomSetupRequired(true);
          setKeyStatus('missing');
          return;
        }

        const hasHashAccess = dataHasAccess(roomData?.membership);
        if (!hasHashAccess) {
          setRoomSetupRequired(false);
          setKeyStatus('missing');
          return;
        }

        setRoomSetupRequired(false);
        await loadInviteInfo().catch(() => null);

        const keyReady = hasRoomKey(roomId) || await fetchAndStoreMyRoomKey();

        await refreshMembers();

        // Socket join is allowed only when hash exists and room key is available.
        if (keyReady) {
          await ensureJoinedRealtime();
          await fetchMessages();
        } else {
          setKeyStatus('waiting-owner');
        }
      } catch (err) {
        if (mounted) setError(err.message);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    init();

    return () => {
      mounted = false;
      clearTimeout(typingTimeoutRef.current);
      if (isTypingRef.current) {
        isTypingRef.current = false;
        sendTyping(roomId, false);
      }

      const currCount = joinedRoomRefCounts.get(roomId) || 0;
      if (currCount > 0) {
        joinedRoomRefCounts.delete(roomId);
        const timer = setTimeout(() => {
          leaveRoom(roomId);
          leaveRoomTimers.delete(roomId);
        }, 250);
        leaveRoomTimers.set(roomId, timer);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, rsaKeyPair]);

  useEffect(() => {
    const off = onRoomKeyReceived(async ({ roomId: rId, encryptedKey }) => {
      if (roomSetupRequired || !dataHasAccess(membership)) return;
      if (rId !== roomIdRef.current || !rsaKeyPairRef.current?.privateKey || !encryptedKey) return;
      try {
        const aesKey = await unwrapAesKey(encryptedKey, rsaKeyPairRef.current.privateKey);
        setRoomKey(roomIdRef.current, aesKey);
        setEncryptionReady(true);
        setKeyStatus('available');
        await ensureJoinedRealtime();
        await fetchMessages();
        await refreshMembers();
      } catch {
        // noop
      }
    });
    return off;
  }, [ensureJoinedRealtime, fetchMessages, membership, onRoomKeyReceived, refreshMembers, roomSetupRequired]);

  useEffect(() => {
    const off = onRoomKeyShared(async ({ roomId: rId, targetUserId }) => {
      if (roomSetupRequired || !dataHasAccess(membership) || rId !== roomIdRef.current) return;
      const myId = getCurrentUserId();
      if (targetUserId && targetUserId !== myId) return;
      setKeyStatus('loading');
      const ready = await fetchAndStoreMyRoomKey(5);
      if (ready) {
        await ensureJoinedRealtime();
        await fetchMessages();
      }
      await refreshMembers();
    });
    return off;
  }, [ensureJoinedRealtime, fetchAndStoreMyRoomKey, fetchMessages, getCurrentUserId, membership, onRoomKeyShared, refreshMembers, roomSetupRequired]);

  useEffect(() => {
    const off = onMessage(async (msg) => {
      if (roomSetupRequired || !dataHasAccess(membership) || msg.roomId !== roomIdRef.current) return;
      const uid = getCurrentUserId();
      const sId = msg.sender?._id?.toString?.() || msg.sender?._id;
      if (sId === uid) {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.optimistic && m.encryptedContent === msg.encryptedContent);
          if (idx !== -1) {
            const up = [...prev];
            up[idx] = { ...up[idx], _id: msg._id, createdAt: msg.createdAt, optimistic: false };
            return up;
          }
          return prev;
        });
        return;
      }

      const rk = getRoomKey(roomIdRef.current);
      if (!rk) return;

      const pt = await safeDecrypt(rk, msg.encryptedContent, msg.iv);
      setMessages((prev) => [...prev, { ...msg, decryptedContent: pt || '[Decrypt fail]', isOwn: false, decryptError: !pt }]);
    });
    return off;
  }, [getCurrentUserId, membership, onMessage, roomSetupRequired]);

  useEffect(() => {
    const off = onTyping(({ roomId: rId, username, isTyping }) => {
      if (roomSetupRequired || !dataHasAccess(membership) || rId !== roomIdRef.current) return;
      setTypingUsers((prev) => {
        if (isTyping) return prev.includes(username) ? prev : [...prev, username];
        return prev.filter((u) => u !== username);
      });
    });
    return off;
  }, [membership, onTyping, roomSetupRequired]);

  useEffect(() => {
    const handleMemberJoin = ({ roomId: rId }) => {
      if (roomSetupRequired || !dataHasAccess(membership)) return;
      if (rId === roomIdRef.current) {
        setTimeout(() => refreshMembers(), 500);
      }
    };

    const offJoin = onUserJoined(handleMemberJoin);
    const offMemberJoined = onMemberJoined(handleMemberJoin);
    const offLeave = onUserLeft(({ roomId: rId }) => {
      if (roomSetupRequired || !dataHasAccess(membership)) return;
      if (rId === roomIdRef.current) refreshMembers();
    });

    return () => { offJoin(); offMemberJoined(); offLeave(); };
  }, [membership, onMemberJoined, onUserJoined, onUserLeft, refreshMembers, roomSetupRequired]);

  const send = useCallback(async (plaintext) => {
    if (roomSetupRequired) throw new Error('Room setup incomplete.');
    if (!dataHasAccess(membership)) throw new Error('Room access key required.');
    if (!plaintext.trim()) return;

    const rk = getRoomKey(roomIdRef.current);
    if (!rk) throw new Error('Wait for key distribution...');

    const { encryptedContent, iv } = await encryptMessage(rk, plaintext);
    await sendMessage({ roomId: roomIdRef.current, encryptedContent, iv, keyVersion: 0 });
    setMessages((prev) => [...prev, {
      _id: Date.now().toString(),
      sender: { _id: userRef.current.id || userRef.current._id, username: userRef.current.username },
      encryptedContent,
      iv,
      decryptedContent: plaintext,
      isOwn: true,
      createdAt: new Date().toISOString(),
      optimistic: true,
    }]);
  }, [membership, roomSetupRequired, sendMessage]);

  const notifyTyping = useCallback(() => {
    if (roomSetupRequired || !dataHasAccess(membership)) return;
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      sendTyping(roomIdRef.current, true);
    }
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      sendTyping(roomIdRef.current, false);
    }, 2000);
  }, [membership, roomSetupRequired, sendTyping]);

  const currentUserId = getCurrentUserId();
  const isOwner = roomInfo?.createdBy?._id?.toString() === currentUserId || roomInfo?.createdBy?.toString?.() === currentUserId;
  const missingKeyMembersCount = members.filter((m) => !m.hasKey).length;

  return {
    messages,
    members,
    typingUsers,
    loading,
    error,
    hasMore,
    encryptionReady,
    keyStatus,
    isOwner,
    roomInfo,
    inviteInfo,
    sharingKey,
    roomSetupRequired,
    membership,
    missingKeyMembersCount,
    loadInviteInfo,
    regenerateInvite,
    generateRoomAccessKey,
    joinWithAccessKey,
    shareRoomKeyWithMissingMembers,
    send,
    notifyTyping,
  };
}

function dataHasAccess(membership) {
  return !!membership?.hasAccess;
}
