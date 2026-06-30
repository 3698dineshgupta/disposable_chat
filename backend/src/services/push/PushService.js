'use strict';

const webpush = require('web-push');
const { supabase } = require('../../config/database');

let _configured = false;

function configure() {
  if (_configured) return;
  const pub  = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const mail = process.env.VAPID_EMAIL || 'mailto:admin@zapchat.app';
  if (!pub || !priv) return; // VAPID keys not configured yet — skip silently
  try {
    webpush.setVapidDetails(mail, pub, priv);
    _configured = true;
  } catch (err) {
    console.warn('[PushService] VAPID configuration failed:', err.message);
  }
}

/**
 * Send a push notification to all subscriptions for a user.
 * Fails silently — push is best-effort, never blocks the main flow.
 */
async function sendToUser(userId, payload) {
  configure();
  if (!_configured) return;

  try {
    const { data: rows } = await supabase
      .from('push_subscriptions')
      .select('id, subscription')
      .eq('user_id', userId);

    if (!rows?.length) return;

    const payloadStr = JSON.stringify(payload);
    const stale = [];

    await Promise.allSettled(
      rows.map(async (row) => {
        try {
          await webpush.sendNotification(row.subscription, payloadStr);
        } catch (err) {
          // 410 Gone = subscription expired, remove it
          if (err.statusCode === 410 || err.statusCode === 404) {
            stale.push(row.id);
          }
        }
      })
    );

    if (stale.length > 0) {
      await supabase.from('push_subscriptions').delete().in('id', stale).catch(() => {});
    }
  } catch (err) {
    console.warn('[PushService] sendToUser failed:', err.message);
  }
}

/**
 * Notify a user of a new message (offline or background tab).
 * The payload does NOT include message content — only metadata.
 */
async function notifyNewMessage({ recipientId, senderName, conversationId, isGroup, groupName }) {
  const title = isGroup ? `${senderName} in ${groupName}` : senderName;
  const body  = 'Sent you a message';

  await sendToUser(recipientId, {
    title,
    body,
    icon: '/icon-192.png',
    tag: `msg-${conversationId}`,
    renotify: false,
    data: { conversationId, type: 'message' },
  });
}

/**
 * Notify a user of an incoming call.
 */
async function notifyIncomingCall({ recipientId, callerName, callType, conversationId }) {
  await sendToUser(recipientId, {
    title: `${callerName} is calling`,
    body: `Incoming ${callType} call`,
    icon: '/icon-192.png',
    tag: `call-${conversationId}`,
    renotify: true,
    data: { conversationId, type: 'call', callType },
    actions: [
      { action: 'answer', title: 'Answer' },
      { action: 'decline', title: 'Decline' },
    ],
  });
}

module.exports = { sendToUser, notifyNewMessage, notifyIncomingCall };
