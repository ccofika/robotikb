// Zajedničko za Security rute
const mongoose = require('mongoose');

// Hvata greške iz async ruta i vraća jasnu poruku
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  if (e && e.status) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
  if (e && e.name === 'ValidationError') return res.status(400).json({ error: Object.values(e.errors).map((x) => x.message).join(', ') });
  if (e && e.code === 11000) return res.status(409).json({ error: 'Već postoji zapis sa istim podatkom (npr. isto ime ili isti tag).' });
  console.error('[Security API]', req.method, req.originalUrl, e);
  return res.status(500).json({ error: 'Greška na serveru. Pokušaj ponovo.' });
});

function httpError(status, message, extra) {
  const e = new Error(message);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
function requireId(v, what = 'zapis') {
  if (!isId(v)) throw httpError(400, `Neispravan id (${what}).`);
  return v;
}

const str = (v, max = 2000) => String(v == null ? '' : v).trim().slice(0, max);
const isHHMM = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''));
const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || '').trim());

module.exports = { ah, httpError, isId, requireId, str, isHHMM, isYmd, isEmail };
