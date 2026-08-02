const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

// Web Push (VAPID) servis — šalje browser push notifikacije adminima na websajtu.
// Ključevi se čitaju iz env varijabli; bez njih je servis tiho ugašen.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:ccofika@gmail.com';

let configured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
    console.log('[WebPush] Servis konfigurisan (VAPID ključevi učitani)');
  } catch (error) {
    console.error('[WebPush] Neispravni VAPID ključevi:', error.message);
  }
} else {
  console.warn('[WebPush] VAPID ključevi nisu postavljeni — web push je ugašen');
}

function isConfigured() {
  return configured;
}

function getPublicKey() {
  return VAPID_PUBLIC_KEY;
}

/**
 * Pošalji push svim pretplatama jednog korisnika.
 * Nikad ne baca grešku — slanje push-a ne sme da obori kreiranje notifikacije.
 * Istekle/obrisane pretplate (404/410) se automatski čiste iz baze.
 */
async function sendToUser(userId, payload) {
  if (!configured || !userId) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  try {
    const subs = await PushSubscription.find({ userId });
    if (subs.length === 0) return { sent, failed };

    const body = JSON.stringify(payload);

    await Promise.all(subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub.subscription, body, { TTL: 3600 });
        sent++;
        PushSubscription.updateOne({ _id: sub._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
      } catch (error) {
        failed++;
        const status = error.statusCode;
        if (status === 404 || status === 410) {
          // Pretplata više ne važi (browser je odjavio) — očisti
          await PushSubscription.deleteOne({ _id: sub._id }).catch(() => {});
          console.log(`[WebPush] Obrisana istekla pretplata (${sub.userName || sub.userId})`);
        } else {
          console.error(`[WebPush] Greška pri slanju (${sub.userName || sub.userId}):`, status || error.message);
        }
      }
    }));
  } catch (error) {
    console.error('[WebPush] Greška u sendToUser:', error.message);
  }
  return { sent, failed };
}

module.exports = { isConfigured, getPublicKey, sendToUser };
