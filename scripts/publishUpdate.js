const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Import modela
const AppUpdate = require('../models/AppUpdate');

// Konekcija sa bazom
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/robotik', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const publishUpdate = async () => {
  try {
    console.log('🚀 Započinjem publish novog update-a...\n');

    // 1. Učitaj trenutne verzije
    const appJsonPath = path.join(__dirname, '../../robotikm/app.json');
    const appJson = JSON.parse(await fs.readFile(appJsonPath, 'utf8'));
    const currentRuntimeVersion = appJson.expo.runtimeVersion;

    // 2. Izračunaj novu verziju
    const versionParts = currentRuntimeVersion.split('.');
    versionParts[2] = parseInt(versionParts[2]) + 1; // Povećaj patch version
    const newRuntimeVersion = versionParts.join('.');

    console.log(`📦 Trenutna verzija: ${currentRuntimeVersion}`);
    console.log(`📦 Nova verzija: ${newRuntimeVersion}\n`);

    // 3. Ažuriraj app.json sa novom verzijom
    appJson.expo.runtimeVersion = newRuntimeVersion;
    await fs.writeFile(appJsonPath, JSON.stringify(appJson, null, 2));
    console.log('✅ app.json ažuriran sa novom verzijom\n');

    // 4. Export bundle-a
    console.log('📱 Eksportujem bundle...');
    const exportDir = path.join(__dirname, '../../robotikm/dist');

    await new Promise((resolve, reject) => {
      exec(
        'cd ../../robotikm && npx expo export --platform android --output-dir dist',
        { cwd: __dirname },
        (error, stdout, stderr) => {
          if (error) {
            console.error('❌ Greška pri exportu:', stderr);
            reject(error);
            return;
          }
          console.log(stdout);
          resolve();
        }
      );
    });

    console.log('✅ Bundle exportovan\n');

    // 5. Kopiraj bundle u backend bundles direktorijum
    const bundleFileName = `android-${newRuntimeVersion}.bundle`;
    const sourceBundlePath = path.join(exportDir, '_expo/static/js/android/index-*.js');
    const destBundlePath = path.join(__dirname, '../bundles', bundleFileName);

    // Pronađi bundle fajl (može imati hash u imenu)
    const bundleFiles = await fs.readdir(path.join(exportDir, '_expo/static/js/android'));
    const bundleFile = bundleFiles.find(f => f.startsWith('index-') && f.endsWith('.js'));

    if (!bundleFile) {
      throw new Error('Bundle fajl nije pronađen');
    }

    await fs.copyFile(
      path.join(exportDir, '_expo/static/js/android', bundleFile),
      destBundlePath
    );

    console.log(`✅ Bundle kopiran u: bundles/${bundleFileName}\n`);

    // 6. Kreiraj unos u bazi
    const update = await AppUpdate.createUpdate({
      version: newRuntimeVersion,
      runtimeVersion: newRuntimeVersion,
      platform: 'android',
      bundlePath: `bundles/${bundleFileName}`,
      changelog: process.argv[2] || 'Opšta poboljšanja i ispravke bugova',
      isMandatory: false,
      assets: []
    });

    console.log('✅ Update kreiran u bazi podataka');
    console.log(`   ID: ${update._id}`);
    console.log(`   Verzija: ${update.runtimeVersion}`);
    console.log(`   Platforma: ${update.platform}`);
    console.log(`   Changelog: ${update.changelog}\n`);

    console.log('🎉 Update uspešno publikovan!');
    console.log(`\n📱 Aplikacije sa verzijom < ${newRuntimeVersion} će automatski preuzeti ovaj update.\n`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Greška pri publish-ovanju update-a:', error);
    process.exit(1);
  }
};

publishUpdate();
