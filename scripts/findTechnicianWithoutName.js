const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const fs = require('fs');

// Učitaj modele
const FinancialTransaction = require('../models/FinancialTransaction');
const Technician = require('../models/Technician');

// MongoDB konekcija
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/management-app';

async function findTechnicianWithoutName() {
  try {
    // Poveži se sa MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('Povezan sa MongoDB\n');

    // Pronađi sve finansijske transakcije koje imaju tehničara bez imena ili sa praznim imenom
    const transactions = await FinancialTransaction.find({
      $or: [
        { 'technicians.name': null },
        { 'technicians.name': '' },
        { 'technicians.name': { $exists: false } }
      ]
    }).populate('workOrderId').lean();

    console.log(`Pronađeno ${transactions.length} transakcija sa problemom\n`);

    if (transactions.length === 0) {
      console.log('Nema transakcija sa problemom sa imenom tehničara!');
      return;
    }

    // Analiziraj svaku transakciju
    const problemTechnicians = [];
    const technicianStats = {};

    for (const transaction of transactions) {
      for (const tech of transaction.technicians) {
        if (!tech.name || tech.name.trim() === '') {
          const techId = tech.technicianId?.toString() || 'undefined';

          if (!technicianStats[techId]) {
            technicianStats[techId] = {
              technicianId: techId,
              transactionIds: [],
              workOrderIds: [],
              totalEarnings: 0,
              count: 0
            };
          }

          technicianStats[techId].transactionIds.push(transaction._id);
          if (transaction.workOrderId) {
            technicianStats[techId].workOrderIds.push(transaction.workOrderId._id);
          }
          technicianStats[techId].totalEarnings += tech.earnings || 0;
          technicianStats[techId].count += 1;

          problemTechnicians.push({
            transactionId: transaction._id,
            workOrderId: transaction.workOrderId?._id,
            tisJobId: transaction.workOrderId?.tisJobId || transaction.tisJobId,
            technicianId: tech.technicianId,
            earnings: tech.earnings,
            verifiedAt: transaction.verifiedAt
          });
        }
      }
    }

    console.log('=== STATISTIKA PO TEHNIČARIMA ===\n');
    for (const [techId, stats] of Object.entries(technicianStats)) {
      console.log(`Tehničar ID: ${techId}`);
      console.log(`  Broj transakcija: ${stats.count}`);
      console.log(`  Ukupna zarada: ${stats.totalEarnings.toLocaleString()} RSD`);
      console.log(`  Prosek po transakciji: ${Math.round(stats.totalEarnings / stats.count).toLocaleString()} RSD`);

      // Pokušaj da pronađeš tehničara u bazi
      if (techId !== 'undefined') {
        try {
          const technician = await Technician.findById(techId);
          if (technician) {
            console.log(`  ✓ Tehničar pronađen u bazi: ${technician.name} (${technician.email || 'nema email'})`);
          } else {
            console.log(`  ✗ Tehničar NE POSTOJI u bazi!`);
          }
        } catch (e) {
          console.log(`  ✗ Greška pri pretraživanju tehničara: ${e.message}`);
        }
      } else {
        console.log(`  ✗ Tehničar ID je undefined/null`);
      }
      console.log('');
    }

    console.log('\n=== PRVIH 10 PROBLEMA ===\n');
    problemTechnicians.slice(0, 10).forEach((problem, index) => {
      console.log(`${index + 1}. Transaction: ${problem.transactionId}`);
      console.log(`   TIS Job ID: ${problem.tisJobId || 'N/A'}`);
      console.log(`   Technician ID: ${problem.technicianId || 'N/A'}`);
      console.log(`   Earnings: ${problem.earnings?.toLocaleString() || 0} RSD`);
      console.log(`   Verified At: ${new Date(problem.verifiedAt).toLocaleString('sr-RS')}`);
      console.log('');
    });

    // Sačuvaj detaljan izveštaj
    const reportPath = path.join(__dirname, '../../technician_without_name_report.txt');
    const report = [
      'Izveštaj o tehničarima bez imena u finansijskim transakcijama',
      `Datum: ${new Date().toLocaleString('sr-RS')}`,
      '',
      `Ukupno transakcija sa problemom: ${transactions.length}`,
      '',
      '=== STATISTIKA PO TEHNIČARIMA ===',
      ''
    ];

    for (const [techId, stats] of Object.entries(technicianStats)) {
      report.push(`Tehničar ID: ${techId}`);
      report.push(`  Broj transakcija: ${stats.count}`);
      report.push(`  Ukupna zarada: ${stats.totalEarnings.toLocaleString()} RSD`);
      report.push(`  Prosek: ${Math.round(stats.totalEarnings / stats.count).toLocaleString()} RSD`);

      if (techId !== 'undefined') {
        try {
          const technician = await Technician.findById(techId);
          if (technician) {
            report.push(`  Ime: ${technician.name}`);
            report.push(`  Email: ${technician.email || 'N/A'}`);
          } else {
            report.push(`  STATUS: Tehničar NE POSTOJI u bazi`);
          }
        } catch (e) {
          report.push(`  GREŠKA: ${e.message}`);
        }
      } else {
        report.push(`  STATUS: Tehničar ID je undefined/null`);
      }
      report.push('');
    }

    report.push('');
    report.push('=== SVE TRANSAKCIJE SA PROBLEMOM ===');
    report.push('');

    problemTechnicians.forEach((problem, index) => {
      report.push(`${index + 1}. Transaction: ${problem.transactionId}`);
      report.push(`   TIS Job ID: ${problem.tisJobId || 'N/A'}`);
      report.push(`   Technician ID: ${problem.technicianId || 'N/A'}`);
      report.push(`   Earnings: ${problem.earnings?.toLocaleString() || 0} RSD`);
      report.push(`   Verified At: ${new Date(problem.verifiedAt).toLocaleString('sr-RS')}`);
      report.push('');
    });

    fs.writeFileSync(reportPath, report.join('\n'), 'utf8');
    console.log(`\nDetaljan izveštaj sačuvan u: ${reportPath}`);

  } catch (error) {
    console.error('Greška:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nOdpojen od MongoDB');
  }
}

findTechnicianWithoutName();
