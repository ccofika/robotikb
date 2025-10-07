const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const fs = require('fs');

// Učitaj modele
const FinancialTransaction = require('../models/FinancialTransaction');
const Technician = require('../models/Technician');

// MongoDB konekcija
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/management-app';

async function findMissingTechnicians() {
  try {
    // Poveži se sa MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('Povezan sa MongoDB\n');

    // Pronađi sve jedinstvene technicianId iz transakcija
    const uniqueTechnicianIds = await FinancialTransaction.distinct('technicians.technicianId');
    console.log(`Pronađeno ${uniqueTechnicianIds.length} jedinstvenih tehničara u transakcijama\n`);

    // Proveri koji tehničari postoje u bazi
    const missingTechnicians = [];
    const existingTechnicians = [];

    for (const techId of uniqueTechnicianIds) {
      if (!techId) {
        console.log('⚠️  Pronađen null/undefined technicianId');
        missingTechnicians.push({
          technicianId: null,
          status: 'NULL_ID'
        });
        continue;
      }

      try {
        const technician = await Technician.findById(techId);
        if (technician) {
          existingTechnicians.push({
            _id: technician._id,
            name: technician.name,
            email: technician.email
          });
        } else {
          console.log(`✗ Tehničar ${techId} NE POSTOJI u bazi`);
          missingTechnicians.push({
            technicianId: techId,
            status: 'NOT_FOUND'
          });
        }
      } catch (e) {
        console.log(`✗ Greška pri pretraživanju tehničara ${techId}: ${e.message}`);
        missingTechnicians.push({
          technicianId: techId,
          status: 'ERROR',
          error: e.message
        });
      }
    }

    console.log(`\n✓ Postojećih tehničara: ${existingTechnicians.length}`);
    console.log(`✗ Tehničara koji ne postoje: ${missingTechnicians.length}\n`);

    if (missingTechnicians.length > 0) {
      console.log('=== TEHNIČARI KOJI NE POSTOJE ===\n');

      for (const missing of missingTechnicians) {
        console.log(`Tehničar ID: ${missing.technicianId || 'NULL'}`);
        console.log(`Status: ${missing.status}`);
        if (missing.error) {
          console.log(`Greška: ${missing.error}`);
        }

        // Pronađi sve transakcije za ovog tehničara
        const transactions = await FinancialTransaction.find({
          'technicians.technicianId': missing.technicianId
        }).lean();

        console.log(`Broj transakcija: ${transactions.length}`);

        // Izračunaj statistiku
        let totalEarnings = 0;
        let count = 0;

        transactions.forEach(tx => {
          tx.technicians.forEach(tech => {
            if (tech.technicianId?.toString() === missing.technicianId?.toString() ||
                (!tech.technicianId && !missing.technicianId)) {
              totalEarnings += tech.earnings || 0;
              count++;
            }
          });
        });

        console.log(`Ukupna zarada: ${totalEarnings.toLocaleString()} RSD`);
        console.log(`Prosečna zarada: ${count > 0 ? Math.round(totalEarnings / count).toLocaleString() : 0} RSD`);
        console.log(`Broj naloga: ${count}`);
        console.log('');
      }

      // Proveri da li postoje obrisani tehničari
      console.log('\n=== PRETRAGA POTENCIJALNO OBRISANIH TEHNIČARA ===\n');

      const allTechnicians = await Technician.find({}).lean();
      console.log(`Ukupno tehničara u bazi: ${allTechnicians.length}`);
      console.log('');

      // Sačuvaj izveštaj
      const reportPath = path.join(__dirname, '../../missing_technicians_report.txt');
      const report = [
        'Izveštaj o tehničarima koji ne postoje u bazi ali imaju transakcije',
        `Datum: ${new Date().toLocaleString('sr-RS')}`,
        '',
        `Ukupno jedinstvenih tehničara u transakcijama: ${uniqueTechnicianIds.length}`,
        `Postojećih tehničara: ${existingTechnicians.length}`,
        `Tehničara koji ne postoje: ${missingTechnicians.length}`,
        '',
        '=== TEHNIČARI KOJI NE POSTOJE ===',
        ''
      ];

      for (const missing of missingTechnicians) {
        report.push(`Tehničar ID: ${missing.technicianId || 'NULL'}`);
        report.push(`Status: ${missing.status}`);

        const transactions = await FinancialTransaction.find({
          'technicians.technicianId': missing.technicianId
        }).lean();

        let totalEarnings = 0;
        let count = 0;

        transactions.forEach(tx => {
          tx.technicians.forEach(tech => {
            if (tech.technicianId?.toString() === missing.technicianId?.toString() ||
                (!tech.technicianId && !missing.technicianId)) {
              totalEarnings += tech.earnings || 0;
              count++;
            }
          });
        });

        report.push(`Broj transakcija: ${transactions.length}`);
        report.push(`Ukupna zarada: ${totalEarnings.toLocaleString()} RSD`);
        report.push(`Prosečna zarada: ${count > 0 ? Math.round(totalEarnings / count).toLocaleString() : 0} RSD`);
        report.push(`Broj naloga: ${count}`);
        report.push('');
      }

      report.push('');
      report.push('=== SVI TEHNIČARI U BAZI ===');
      report.push('');
      allTechnicians.forEach(tech => {
        report.push(`${tech._id} | ${tech.name} | ${tech.email || 'N/A'}`);
      });

      fs.writeFileSync(reportPath, report.join('\n'), 'utf8');
      console.log(`\nDetaljan izveštaj sačuvan u: ${reportPath}`);
    } else {
      console.log('Svi tehničari iz transakcija postoje u bazi!');
    }

  } catch (error) {
    console.error('Greška:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nOdpojen od MongoDB');
  }
}

findMissingTechnicians();
