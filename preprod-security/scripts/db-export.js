// Izvoz dummy podataka Security pre-prod baze u preprod-security/dummy-data/<kolekcija>.ejson
// (kanonski EJSON: ObjectId i datumi ostaju tačni). Samo lokalna baza robotik_preprod_security.
// performancelogs se ne izvozi (dnevnik zahteva backenda, nije potreban za rad).
// Upotreba: node preprod-security/scripts/db-export.js
const path = require('path');
const fs = require('fs');

// Koren projekta: preprod-security je u korenu (<koren>/preprod-security) ili u repou (<koren>/.wt/robotikb/preprod-security)
const PRE_DIR = path.resolve(__dirname, '..');
const ROOT = fs.existsSync(path.join(PRE_DIR, '..', '.wt', 'robotikb')) ? path.resolve(PRE_DIR, '..') : path.resolve(PRE_DIR, '..', '..', '..');
const B = path.join(ROOT, '.wt', 'robotikb');
const { MongoClient, BSON } = require(require.resolve('mongodb', { paths: [B] }));
const OUT = path.join(PRE_DIR, 'dummy-data');
const URI = 'mongodb://127.0.0.1:27118';
const DB = 'robotik_preprod_security';
const SKIP = new Set(['performancelogs']);

(async () => {
  const client = await MongoClient.connect(URI, { serverSelectionTimeoutMS: 5000 });
  const db = client.db(DB);
  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).filter((f) => f.endsWith('.ejson')).forEach((f) => fs.unlinkSync(path.join(OUT, f)));
  const cols = (await db.listCollections().toArray()).map((c) => c.name).filter((n) => !SKIP.has(n) && !n.startsWith('system.')).sort();
  const summary = [];
  for (const name of cols) {
    const docs = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
    if (!docs.length) continue;
    fs.writeFileSync(path.join(OUT, `${name}.ejson`), `[\n${docs.map((d) => BSON.EJSON.stringify(d, { relaxed: false })).join(',\n')}\n]\n`);
    summary.push(`${String(docs.length).padStart(6)}  ${name}`);
  }
  fs.writeFileSync(path.join(OUT, 'SADRZAJ.txt'), `Izvoz ${DB}, ${new Date().toISOString()}\n${summary.join('\n')}\n`);
  console.log(`[export] ${summary.length} kolekcija u ${OUT}\n${summary.join('\n')}`);
  await client.close();
})().catch((e) => { console.error('[export] greška:', e.message); process.exit(1); });
