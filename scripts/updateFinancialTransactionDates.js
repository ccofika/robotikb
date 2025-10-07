const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const fs = require('fs');

// Učitaj modele
const FinancialTransaction = require('../models/FinancialTransaction');

// MongoDB konekcija
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/management-app';

async function updateFinancialTransactionDates() {
  try {
    // Poveži se sa MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('Povezan sa MongoDB');

    // Učitaj radne naloge iz txt fajla
    const workOrdersPath = path.join(__dirname, '../../workorders_info_unique.txt');
    const content = fs.readFileSync(workOrdersPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim() !== '');

    // Parsiraj linije i kreiraj mapu _id -> datum
    const workOrderDates = {};
    lines.forEach(line => {
      const match = line.match(/_id: (\S+) \| tisJobId: (\S+) \| Kreiran: (.+)/);
      if (match) {
        const [, id, tisJobId, dateStr] = match;

        // Konvertuj datum iz srpskog formata u Date objekat
        // Format: "1. 10. 2025. 00:18:31"
        const dateParts = dateStr.match(/(\d+)\. (\d+)\. (\d+)\. (\d+):(\d+):(\d+)/);
        if (dateParts) {
          const [, day, month, year, hour, minute, second] = dateParts;
          const date = new Date(year, month - 1, day, hour, minute, second);
          workOrderDates[id] = date;
        }
      }
    });

    console.log(`\nUčitano ${Object.keys(workOrderDates).length} radnih naloga iz fajla`);

    // Definiši datum 1.10.2025. 00:00:00
    const cutoffDate = new Date(2025, 9, 1, 0, 0, 0); // Month is 0-indexed (9 = October)

    // Pronađi sve transakcije za radne naloge iz liste
    const workOrderIds = Object.keys(workOrderDates).map(id => {
      try {
        return new mongoose.Types.ObjectId(id);
      } catch (e) {
        return null;
      }
    }).filter(id => id !== null);

    console.log(`\nPretražujem transakcije za ${workOrderIds.length} radnih naloga...`);

    const transactions = await FinancialTransaction.find({
      workOrderId: { $in: workOrderIds }
    });

    console.log(`\nPronađeno ${transactions.length} finansijskih transakcija`);

    // Filtriraj transakcije koje imaju datum pre 1.10.2025
    const transactionsToUpdate = transactions.filter(tx => {
      const verifiedAt = new Date(tx.verifiedAt);
      return verifiedAt < cutoffDate;
    });

    console.log(`\nTransakcija sa datumom pre 1.10.2025: ${transactionsToUpdate.length}`);

    if (transactionsToUpdate.length === 0) {
      console.log('\nNema transakcija za ažuriranje!');
      return;
    }

    // Prikaz prvih 10 transakcija koje će biti ažurirane
    console.log('\nPrvih 10 transakcija koje će biti ažurirane:');
    transactionsToUpdate.slice(0, 10).forEach(tx => {
      const oldDate = new Date(tx.verifiedAt);
      const newDate = workOrderDates[tx.workOrderId.toString()];
      console.log(`  Transaction ${tx._id}:`);
      console.log(`    WorkOrder: ${tx.workOrderId}`);
      console.log(`    Stari datum: ${oldDate.toLocaleString('sr-RS')}`);
      console.log(`    Novi datum:  ${newDate.toLocaleString('sr-RS')}`);
    });

    // Pitaj korisnika za potvrdu
    console.log(`\n\nSpremno za ažuriranje ${transactionsToUpdate.length} transakcija.`);
    console.log('Pokretanje ažuriranja...\n');

    // Ažuriraj transakcije
    let updatedCount = 0;
    let errorCount = 0;

    for (const tx of transactionsToUpdate) {
      try {
        const newDate = workOrderDates[tx.workOrderId.toString()];
        if (newDate) {
          tx.verifiedAt = newDate;
          await tx.save();
          updatedCount++;

          if (updatedCount % 10 === 0) {
            console.log(`Ažurirano: ${updatedCount}/${transactionsToUpdate.length}`);
          }
        }
      } catch (error) {
        console.error(`Greška pri ažuriranju transakcije ${tx._id}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n=== REZULTATI ===');
    console.log(`Uspešno ažurirano: ${updatedCount}`);
    console.log(`Greške: ${errorCount}`);

    // Sačuvaj izveštaj u fajl
    const reportPath = path.join(__dirname, '../../financial_transactions_update_report.txt');
    const report = [
      `Izveštaj o ažuriranju finansijskih transakcija`,
      `Datum: ${new Date().toLocaleString('sr-RS')}`,
      ``,
      `Ukupno transakcija: ${transactions.length}`,
      `Transakcija za ažuriranje: ${transactionsToUpdate.length}`,
      `Uspešno ažurirano: ${updatedCount}`,
      `Greške: ${errorCount}`,
      ``,
      `Ažurirane transakcije:`,
      ...transactionsToUpdate.map(tx => {
        const oldDate = new Date(tx.verifiedAt);
        const newDate = workOrderDates[tx.workOrderId.toString()];
        return `  ${tx._id} | WorkOrder: ${tx.workOrderId} | ${oldDate.toLocaleString('sr-RS')} -> ${newDate.toLocaleString('sr-RS')}`;
      })
    ].join('\n');

    fs.writeFileSync(reportPath, report, 'utf8');
    console.log(`\nIzveštaj sačuvan u: ${reportPath}`);

  } catch (error) {
    console.error('Greška:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nOdpojen od MongoDB');
  }
}

updateFinancialTransactionDates();
