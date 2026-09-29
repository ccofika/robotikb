// Uvoz dummy podataka u Security pre-prod bazu: BRIŠE bazu robotik_preprod_security (samo na 127.0.0.1:27118)
// i upisuje sve iz preprod-security/dummy-data/*.ejson, pa napravi indekse iz backend modela.
// Upotreba: node preprod-security/scripts/db-import.js [--db=robotik_preprod_security_test]   (baza mora da radi)
const path = require('path');
const fs = require('fs');

// Koren projekta: preprod-security je u korenu (<koren>/preprod-security) ili u repou (<koren>/.wt/robotikb/preprod-security)
const PRE_DIR = path.resolve(__dirname, '..');
const ROOT = fs.existsSync(path.join(PRE_DIR, '..', '.wt', 'robotikb')) ? path.resolve(PRE_DIR, '..') : path.resolve(PRE_DIR, '..', '..', '..');
const B = path.join(ROOT, '.wt', 'robotikb');
const req = (m) => require(require.resolve(m, { paths: [B] }));
const { MongoClient, BSON } = req('mongodb');
const IN = path.join(PRE_DIR, 'dummy-data');
const HOST = 'mongodb://127.0.0.1:27118';
const arg = process.argv.find((a) => a.startsWith('--db='));
const DB = arg ? arg.split('=')[1] : 'robotik_preprod_security';
if (!/^robotik_preprod_security(_test)?$/.test(DB)) { console.error('[import] STOP: dozvoljena je samo baza robotik_preprod_security'); process.exit(1); }

(async () => {
  const files = fs.readdirSync(IN).filter((f) => f.endsWith('.ejson')).sort();
  if (!files.length) throw new Error(`nema .ejson fajlova u ${IN}`);
  const client = await MongoClient.connect(HOST, { serverSelectionTimeoutMS: 5000 });
  const db = client.db(DB);
  await db.dropDatabase();
  const summary = [];
  for (const f of files) {
    const docs = BSON.EJSON.parse(fs.readFileSync(path.join(IN, f), 'utf8'), { relaxed: false });
    if (docs.length) await db.collection(f.replace(/\.ejson$/, '')).insertMany(docs, { ordered: false });
    summary.push(`${String(docs.length).padStart(6)}  ${f.replace(/\.ejson$/, '')}`);
  }
  await client.close();
  // indeksi iz modela (jedinstveni UID taga, imena radnika...), isto kao kad backend krene na praznoj bazi
  const mongoose = req('mongoose');
  await mongoose.connect(`${HOST}/${DB}`);
  fs.readdirSync(path.join(B, 'models')).filter((f) => f.endsWith('.js') && f !== 'index.js').forEach((f) => { try { require(path.join(B, 'models', f)); } catch (e) { /* model koji ne može da se učita bez okruženja se preskače */ } });
  let idx = 0;
  for (const m of Object.values(mongoose.models)) { try { await m.createIndexes(); idx++; } catch (e) { console.log(`[import] indeksi ${m.modelName}: ${e.message}`); } }
  await mongoose.disconnect();
  console.log(`[import] baza ${DB} obrisana i uvezena (${summary.length} kolekcija, indeksi za ${idx} modela)\n${summary.join('\n')}`);
})().catch((e) => { console.error('[import] greška:', e.message); process.exit(1); });
