const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs').promises;
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const AppUpdate = require('../models/AppUpdate');

// Konekcija sa bazom
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/robotik');

const checkSystem = async () => {
  try {
    console.log('🔍 Provera OTA Update Sistema\n');
    console.log('=' .repeat(60));

    // 1. Provera MongoDB konekcije
    console.log('\n📊 MongoDB Status:');
    const state = mongoose.connection.readyState;
    console.log(`   Konekcija: ${state === 1 ? '✅ Povezana' : '❌ Nije povezana'}`);

    if (state !== 1) {
      console.log('   ❌ MongoDB nije dostupna. Proveri .env fajl.');
      process.exit(1);
    }

    // 2. Provera app.json verzije
    console.log('\n📱 Aplikacija:');
    const appJsonPath = path.join(__dirname, '../../robotikm/app.json');
    try {
      const appJson = JSON.parse(await fs.readFile(appJsonPath, 'utf8'));
      console.log(`   Trenutna verzija: ${appJson.expo.runtimeVersion || appJson.expo.version}`);
      console.log(`   Updates enabled: ${appJson.expo.updates?.enabled ? '✅' : '❌'}`);
    } catch (error) {
      console.log('   ❌ Greška pri čitanju app.json');
    }

    // 3. Provera bundles foldera
    console.log('\n📦 Bundle Storage:');
    const bundlesDir = path.join(__dirname, '../bundles');
    try {
      await fs.access(bundlesDir);
      const files = await fs.readdir(bundlesDir);
      const bundleFiles = files.filter(f => f.endsWith('.bundle'));
      console.log(`   Bundles folder: ✅ Postoji`);
      console.log(`   Broj bundle-ova: ${bundleFiles.length}`);
      if (bundleFiles.length > 0) {
        console.log(`   Latest: ${bundleFiles[bundleFiles.length - 1]}`);
      }
    } catch (error) {
      console.log('   ❌ Bundles folder ne postoji');
    }

    // 4. Provera update-a u bazi
    console.log('\n🗄️  MongoDB Updates:');
    const updates = await AppUpdate.find().sort({ runtimeVersion: -1 }).limit(5);

    if (updates.length === 0) {
      console.log('   ⚠️  Nema update-a u bazi');
      console.log('   Pokrenite: npm run publish-update');
    } else {
      console.log(`   Ukupno update-a: ${updates.length}`);
      console.log('\n   Poslednjih 5 update-a:');
      updates.forEach((u, i) => {
        const status = u.isActive ? '✅' : '❌';
        console.log(`   ${i + 1}. ${status} v${u.runtimeVersion} - ${u.platform} - ${new Date(u.createdAt).toLocaleDateString()}`);
        console.log(`      Path: ${u.bundlePath}`);
        console.log(`      Changelog: ${u.changelog || 'N/A'}`);
      });
    }

    // 5. Provera najnovije verzije
    console.log('\n🎯 Latest Active Update:');
    const latest = await AppUpdate.findOne({
      platform: { $in: ['android', 'all'] },
      isActive: true
    }).sort({ runtimeVersion: -1 });

    if (latest) {
      console.log(`   ✅ Verzija: ${latest.runtimeVersion}`);
      console.log(`   📅 Objavljen: ${new Date(latest.publishedAt).toLocaleString()}`);
      console.log(`   📝 Changelog: ${latest.changelog || 'N/A'}`);

      // Proveri da li bundle fajl postoji
      const bundlePath = path.join(__dirname, '..', latest.bundlePath);
      try {
        await fs.access(bundlePath);
        const stats = await fs.stat(bundlePath);
        console.log(`   📦 Bundle: ✅ Postoji (${(stats.size / 1024).toFixed(2)} KB)`);
      } catch (error) {
        console.log(`   📦 Bundle: ❌ Ne postoji na putanji: ${latest.bundlePath}`);
      }
    } else {
      console.log('   ⚠️  Nema aktivnih update-a');
    }

    // 6. Test endpoint-a
    console.log('\n🌐 API Endpoints Test:');
    console.log('   Pokrenite backend server (npm run dev) i testirajte:');
    console.log('   - GET  http://localhost:5000/api/updates/check?currentVersion=1.0.0');
    console.log('   - GET  http://localhost:5000/api/updates/list');
    console.log('   - GET  http://localhost:5000/api/updates/manifest');

    console.log('\n' + '='.repeat(60));
    console.log('✅ Provera završena!');

    if (latest && updates.length > 0) {
      console.log('\n🎉 Update sistem je spreman za korišćenje!');
      console.log('\nSledeći koraci:');
      console.log('1. Podesi IP adresu u robotikm/src/components/AppUpdater.js');
      console.log('2. Kreiraj APK: cd robotikm && npx expo prebuild && cd android && ./gradlew assembleRelease');
      console.log('3. Instaliraj APK na telefon');
      console.log('4. Za update-e koristi: npm run publish-update\n');
    } else {
      console.log('\n⚠️  Update sistem nije potpuno konfigurisan.');
      console.log('Pokrenite: npm run publish-update\n');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Greška:', error);
    process.exit(1);
  }
};

checkSystem();
