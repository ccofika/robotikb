const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const fs = require('fs');

// Učitaj modele
const FinancialTransaction = require('../models/FinancialTransaction');
const WorkOrder = require('../models/WorkOrder');

// MongoDB konekcija
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/management-app';

async function verifyOctoberTransactions() {
  try {
    // Poveži se sa MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('Povezan sa MongoDB\n');

    // Učitaj radne naloge iz txt fajla
    const workOrdersPath = path.join(__dirname, '../../workorders_info_unique.txt');
    const content = fs.readFileSync(workOrdersPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim() !== '');

    // Parsiraj linije
    const workOrdersFromFile = [];
    lines.forEach(line => {
      const match = line.match(/_id: (\S+) \| tisJobId: (\S+) \| Kreiran: (.+)/);
      if (match) {
        const [, id, tisJobId, dateStr] = match;

        // Konvertuj datum iz srpskog formata u Date objekat
        const dateParts = dateStr.match(/(\d+)\. (\d+)\. (\d+)\. (\d+):(\d+):(\d+)/);
        if (dateParts) {
          const [, day, month, year, hour, minute, second] = dateParts;
          const date = new Date(year, month - 1, day, hour, minute, second);

          workOrdersFromFile.push({
            _id: id,
            tisJobId,
            dateStr,
            date
          });
        }
      }
    });

    console.log(`Učitano ${workOrdersFromFile.length} radnih naloga iz fajla\n`);

    // Definiši datum za oktobar 2025
    const octoberStart = new Date(2025, 9, 1, 0, 0, 0); // 1. oktobar 2025
    const octoberEnd = new Date(2025, 9, 31, 23, 59, 59); // 31. oktobar 2025

    console.log('=== PROVERA RADNIH NALOGA ===\n');
    console.log(`Period za proveru: ${octoberStart.toLocaleDateString('sr-RS')} - ${octoberEnd.toLocaleDateString('sr-RS')}\n`);

    const workOrderIds = workOrdersFromFile.map(wo => {
      try {
        return new mongoose.Types.ObjectId(wo._id);
      } catch (e) {
        return null;
      }
    }).filter(id => id !== null);

    // Proveri koji radni nalozi imaju finansijske transakcije
    const transactionsFound = await FinancialTransaction.find({
      workOrderId: { $in: workOrderIds }
    }).populate('workOrderId').lean();

    console.log(`Pronađeno ${transactionsFound.length} finansijskih transakcija\n`);

    // Mapa za brzu pretragu
    const transactionMap = {};
    transactionsFound.forEach(tx => {
      const woId = tx.workOrderId?._id?.toString();
      if (woId) {
        transactionMap[woId] = tx;
      }
    });

    // Proveri svaki radni nalog
    const results = {
      withTransactions: [],
      withoutTransactions: [],
      wrongDate: [],
      correctDate: []
    };

    for (const wo of workOrdersFromFile) {
      const transaction = transactionMap[wo._id];

      if (transaction) {
        const txDate = new Date(transaction.verifiedAt);
        const woDate = wo.date;

        // Proveri da li se datumi poklapaju (u okviru istog dana)
        const txDateStr = txDate.toLocaleDateString('sr-RS');
        const woDateStr = woDate.toLocaleDateString('sr-RS');

        if (txDateStr === woDateStr) {
          results.correctDate.push({
            woId: wo._id,
            tisJobId: wo.tisJobId,
            woDate: wo.dateStr,
            txDate: txDate.toLocaleString('sr-RS'),
            status: '✓ OK'
          });
        } else {
          results.wrongDate.push({
            woId: wo._id,
            tisJobId: wo.tisJobId,
            woDate: wo.dateStr,
            txDate: txDate.toLocaleString('sr-RS'),
            status: '✗ NEPODUDARANJE'
          });
        }

        results.withTransactions.push(wo._id);
      } else {
        results.withoutTransactions.push({
          woId: wo._id,
          tisJobId: wo.tisJobId,
          woDate: wo.dateStr,
          status: '✗ NEMA TRANSAKCIJE'
        });
      }
    }

    console.log('=== STATISTIKA ===\n');
    console.log(`Radnih naloga sa transakcijama: ${results.withTransactions.length}`);
    console.log(`Radnih naloga BEZ transakcija: ${results.withoutTransactions.length}`);
    console.log(`Transakcija sa ispravnim datumom: ${results.correctDate.length}`);
    console.log(`Transakcija sa POGREŠNIM datumom: ${results.wrongDate.length}\n`);

    if (results.wrongDate.length > 0) {
      console.log('=== TRANSAKCIJE SA POGREŠNIM DATUMOM ===\n');
      results.wrongDate.forEach((item, index) => {
        console.log(`${index + 1}. TIS Job ID: ${item.tisJobId}`);
        console.log(`   WorkOrder datum: ${item.woDate}`);
        console.log(`   Transaction datum: ${item.txDate}`);
        console.log(`   Status: ${item.status}\n`);
      });
    }

    if (results.withoutTransactions.length > 0) {
      console.log('=== RADNI NALOZI BEZ TRANSAKCIJA ===\n');
      results.withoutTransactions.slice(0, 10).forEach((item, index) => {
        console.log(`${index + 1}. TIS Job ID: ${item.tisJobId}`);
        console.log(`   WorkOrder ID: ${item.woId}`);
        console.log(`   Datum: ${item.woDate}`);
        console.log(`   Status: ${item.status}\n`);
      });

      if (results.withoutTransactions.length > 10) {
        console.log(`... i još ${results.withoutTransactions.length - 10} radnih naloga\n`);
      }
    }

    // Proveri dodatno - postoje li transakcije za oktobar koje NISU u našoj listi
    console.log('\n=== PROVERA DODATNIH TRANSAKCIJA U OKTOBRU ===\n');

    const allOctoberTransactions = await FinancialTransaction.find({
      verifiedAt: {
        $gte: octoberStart,
        $lte: octoberEnd
      }
    }).populate('workOrderId').lean();

    console.log(`Ukupno transakcija u oktobru: ${allOctoberTransactions.length}`);

    const extraTransactions = [];
    allOctoberTransactions.forEach(tx => {
      const woId = tx.workOrderId?._id?.toString();
      if (woId && !workOrderIds.some(id => id.toString() === woId)) {
        extraTransactions.push({
          txId: tx._id,
          woId: woId,
          tisJobId: tx.workOrderId?.tisJobId || tx.tisJobId,
          txDate: new Date(tx.verifiedAt).toLocaleString('sr-RS'),
          finalPrice: tx.finalPrice,
          companyProfit: tx.companyProfit
        });
      }
    });

    if (extraTransactions.length > 0) {
      console.log(`\n⚠️  Pronađeno ${extraTransactions.length} dodatnih transakcija koje NISU u listi:\n`);
      extraTransactions.slice(0, 10).forEach((item, index) => {
        console.log(`${index + 1}. TIS Job ID: ${item.tisJobId || 'N/A'}`);
        console.log(`   Transaction ID: ${item.txId}`);
        console.log(`   WorkOrder ID: ${item.woId}`);
        console.log(`   Datum: ${item.txDate}`);
        console.log(`   Finalna cena: ${item.finalPrice?.toLocaleString() || 0} RSD`);
        console.log(`   Profit: ${item.companyProfit?.toLocaleString() || 0} RSD\n`);
      });

      if (extraTransactions.length > 10) {
        console.log(`... i još ${extraTransactions.length - 10} transakcija\n`);
      }
    } else {
      console.log('✓ Nema dodatnih transakcija\n');
    }

    // Sačuvaj detaljan izveštaj
    const reportPath = path.join(__dirname, '../../october_transactions_verification_report.txt');
    const report = [
      'Izveštaj o verifikaciji finansijskih transakcija za oktobar 2025',
      `Datum: ${new Date().toLocaleString('sr-RS')}`,
      '',
      '=== STATISTIKA ===',
      '',
      `Radnih naloga iz fajla: ${workOrdersFromFile.length}`,
      `Radnih naloga sa transakcijama: ${results.withTransactions.length}`,
      `Radnih naloga BEZ transakcija: ${results.withoutTransactions.length}`,
      `Transakcija sa ispravnim datumom: ${results.correctDate.length}`,
      `Transakcija sa POGREŠNIM datumom: ${results.wrongDate.length}`,
      `Ukupno transakcija u oktobru (iz baze): ${allOctoberTransactions.length}`,
      `Dodatnih transakcija koje nisu u listi: ${extraTransactions.length}`,
      '',
      '=== TRANSAKCIJE SA POGREŠNIM DATUMOM ===',
      ''
    ];

    if (results.wrongDate.length > 0) {
      results.wrongDate.forEach((item, index) => {
        report.push(`${index + 1}. TIS Job ID: ${item.tisJobId}`);
        report.push(`   WorkOrder datum: ${item.woDate}`);
        report.push(`   Transaction datum: ${item.txDate}`);
        report.push(`   Status: ${item.status}`);
        report.push('');
      });
    } else {
      report.push('Nema transakcija sa pogrešnim datumom');
      report.push('');
    }

    report.push('');
    report.push('=== RADNI NALOZI BEZ TRANSAKCIJA ===');
    report.push('');

    if (results.withoutTransactions.length > 0) {
      results.withoutTransactions.forEach((item, index) => {
        report.push(`${index + 1}. TIS Job ID: ${item.tisJobId}`);
        report.push(`   WorkOrder ID: ${item.woId}`);
        report.push(`   Datum: ${item.woDate}`);
        report.push('');
      });
    } else {
      report.push('Svi radni nalozi imaju transakcije');
      report.push('');
    }

    if (extraTransactions.length > 0) {
      report.push('');
      report.push('=== DODATNE TRANSAKCIJE KOJE NISU U LISTI ===');
      report.push('');

      extraTransactions.forEach((item, index) => {
        report.push(`${index + 1}. TIS Job ID: ${item.tisJobId || 'N/A'}`);
        report.push(`   Transaction ID: ${item.txId}`);
        report.push(`   WorkOrder ID: ${item.woId}`);
        report.push(`   Datum: ${item.txDate}`);
        report.push(`   Finalna cena: ${item.finalPrice?.toLocaleString() || 0} RSD`);
        report.push(`   Profit: ${item.companyProfit?.toLocaleString() || 0} RSD`);
        report.push('');
      });
    }

    fs.writeFileSync(reportPath, report.join('\n'), 'utf8');
    console.log(`\nDetaljan izveštaj sačuvan u: ${reportPath}`);

  } catch (error) {
    console.error('Greška:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nOdpojen od MongoDB');
  }
}

verifyOctoberTransactions();
