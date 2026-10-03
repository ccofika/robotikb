// Dve instance Security pre-prod-a na istoj bazi podataka (mongod 27118):
//   main  za ljude (ručni pregled, demo): backend 5300, web 3300, Mailpit 8026/1026, baza robotik_preprod_security
//   e2e   samo za automatske testove (brišu podatke i pomeraju sat): backend 5301, web 3301, Mailpit 8027/1027,
//         baza robotik_preprod_security_e2e
// Bira se sa SECURITY_INSTANCE=e2e (security.ps1 "start e2e", "seed e2e" i "test" to postavljaju sami).
const INSTANCES = {
  main: { api: 5300, web: 3300, mailWeb: 8026, smtp: 1026, db: 'robotik_preprod_security' },
  e2e: { api: 5301, web: 3301, mailWeb: 8027, smtp: 1027, db: 'robotik_preprod_security_e2e' },
};

// Jedine baze koje pre-prod skripte smeju da diraju
const DB_RE = /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/robotik_preprod_security(_e2e)?$/;

const instanceName = () => (process.env.SECURITY_INSTANCE === 'e2e' ? 'e2e' : 'main');

// env iz env/backend.env (pisan za main) prilagođen instanci
function forInstance(env, name = instanceName()) {
  if (name === 'main') return { ...env };
  const i = INSTANCES[name];
  const db = (uri) => String(uri || '').replace(/\/robotik_preprod_security$/, `/${i.db}`);
  return {
    ...env,
    PORT: String(i.api),
    BASE_URL: `http://localhost:${i.api}`,
    MONGODB_URI: db(env.MONGODB_URI),
    MONGO_URI: db(env.MONGO_URI),
    SMTP_PORT: String(i.smtp),
    GMAIL_SMTP_PORT: String(i.smtp),
    CORS_EXTRA_ORIGINS: [env.CORS_EXTRA_ORIGINS, `http://localhost:${i.web}`].filter(Boolean).join(','),
    WEB_APP_URL: `http://localhost:${i.web}`,
    SECURITY_TEST_HOOKS: '1',
  };
}

module.exports = { INSTANCES, DB_RE, instanceName, forInstance };
