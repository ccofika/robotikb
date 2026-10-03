// Mejlovi koje je Security pre-prod backend poslao u lokalni Mailpit (8026): izveštaji smene, MASTER alarm
const MAILPIT_URL = process.env.MAILPIT_URL || 'http://localhost:8026';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(MAILPIT_URL)) throw new Error(`[e2e] MAILPIT_URL mora biti lokalan (dobio: ${MAILPIT_URL})`);

async function getJson(p) {
  const res = await fetch(`${MAILPIT_URL}${p}`);
  if (!res.ok) throw new Error(`[mailpit] ${p} -> ${res.status}`);
  return res.json();
}

// Čeka poruku čiji naslov sadrži sve delove iz `subject` i koja je stigla posle `since` (pravo vreme Mailpit-a)
async function waitForSubject(subject, { since = 0, timeoutMs = 40000 } = {}) {
  const parts = [].concat(subject);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = await getJson('/api/v1/messages?limit=50');
    const m = (data.messages || []).find((x) => parts.every((s) => (x.Subject || '').includes(s)) && new Date(x.Created).getTime() >= since);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`[mailpit] mejl "${parts.join(' + ')}" nije stigao za ${timeoutMs / 1000} s`);
}

module.exports = { MAILPIT_URL, waitForSubject };
