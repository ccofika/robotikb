// SAMO lokalni Security pre-prod (SECURITY_TEST_HOOKS=1): virtuelni sat backend procesa za E2E "smena kroz vreme".
// Kod aplikacije (rute, servisi, modeli: očitavanja, alarmi, smene, izveštaji) i tokeni (jsonwebtoken, jer ih
// aplikacija na telefonu proverava po svom satu) vide pomereno vreme kroz Date.now() i new Date() bez argumenata.
// MongoDB drajver, mongoose, bson i node-cron i dalje vide pravo vreme: ne podnose skokove sata (proteklo vreme
// računaju preko sata). Uključuje se PRE učitavanja backenda (start-backend.js), jer modeli pamte Date.now
// (npr. default: Date.now za vreme alarma). Upravlja se preko POST /api/security/_test/clock { at } ili { reset: true }.
const Module = require('module');

const REAL_TIME_LIBS = /[\\/]node_modules[\\/](mongodb|mongoose|bson|node-cron)[\\/]/;

function install() {
  if (global.__securityTestClock) return global.__securityTestClock;
  const RealDate = global.Date;
  let offsetMs = 0;
  // obična funkcija, ne klasa: Date() bez new mora da radi kao i pre
  function ClockDate(...args) {
    if (!new.target) return new RealDate(RealDate.now() + offsetMs).toString();
    return args.length ? new RealDate(...args) : new RealDate(RealDate.now() + offsetMs);
  }
  ClockDate.prototype = RealDate.prototype;
  ClockDate.now = () => RealDate.now() + offsetMs;
  ClockDate.parse = RealDate.parse;
  ClockDate.UTC = RealDate.UTC;
  Object.defineProperty(ClockDate, Symbol.hasInstance, { value: (v) => v instanceof RealDate });

  // biblioteke dobijaju sopstveni Date = pravi sat (ubacuje se posle "use strict", isti red, brojevi redova ostaju)
  global.__securityRealDate = RealDate;
  const compile = Module.prototype._compile;
  Module.prototype._compile = function compileWithRealDate(content, filename) {
    if (REAL_TIME_LIBS.test(filename)) {
      const inject = 'var Date = globalThis.__securityRealDate;';
      const m = /^(\s*(['"])use strict\2;?)/.exec(content);
      content = m ? `${m[1]}${inject}${content.slice(m[1].length)}` : `${inject}${content}`;
    }
    return compile.call(this, content, filename);
  };

  global.Date = ClockDate;
  const api = {
    set(at) {
      const t = new RealDate(at).getTime();
      if (Number.isNaN(t)) throw new Error('Neispravno vreme za virtuelni sat.');
      offsetMs = t - RealDate.now();
      return api.state();
    },
    reset() { offsetMs = 0; return api.state(); },
    state() { return { installed: true, offsetMs, now: new RealDate(RealDate.now() + offsetMs).toISOString(), real: new RealDate().toISOString() }; },
  };
  global.__securityTestClock = api;
  console.log('⚠️  Security virtuelni sat je uključen (samo pre-prod, SECURITY_TEST_HOOKS=1)');
  return api;
}

module.exports = { install };
