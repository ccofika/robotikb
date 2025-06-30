const mongoose = require('mongoose');
const { Log } = require('../models');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function clearLogs() {
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

    // Brisanje svih logova
    const result = await Log.deleteMany({});
    console.log(`Obrisano ${result.deletedCount} logova`);

  } catch (error) {
    console.error('Greška:', error);
  } finally {
    // Zatvaranje konekcije
    await mongoose.connection.close();
    console.log('Konekcija zatvorena');
  }
}

// Pokretanje skripta
clearLogs(); 