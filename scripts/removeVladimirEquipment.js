const mongoose = require('mongoose');
const Equipment = require('../models/Equipment');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function removeVladimirEquipment() {
  try {
    // Učitavanje JSON fajla sa izvučenom opremom
    const jsonPath = path.join(__dirname, '..', 'vladimir_milovanovic_oprema.json');

    if (!fs.existsSync(jsonPath)) {
      throw new Error('vladimir_milovanovic_oprema.json fajl nije pronađen!');
    }

    const equipmentData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    console.log(`Učitan fajl sa ${equipmentData.totalCount} komada opreme`);
    console.log(`Tehničar: ${equipmentData.technician.name}\n`);

    // Izvlačenje svih serijskih brojeva iz JSON fajla
    const serialNumbers = equipmentData.equipment.map(item => item.serialNumber);

    console.log(`Ukupno serijskih brojeva za brisanje: ${serialNumbers.length}\n`);

    // Povezivanje sa bazom
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI nije definisan u .env fajlu');
    }

    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Povezano sa MongoDB bazom\n');

    // Prvo provera - koliko opreme postoji u bazi sa ovim serijskim brojevima
    const existingCount = await Equipment.countDocuments({
      serialNumber: { $in: serialNumbers }
    });

    console.log(`Pronađeno u bazi: ${existingCount} komada opreme sa tim serijskim brojevima`);

    // Brisanje opreme SAMO sa serijskim brojevima iz JSON fajla
    const result = await Equipment.deleteMany({
      serialNumber: { $in: serialNumbers }
    });

    console.log(`\n✓ OBRISANO: ${result.deletedCount} komada opreme`);

    if (result.deletedCount === serialNumbers.length) {
      console.log('✓ Uspešno obrisana sva oprema iz JSON fajla!');
    } else {
      console.log(`⚠ Upozorenje: Očekivano ${serialNumbers.length}, obrisano ${result.deletedCount}`);
    }

    // Verifikacija - provera da li još postoji oprema u bazi
    const remainingCount = await Equipment.countDocuments({
      serialNumber: { $in: serialNumbers }
    });

    console.log(`\nPreostala oprema sa tim serijskim brojevima u bazi: ${remainingCount}`);

  } catch (error) {
    console.error('Greška:', error);
  } finally {
    // Zatvaranje konekcije
    await mongoose.connection.close();
    console.log('\nKonekcija zatvorena');
  }
}

// Pokretanje skripta
removeVladimirEquipment();
