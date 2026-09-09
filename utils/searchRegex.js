/**
 * Pomoćne funkcije za pretragu preko $regex-a.
 *
 * Podaci u bazi su nedosledni na dva načina koja ruše naivnu pretragu:
 *  1. dijakritika — adrese i imena su upisani sa kvržicama ("TUCOVIĆA"),
 *     a korisnici najčešće kucaju bez njih ("tucovica")
 *  2. razmaci — kućni broj je često odvojen sa 2-3 razmaka
 *     ("STEVANA TUCOVIĆA   9"), pa unos sa jednim razmakom ne poklapa
 *
 * Zato pojam pretrage PROŠIRUJEMO (ne možemo normalizovati sačuvanu vrednost
 * unutar $regex upita). Suprotno od foldName u routes/auth.js, koji normalizuje
 * vrednost radi tačnog poređenja u JS-u.
 */

// Srpske grupe slova — kucanje bez kvržica nalazi zapis sa njima i obrnuto
const LETTER_GROUPS = ['cčć', 'sš', 'zž', 'dđ'];

const CHAR_CLASS = {};
LETTER_GROUPS.forEach(group => {
  for (const ch of group) CHAR_CLASS[ch] = group;
});

/** Escape korisničkog unosa — bez ovoga "(061" ili "[abc" obori RegExp. */
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Tekstualna pretraga tolerantna na dijakritiku i višestruke razmake.
 * "tucovica 9" nalazi "STEVANA TUCOVIĆA   9".
 * Rezultat je nadskup običnog escape-ovanog poklapanja, pa ga bezbedno menja.
 */
const looseTextRegex = (term) => {
  const t = String(term || '').trim();
  if (!t) return null;

  let out = '';
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];

    if (/\s/.test(ch)) {
      out += '\\s+';
      continue;
    }

    // "dj" se često kuca umesto "đ" (Djordje / Đorđe)
    if (ch.toLowerCase() === 'd' && t[i + 1] && t[i + 1].toLowerCase() === 'j') {
      out += '(?:dj|đ)';
      i++;
      continue;
    }

    const group = CHAR_CLASS[ch.toLowerCase()];
    out += group ? `[${group}${group.toUpperCase()}]` : escapeRegex(ch);
  }

  return out.replace(/(?:\\s\+)+/g, '\\s+');
};

/**
 * Varijante za numeričke pojmove (telefon, TIS ID): dopušta razdvajače u
 * sačuvanoj vrednosti i srpski pozivni broj.
 * "0611655593" nalazi "(061) 165-55-93"; "0613069150" nalazi "+381613069150".
 * Vraća [] za kratke pojmove da ne pravimo preskupe upite.
 */
const digitsLooseVariants = (term) => {
  const digits = String(term || '').replace(/\D/g, '');
  if (digits.length < 6) return [];

  const forms = new Set([digits]);
  if (digits.startsWith('381')) forms.add('0' + digits.slice(3));
  else if (digits.startsWith('0')) forms.add('381' + digits.slice(1));

  return [...forms].map(d => d.split('').join('[^0-9]*'));
};

module.exports = { escapeRegex, looseTextRegex, digitsLooseVariants };
