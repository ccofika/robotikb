/**
 * Skripta za standardizaciju naziva kategorija opreme
 * Prebacuje sve varijante naziva u standardne kategorije
 */

const mongoose = require('mongoose');
const Equipment = require('../models/Equipment');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Mapiranje nestandardnih kategorija na standardne
const categoryMappings = {
  // STB
  'box': 'STB',
  'dtv': 'STB',
  'skaymaster': 'STB',
  'sky': 'STB',
  'sky master': 'STB',
  'stb': 'STB',

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
  'cam markoni': 'Cam Modul',
  'modul': 'Cam Modul',

  // Hybrid
  'hibrid': 'Hybrid',
  'move': 'Hybrid',
  'move stb': 'Hybrid',
  'muv': 'Hybrid',
  'muv hibrid': 'Hybrid',
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
  'smart kartica markoni': 'Smart Card',
  'smc': 'Smart Card',

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

async function standardizeCategories() {
  try {
    const uri = process.env.MONGODB_URI;
    await mongoose.connect(uri);
    console.log('Povezano sa MongoDB bazom\n');

    // Prvo, prikaži trenutno stanje
    console.log('=== TRENUTNO STANJE KATEGORIJA ===\n');

    const currentCategories = await Equipment.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    currentCategories.forEach(cat => {
      const lower = cat._id?.toLowerCase() || '';
      const mapping = categoryMappings[lower];
      const status = mapping ? `-> ${mapping}` : (cat._id === 'test' || cat._id === 'Test' ? '(SKIP)' : '(OK)');
      console.log(`  ${cat._id}: ${cat.count} ${status}`);
    });

    console.log('\n=== IZVRŠAVAM MIGRACIJU ===\n');

    let totalUpdated = 0;

    // Prolazak kroz sve mapiranja i ažuriranje
    for (const [oldCategory, newCategory] of Object.entries(categoryMappings)) {
      // Case-insensitive pretraga
      const result = await Equipment.updateMany(
        { category: { $regex: new RegExp(`^${oldCategory}$`, 'i') } },
        { $set: { category: newCategory } }
      );

      if (result.modifiedCount > 0) {
        console.log(`  ${oldCategory} -> ${newCategory}: ${result.modifiedCount} ažurirano`);
        totalUpdated += result.modifiedCount;
      }
    }

    console.log(`\n✓ Ukupno ažurirano: ${totalUpdated} komada opreme`);

    // Prikaži novo stanje
    console.log('\n=== NOVO STANJE KATEGORIJA ===\n');

    const newCategories = await Equipment.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    newCategories.forEach(cat => {
      console.log(`  ${cat._id}: ${cat.count}`);
    });

  } catch (error) {
    console.error('Greška:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nKonekcija zatvorena');
  }
}

standardizeCategories();
