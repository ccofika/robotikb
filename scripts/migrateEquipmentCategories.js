/**
 * Migraciona skripta za ažuriranje kategorija opreme
 *
 * Ova skripta:
 * 1. Pravi backup postojećih kategorija u JSON fajl
 * 2. Ažurira sve kategorije prema novom mapiranju
 *
 * Pokretanje: node scripts/migrateEquipmentCategories.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const fs = require('fs');

// MongoDB connection string
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI nije definisan u .env fajlu!');
  process.exit(1);
}

// Mapiranje starih kategorija na nove
const categoryMappings = {
  // STB
  'box': 'STB',
  'dtv': 'STB',
  'stb': 'STB',
  'skaymaster': 'STB',
  'sky': 'STB',
  'sky master': 'STB',
  'skymaster': 'STB',

  // Cam Modul
  'c modul': 'Cam Modul',
  'c-modul': 'Cam Modul',
  'cmodul': 'Cam Modul',
  'cam': 'Cam Modul',
  'cam cmodul': 'Cam Modul',
  'can': 'Cam Modul',
  'ci': 'Cam Modul',
  'crypto': 'Cam Modul',
  'crypto gard': 'Cam Modul',
  'kam': 'Cam Modul',
  'cam modul': 'Cam Modul',

  // Hybrid
  'hibrid': 'Hybrid',
  'move': 'Hybrid',
  'move stb': 'Hybrid',
  'hybrid': 'Hybrid',

  // OTT tv po tvom
  'ott': 'OTT tv po tvom',
  'ott media': 'OTT tv po tvom',
  'ott tv po tvom': 'OTT tv po tvom',
  'ip stb': 'OTT tv po tvom',
  'tv po tvom': 'OTT tv po tvom',

  // Smart Card
  'kartica': 'Smart Card',
  'sim': 'Smart Card',
  'smart': 'Smart Card',
  'smart kartica': 'Smart Card',
  'smart card': 'Smart Card',
  'sim kartica': 'Smart Card',
  'sim karticu': 'Smart Card',

  // HFC Modem
  'modem hfc': 'HFC Modem',
  'hfc modem': 'HFC Modem',
  'hfc mode': 'HFC Modem',
  'modem': 'HFC Modem',

  // GPON Modem
  'gpon modem': 'GPON Modem',

  // ATV
  'atv': 'ATV',

  // PON
  'pon': 'PON',

  // M- prefixed categories
  'm cam': 'M-Cam Modul',
  'm-cam': 'M-Cam Modul',
  'm cam modul': 'M-Cam Modul',
  'm-cam modul': 'M-Cam Modul',

  'm sim': 'M-Smart Card',
  'm-sim': 'M-Smart Card',
  'm smart card': 'M-Smart Card',
  'm-smart card': 'M-Smart Card',

  'm hfc modem': 'M-HFC Modem',
  'm-hfc modem': 'M-HFC Modem',
  'm hfc': 'M-HFC Modem',
  'm-hfc': 'M-HFC Modem',

  'm gpon modem': 'M-GPON Modem',
  'm-gpon modem': 'M-GPON Modem',
  'm gpon': 'M-GPON Modem',
  'm-gpon': 'M-GPON Modem',

  'm atv': 'M-ATV',
  'm-atv': 'M-ATV',

  'm stb': 'M-STB',
  'm-stb': 'M-STB',

  'm ott': 'M-OTT tv po tvom',
  'm-ott': 'M-OTT tv po tvom',
  'm ott tv po tvom': 'M-OTT tv po tvom',
  'm-ott tv po tvom': 'M-OTT tv po tvom',

  'm hybrid': 'M-Hybrid',
  'm-hybrid': 'M-Hybrid',
  'm hibrid': 'M-Hybrid',
  'm-hibrid': 'M-Hybrid',

  'm pon': 'M-PON',
  'm-pon': 'M-PON'
};

// Funkcija za normalizaciju kategorije
function normalizeCategory(category) {
  if (!category) return null;

  const lowerCategory = category.toLowerCase().trim();

  // Direktno mapiranje
  if (categoryMappings[lowerCategory]) {
    return categoryMappings[lowerCategory];
  }

  // Ako kategorija već ima ispravan format, vrati je
  const validCategories = [
    'STB', 'Cam Modul', 'Hybrid', 'OTT tv po tvom', 'Smart Card',
    'HFC Modem', 'GPON Modem', 'ATV', 'PON',
    'M-Cam Modul', 'M-Smart Card', 'M-HFC Modem', 'M-GPON Modem',
    'M-ATV', 'M-STB', 'M-OTT tv po tvom', 'M-Hybrid', 'M-PON'
  ];

  const matchedCategory = validCategories.find(
    vc => vc.toLowerCase() === lowerCategory
  );

  if (matchedCategory) {
    return matchedCategory;
  }

  // Ako nije pronađeno mapiranje, vrati original (za nepoznate kategorije)
  console.log(`⚠️  Nepoznata kategorija: "${category}" - zadržana originalna vrednost`);
  return category;
}

async function main() {
  try {
    console.log('🚀 Pokretanje migracije kategorija opreme...\n');

    // Povezivanje na MongoDB
    console.log('📡 Povezivanje na MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Uspešno povezano na MongoDB\n');

    const Equipment = mongoose.model('Equipment', new mongoose.Schema({
      category: String,
      description: String,
      serialNumber: String,
      location: String,
      status: String,
      assignedTo: mongoose.Schema.Types.ObjectId,
      assignedToUser: String
    }, { strict: false }));

    // 1. BACKUP - Snimi trenutno stanje kategorija
    console.log('📦 Kreiranje backup-a...');
    const allEquipment = await Equipment.find({}, { category: 1, description: 1, serialNumber: 1 }).lean();

    const backupData = {
      timestamp: new Date().toISOString(),
      totalCount: allEquipment.length,
      uniqueCategories: [...new Set(allEquipment.map(e => e.category))],
      items: allEquipment
    };

    const backupPath = path.join(__dirname, `../data/equipment_categories_backup_${Date.now()}.json`);

    // Kreiraj data folder ako ne postoji
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
    console.log(`✅ Backup sačuvan: ${backupPath}`);
    console.log(`   - Ukupno stavki: ${allEquipment.length}`);
    console.log(`   - Jedinstvenih kategorija: ${backupData.uniqueCategories.length}\n`);

    // Prikaz trenutnih kategorija
    console.log('📋 Trenutne kategorije u bazi:');
    const categoryCounts = {};
    allEquipment.forEach(e => {
      categoryCounts[e.category] = (categoryCounts[e.category] || 0) + 1;
    });

    Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, count]) => {
        console.log(`   - "${cat}": ${count} komada`);
      });
    console.log('');

    // 2. MIGRACIJA - Ažuriraj kategorije
    console.log('🔄 Započinjem migraciju kategorija...\n');

    const migrationStats = {
      updated: 0,
      unchanged: 0,
      errors: 0,
      categoryChanges: {}
    };

    // Grupiši po kategoriji za bulk update
    const categoryGroups = {};
    for (const item of allEquipment) {
      const oldCategory = item.category;
      const newCategory = normalizeCategory(oldCategory);

      if (oldCategory !== newCategory) {
        if (!categoryGroups[oldCategory]) {
          categoryGroups[oldCategory] = {
            newCategory: newCategory,
            ids: []
          };
        }
        categoryGroups[oldCategory].ids.push(item._id);
      }
    }

    // Izvrši bulk update za svaku kategoriju
    for (const [oldCategory, data] of Object.entries(categoryGroups)) {
      try {
        const result = await Equipment.updateMany(
          { _id: { $in: data.ids } },
          { $set: { category: data.newCategory } }
        );

        migrationStats.updated += result.modifiedCount;
        migrationStats.categoryChanges[oldCategory] = {
          newCategory: data.newCategory,
          count: result.modifiedCount
        };

        console.log(`   ✅ "${oldCategory}" → "${data.newCategory}": ${result.modifiedCount} stavki`);
      } catch (error) {
        console.error(`   ❌ Greška pri ažuriranju "${oldCategory}":`, error.message);
        migrationStats.errors += data.ids.length;
      }
    }

    migrationStats.unchanged = allEquipment.length - migrationStats.updated - migrationStats.errors;

    // 3. VERIFIKACIJA
    console.log('\n📊 Verifikacija migracije...');
    const newCategoryCounts = await Equipment.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    console.log('\n📋 Kategorije nakon migracije:');
    newCategoryCounts.forEach(({ _id, count }) => {
      console.log(`   - "${_id}": ${count} komada`);
    });

    // Rezime
    console.log('\n' + '='.repeat(60));
    console.log('📈 REZIME MIGRACIJE');
    console.log('='.repeat(60));
    console.log(`   Ukupno stavki u bazi: ${allEquipment.length}`);
    console.log(`   Ažurirano: ${migrationStats.updated}`);
    console.log(`   Nepromenjeno: ${migrationStats.unchanged}`);
    console.log(`   Grešaka: ${migrationStats.errors}`);
    console.log(`   Jedinstvenih kategorija pre: ${backupData.uniqueCategories.length}`);
    console.log(`   Jedinstvenih kategorija posle: ${newCategoryCounts.length}`);
    console.log('='.repeat(60));

    if (migrationStats.errors === 0) {
      console.log('\n✅ Migracija uspešno završena!');
    } else {
      console.log('\n⚠️  Migracija završena sa greškama. Proverite logove.');
    }

  } catch (error) {
    console.error('❌ Fatalna greška pri migraciji:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n📡 Veza sa MongoDB zatvorena.');
  }
}

main();
