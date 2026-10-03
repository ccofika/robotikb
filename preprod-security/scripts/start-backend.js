// Pokreće robotikb iz worktree-a feature/security-module sa PRE-PROD env-om za Security modul.
// Isto kao preprod/scripts/start-backend.js, samo druga baza (robotik_preprod_security) i port 5300.
const path = require('path');
const fs = require('fs');

// Koren projekta: preprod-security je u korenu (<koren>/preprod-security) ili u repou (<koren>/.wt/robotikb/preprod-security)
const PRE_DIR = path.resolve(__dirname, '..');
const ROOT = fs.existsSync(path.join(PRE_DIR, '..', '.wt', 'robotikb')) ? path.resolve(PRE_DIR, '..') : path.resolve(PRE_DIR, '..', '..', '..');
const BACKEND_DIR = path.join(ROOT, '.wt', 'robotikb');
const PREPROD_ENV = path.join(__dirname, '..', 'env', 'backend.env');

const dotenv = require(require.resolve('dotenv', { paths: [BACKEND_DIR] }));
const preprod = dotenv.parse(fs.readFileSync(PREPROD_ENV));

// Svaki ključ iz produkcionog robotikb/.env mora postojati i ovde (da nijedna produkciona vrednost ne procuri)
const prodEnvPath = path.join(ROOT, 'robotikb', '.env');
const prodKeys = fs.existsSync(prodEnvPath) ? Object.keys(dotenv.parse(fs.readFileSync(prodEnvPath))) : [];
const missing = prodKeys.filter((k) => !(k in preprod));
if (missing.length) {
  console.error('[preprod-security] STOP: ključevi iz robotikb/.env fale u env/backend.env:', missing.join(', '));
  process.exit(1);
}
const uri = preprod.MONGODB_URI || '';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/robotik_preprod_security$/.test(uri)) {
  console.error('[preprod-security] STOP: MONGODB_URI mora biti lokalna baza robotik_preprod_security');
  process.exit(1);
}
if (fs.existsSync(path.join(BACKEND_DIR, '.env'))) {
  console.error('[preprod-security] STOP: worktree ima .env fajl, obriši ga da se ne bi mešao sa pre-prod vrednostima');
  process.exit(1);
}

for (const [k, v] of Object.entries(preprod)) process.env[k] = v;
// Virtuelni sat za E2E "smena kroz vreme" (samo uz SECURITY_TEST_HOOKS=1): mora pre učitavanja backenda
if (process.env.SECURITY_TEST_HOOKS === '1') require('./test-clock').install();
process.chdir(BACKEND_DIR);
console.log(`[preprod-security] robotikb (worktree) -> ${uri} | port ${process.env.PORT}`);
require(path.join(BACKEND_DIR, 'server.js'));
