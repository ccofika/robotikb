// Pravi env/backend.env iz env/backend.env.example za lokalni Security pre-prod (nov uređaj).
// - prazni ključevi označeni sa "<generise se>" dobijaju nasumične lokalne vrednosti (JWT, interni ključ, VAPID)
// - ključevi koji postoje u <koren>/robotikb/.env a fale u šablonu se dodaju PRAZNI (start-backend.js to traži),
//   vrednosti iz produkcionog .env se NIKAD ne prepisuju
// - postojeći env/backend.env se ne dira (obriši ga ručno ako želiš nov)
// Upotreba: node preprod-security/scripts/make-env.js
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Koren projekta: preprod-security je u korenu (<koren>/preprod-security) ili u repou (<koren>/.wt/robotikb/preprod-security)
const PRE_DIR = path.resolve(__dirname, '..');
const ROOT = fs.existsSync(path.join(PRE_DIR, '..', '.wt', 'robotikb')) ? path.resolve(PRE_DIR, '..') : path.resolve(PRE_DIR, '..', '..', '..');
const B = path.join(ROOT, '.wt', 'robotikb');
const EXAMPLE = path.join(PRE_DIR, 'env', 'backend.env.example');
const TARGET = path.join(PRE_DIR, 'env', 'backend.env');

if (fs.existsSync(TARGET)) { console.log(`[env] ${TARGET} već postoji, ne diram ga.`); process.exit(0); }

const lines = fs.readFileSync(EXAMPLE, 'utf8').split(/\r?\n/);
let vapid = null;
try {
  const webpush = require(require.resolve('web-push', { paths: [B] }));
  vapid = webpush.generateVAPIDKeys();
} catch (e) { console.log('[env] web-push nije nađen (npm install u .wt/robotikb), VAPID ostaje prazan: web push je isključen'); }
const gen = {
  JWT_SECRET: () => crypto.randomBytes(32).toString('hex'),
  INTERNAL_API_KEY: () => crypto.randomBytes(16).toString('hex'),
  REVIEW_WEBHOOK_SECRET: () => `preprod-${crypto.randomBytes(8).toString('hex')}`,
  VAPID_PUBLIC_KEY: () => (vapid ? vapid.publicKey : ''),
  VAPID_PRIVATE_KEY: () => (vapid ? vapid.privateKey : '')
};
const have = new Set();
const out = lines.map((l) => {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l);
  if (!m) return l;
  have.add(m[1]);
  if (m[2] === '' && gen[m[1]]) return `${m[1]}=${gen[m[1]]()}`;
  return l;
});
const prodEnv = path.join(ROOT, 'robotikb', '.env');
if (fs.existsSync(prodEnv)) {
  const extra = fs.readFileSync(prodEnv, 'utf8').split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=/.exec(l)).filter(Boolean).map((m) => m[1]).filter((k) => !have.has(k));
  if (extra.length) {
    out.push('', '# Ključevi iz robotikb/.env koji fale u šablonu (prazni, vrednosti se NE prepisuju iz produkcije)');
    extra.forEach((k) => out.push(`${k}=`));
    console.log('[env] dodati prazni ključevi iz robotikb/.env:', extra.join(', '));
  }
}
fs.writeFileSync(TARGET, out.join('\n'));
console.log(`[env] napravljen ${TARGET}`);
