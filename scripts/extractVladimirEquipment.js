const mongoose = require('mongoose');
const Equipment = require('../models/Equipment');
const Technician = require('../models/Technician');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function extractVladimirEquipment() {
  try {
    // Povezivanje sa bazom koristeći konfiguraciju iz .env fajla
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI nije definisan u .env fajlu');
    }

    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Povezano sa MongoDB bazom');

    // Pronalaženje tehničara Vladimir Milovanović
    const technician = await Technician.findOne({ name: 'Vladimir Milovanović' });

    if (!technician) {
      console.log('Tehničar Vladimir Milovanović nije pronađen u bazi!');
      return;
    }

    console.log(`Pronađen tehničar: ${technician.name} (ID: ${technician._id})`);

    // Filtriranje opreme koja je kod tehničara (ne kod korisnika)
    // Uslovi:
    // 1. assignedTo = ID tehničara
    // 2. assignedToUser = null ili ne postoji (oprema NIJE kod korisnika)
    // 3. status = 'assigned' (dodeljena tehničaru ali nije instalirana)
    const equipment = await Equipment.find({
      assignedTo: technician._id,
      $or: [
        { assignedToUser: null },
        { assignedToUser: { $exists: false } }
      ]
    }).select('-__v'); // Isključujemo __v polje iz rezultata

    console.log(`\nPronađeno ${equipment.length} komada opreme kod tehničara ${technician.name}`);
    console.log('(Oprema koja je kod tehničara, a NIJE kod korisnika)\n');

    // Priprema podataka za JSON fajl
    const equipmentData = {
      technician: {
        name: technician.name,
        id: technician._id.toString()
      },
      extractedDate: new Date().toISOString(),
      totalCount: equipment.length,
      equipment: equipment.map(item => ({
        serialNumber: item.serialNumber,
        category: item.category,
        description: item.description,
        status: item.status,
        location: item.location,
        assignedTo: item.assignedTo?.toString(),
        assignedToUser: item.assignedToUser || null,
        installedAt: item.installedAt || null,
        awaitingConfirmation: item.awaitingConfirmation || false,
        confirmationStatus: item.confirmationStatus || 'pending',
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      }))
    };

    // Čuvanje u JSON fajl
    const outputPath = path.join(__dirname, '..', 'vladimir_milovanovic_oprema.json');
    fs.writeFileSync(outputPath, JSON.stringify(equipmentData, null, 2), 'utf8');

    console.log(`Podaci sačuvani u fajl: ${outputPath}`);
    console.log(`\n✓ UKUPNO OPREME: ${equipment.length} komada`);

    // Prikaz kategorija opreme
    const categoryCounts = {};
    equipment.forEach(item => {
      categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
    });

    console.log('\nRaspodela po kategorijama:');
    Object.entries(categoryCounts).forEach(([category, count]) => {
      console.log(`  - ${category}: ${count} komada`);
    });

  } catch (error) {
    console.error('Greška:', error);
  } finally {
    // Zatvaranje konekcije
    await mongoose.connection.close();
    console.log('\nKonekcija zatvorena');
  }
}

// Pokretanje skripta
extractVladimirEquipment();
