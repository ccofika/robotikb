const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const ApkVersion = require('../models/ApkVersion');

async function publishApk() {
  try {
    // Povezivanje na MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // APK informacije iz command line argumenata
    const version = process.argv[2];
    const versionCode = parseInt(process.argv[3]);
    const changelog = process.argv[4];
    const isMandatory = process.argv[5] === 'true';

    // Validacija
    if (!version || !versionCode || !changelog) {
      console.error('❌ Nedostaju argumenti!');
      console.log('\nKorišćenje:');
      console.log('  node scripts/publishApk.js <version> <versionCode> <changelog> [isMandatory]');
      console.log('\nPrimer:');
      console.log('  node scripts/publishApk.js "1.0.1" 2 "Dodato automatsko ažuriranje"');
      console.log('  node scripts/publishApk.js "1.0.1" 2 "Kritično ažuriranje" true');
      process.exit(1);
    }

    const fileName = `robotik-v${version}-build${versionCode}.apk`;
    const filePath = `apk-releases/${fileName}`;
    const fullPath = path.join(__dirname, '..', filePath);

    // Proveri da li fajl postoji
    if (!fs.existsSync(fullPath)) {
      console.error(`❌ APK fajl nije pronađen: ${fullPath}`);
      console.log('\nPregled dostupnih APK fajlova:');
      const apkDir = path.join(__dirname, '..', 'apk-releases');
      if (fs.existsSync(apkDir)) {
        const files = fs.readdirSync(apkDir).filter(f => f.endsWith('.apk'));
        if (files.length > 0) {
          files.forEach(f => console.log(`  - ${f}`));
        } else {
          console.log('  (Nema APK fajlova u folderu)');
        }
      }
      process.exit(1);
    }

    // Dobij veličinu fajla
    const stats = fs.statSync(fullPath);
    const fileSize = stats.size;

    console.log('\n📱 Objavljivanje nove APK verzije:');
    console.log('─'.repeat(50));
    console.log(`  Verzija: ${version}`);
    console.log(`  Version Code: ${versionCode}`);
    console.log(`  Fajl: ${fileName}`);
    console.log(`  Veličina: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Changelog: ${changelog}`);
    console.log(`  Obavezno: ${isMandatory ? 'DA' : 'NE'}`);
    console.log('─'.repeat(50));

    // Proveri da li verzija već postoji
    const existingVersion = await ApkVersion.findOne({
      $or: [
        { version },
        { versionCode }
      ]
    });

    if (existingVersion) {
      console.error(`\n❌ Verzija već postoji u bazi!`);
      console.log(`  Postojeća verzija: ${existingVersion.version} (code: ${existingVersion.versionCode})`);
      console.log(`  Kreirana: ${existingVersion.createdAt}`);
      console.log('\nKoristi novi version code ili obriši staru verziju iz baze.');
      process.exit(1);
    }

    // Kreiraj novu verziju
    const apkVersion = new ApkVersion({
      version,
      versionCode,
      fileName,
      filePath,
      fileSize,
      changelog,
      isMandatory
    });

    await apkVersion.save();

    console.log('\n✅ APK verzija uspešno objavljena!');
    console.log(`\n🔗 Download URL: /api/apk/download/${apkVersion._id}`);
    console.log(`\n📊 Statistika:`);
    console.log(`  - ID: ${apkVersion._id}`);
    console.log(`  - Kreirana: ${apkVersion.createdAt}`);
    console.log(`  - Aktivna: ${apkVersion.isActive ? 'DA' : 'NE'}`);

    // Prikaži sve verzije
    const allVersions = await ApkVersion.find({ isActive: true })
      .sort({ versionCode: -1 })
      .limit(5);

    console.log(`\n📦 Najnovije verzije (Top 5):`);
    allVersions.forEach((v, i) => {
      const isCurrent = v._id.toString() === apkVersion._id.toString();
      const marker = isCurrent ? '→' : ' ';
      console.log(`  ${marker} v${v.version} (code: ${v.versionCode}) - ${v.changelog.substring(0, 40)}...`);
    });

    await mongoose.connection.close();
    console.log('\n✅ Done!\n');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Greška pri objavljivanju APK-a:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Prikaži pomoć ako nema argumenata
if (process.argv.length < 5) {
  console.log('📱 Robotik APK Publisher');
  console.log('─'.repeat(50));
  console.log('\nKorišćenje:');
  console.log('  node scripts/publishApk.js <version> <versionCode> <changelog> [isMandatory]');
  console.log('\nArgumenti:');
  console.log('  version      - Verzija aplikacije (npr. "1.0.1")');
  console.log('  versionCode  - Android version code broj (mora biti veći od prethodnog)');
  console.log('  changelog    - Opis izmena u ovoj verziji');
  console.log('  isMandatory  - true/false - da li je ažuriranje obavezno (opciono, default: false)');
  console.log('\nPrimeri:');
  console.log('  node scripts/publishApk.js "1.0.1" 2 "Dodato automatsko ažuriranje aplikacije"');
  console.log('  node scripts/publishApk.js "1.0.2" 3 "Bug fixes i nove funkcionalnosti"');
  console.log('  node scripts/publishApk.js "2.0.0" 4 "Velika nova verzija!" true');
  console.log('\n💡 Napomena:');
  console.log('  APK fajl mora biti u folderu: apk-releases/robotik-v<version>-build<versionCode>.apk');
  console.log('  Primer: apk-releases/robotik-v1.0.1-build2.apk\n');
  process.exit(0);
}

publishApk();
