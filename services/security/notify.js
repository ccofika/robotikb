// Obaveštenja Security modula: push na telefon radnika, web obaveštenje (+ web push) i email
const { Technician, Notification } = require('../../models');
const SecurityWorker = require('../../models/SecurityWorker');
const transporter = require('../../config/email');

const ADMIN_NOTIFY_ROLES = ['admin', 'superadmin'];

// Expo push na Android aplikaciju (radnik ili koordinator sa aplikacijom)
async function pushToWorker(worker, { title, body, data = {}, channelId = 'security-alarms', ttl }) {
  try {
    const w = worker && worker.pushToken !== undefined ? worker : await SecurityWorker.findById(worker._id || worker);
    if (!w || !w.pushToken || !w.pushEnabled) return { sent: false, reason: 'no_token' };
    if (!String(w.pushToken).startsWith('ExponentPushToken[')) return { sent: false, reason: 'bad_token' };
    const message = { to: w.pushToken, sound: 'default', title, body, data, priority: 'high', channelId };
    if (ttl) message.ttl = ttl;
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
    const json = await res.json().catch(() => ({}));
    const ticket = Array.isArray(json.data) ? json.data[0] : json.data;
    return { sent: !!(ticket && ticket.status === 'ok') };
  } catch (e) {
    console.error('[Security] push greška:', e.message);
    return { sent: false, reason: e.message };
  }
}

async function adminRecipients() {
  return Technician.find({ role: { $in: ADMIN_NOTIFY_ROLES } }).select('_id name gmail role');
}

async function coordinatorsOf(facilityId) {
  if (!facilityId) return [];
  return SecurityWorker.find({ role: 'coordinator', isActive: true, facilityIds: facilityId }).select('_id name email pushToken pushEnabled');
}

// Web obaveštenje u panelu (web push stiže sam preko hook-a na Notification modelu)
async function webNotify(recipients, { title, message, type = 'security_alarm', priority = 'high', targetPage = '/security', targetId }) {
  const docs = [];
  for (const r of recipients) {
    try {
      docs.push(await Notification.create({
        title, message, type, priority,
        recipientId: r._id,
        targetPage,
        targetId: targetId ? String(targetId) : undefined
      }));
    } catch (e) {
      console.error('[Security] web obaveštenje nije kreirano:', e.message);
    }
  }
  return docs.length;
}

async function sendMail({ to, subject, html, attachments }) {
  const list = [...new Set((to || []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return { sent: false, reason: 'no_recipients' };
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER || 'izvestaji@robotik.rs',
      to: list.join(', '),
      subject,
      html,
      attachments
    });
    return { sent: true, to: list };
  } catch (e) {
    console.error('[Security] email nije poslat:', e.message);
    return { sent: false, reason: e.message, to: list };
  }
}

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Jednostavan email za alarm (MASTER ALARM, drugi alarm za checkpoint, istek ugovora)
function alertEmailHtml({ heading, lines = [], level = 'critical', linkPath = '/security/alarmi' }) {
  const color = level === 'critical' ? '#e5484d' : level === 'warn' ? '#d9900b' : '#0f9f6e';
  const base = process.env.WEB_APP_URL || 'https://administracija.robotik.rs';
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;overflow:hidden">
    <tr><td style="height:4px;background:${color}"></td></tr>
    <tr><td style="padding:22px 24px 8px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#71717a">Robotik Security</td></tr>
    <tr><td style="padding:0 24px 12px;font-size:20px;font-weight:bold">${esc(heading)}</td></tr>
    <tr><td style="padding:0 24px 18px;font-size:14px;line-height:1.6;color:#3f3f46">${lines.map((l) => `<div>${esc(l)}</div>`).join('')}</td></tr>
    <tr><td style="padding:0 24px 24px"><a href="${base}${linkPath}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px">Otvori u aplikaciji</a></td></tr>
  </table></td></tr></table></body></html>`;
}

module.exports = { pushToWorker, adminRecipients, coordinatorsOf, webNotify, sendMail, alertEmailHtml, esc };
