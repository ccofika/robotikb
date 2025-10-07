const mongoose = require('mongoose');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// FinancialTransaction model definicija
const FinancialTransactionSchema = new mongoose.Schema({
  workOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkOrder', required: true },
  customerStatus: { type: String, required: true },
  municipality: { type: String, required: true },
  basePrice: { type: Number, required: true },
  discountPercent: { type: Number, default: 0 },
  discountAmount: { type: Number, default: 0 },
  finalPrice: { type: Number, required: true },
  technicians: [{
    technicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'Technician', required: true },
    name: { type: String, required: true },
    earnings: { type: Number, required: true },
    paymentType: { type: String, enum: ['po_statusu', 'plata'], default: 'po_statusu' },
    salaryDetails: {
      monthlySalary: Number,
      earnedTowardsSalary: Number,
      hasExceededSalary: Boolean
    }
  }],
  totalTechnicianEarnings: { type: Number, required: true },
  companyProfit: { type: Number, required: true },
  verifiedAt: { type: Date, required: true, default: Date.now },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Technician' },
  notes: String
}, {
  timestamps: true
});

const FinancialTransaction = mongoose.model('FinancialTransaction', FinancialTransactionSchema);

async function verifyFinancialTransactionDates() {
  try {
    console.log('🔗 Povezujem se na MongoDB bazu...');

    // Povezivanje na bazu
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Povezano na MongoDB bazu!');

    // 1. Učitaj listu workOrder ID-jeva iz fajla
    console.log('📖 Učitavam listu workOrder ID-jeva iz fajla...');

    const filePath = path.join(__dirname, '..', 'radni_nalozi_od_1_oktobra_2025_finalno.txt');
    const fileContent = fs.readFileSync(filePath, 'utf8');

    // Ekstraktuj ID-jeve iz fajla
    const workOrderIdsFromFile = [];
    const lines = fileContent.split('\n');

    for (const line of lines) {
      const match = line.match(/ID:\s*([a-f0-9]{24})/i);
      if (match) {
        workOrderIdsFromFile.push(match[1]);
      }
    }

    console.log(`📦 Lista sadrži ${workOrderIdsFromFile.length} workOrder ID-jeva`);

    // 2. Definiši datumske opsege
    const septemberStart = new Date('2025-09-01T00:00:00.000Z');
    const septemberEnd = new Date('2025-09-30T23:59:59.999Z');
    const octoberStart = new Date('2025-10-01T00:00:00.000Z');
    const octoberEnd = new Date('2025-10-31T23:59:59.999Z');

    console.log(`📅 Septembar opseg: ${septemberStart.toLocaleDateString('sr-RS')} - ${septemberEnd.toLocaleDateString('sr-RS')}`);
    console.log(`📅 Oktobar opseg: ${octoberStart.toLocaleDateString('sr-RS')} - ${octoberEnd.toLocaleDateString('sr-RS')}`);

    // 3. Proveri transakcije iz liste (trebalo bi da budu u oktobru ili kasnije)
    console.log('\n🔍 PROVERAVAM TRANSAKCIJE IZ LISTE (trebalo bi da ostanu u oktobru ili kasnije)...');

    const transactionsFromList = await FinancialTransaction.find({
      workOrderId: { $in: workOrderIdsFromFile.map(id => new mongoose.Types.ObjectId(id)) }
    });

    console.log(`📊 Pronađeno ${transactionsFromList.length} transakcija za workOrder ID-jeve iz liste`);

    let correctlyInOctober = 0;
    let incorrectlyInSeptember = 0;
    let inOtherDates = 0;

    for (const transaction of transactionsFromList) {
      const verifiedDate = new Date(transaction.verifiedAt);

      if (verifiedDate >= octoberStart) {
        correctlyInOctober++;
      } else if (verifiedDate >= septemberStart && verifiedDate <= septemberEnd) {
        incorrectlyInSeptember++;
        console.log(`❌ GREŠKA: Transakcija ${transaction.workOrderId} je u septembru: ${verifiedDate.toLocaleDateString('sr-RS')}`);
      } else {
        inOtherDates++;
        console.log(`⚠️  Transakcija ${transaction.workOrderId} ima neočekivani datum: ${verifiedDate.toLocaleDateString('sr-RS')}`);
      }
    }

    console.log(`\n📊 REZULTATI ZA TRANSAKCIJE IZ LISTE:`);
    console.log(`✅ Ispravno u oktobru ili kasnije: ${correctlyInOctober}`);
    console.log(`❌ Pogrešno u septembru: ${incorrectlyInSeptember}`);
    console.log(`⚠️  Ostali datumi: ${inOtherDates}`);

    // 4. Proveri ostale transakcije (trebalo bi da budu u septembru)
    console.log('\n🔍 PROVERAVAM OSTALE TRANSAKCIJE (trebalo bi da budu prebačene u septembar)...');

    const otherTransactions = await FinancialTransaction.find({
      workOrderId: { $nin: workOrderIdsFromFile.map(id => new mongoose.Types.ObjectId(id)) }
    });

    console.log(`📊 Pronađeno ${otherTransactions.length} transakcija NIJE u listi`);

    let correctlyInSeptember = 0;
    let incorrectlyInOctober = 0;
    let inOtherDatesOther = 0;

    for (const transaction of otherTransactions) {
      const verifiedDate = new Date(transaction.verifiedAt);

      if (verifiedDate >= septemberStart && verifiedDate <= septemberEnd) {
        correctlyInSeptember++;
      } else if (verifiedDate >= octoberStart) {
        incorrectlyInOctober++;
        console.log(`❌ GREŠKA: Transakcija ${transaction.workOrderId} ostala u oktobru: ${verifiedDate.toLocaleDateString('sr-RS')}`);
      } else {
        inOtherDatesOther++;
        console.log(`⚠️  Transakcija ${transaction.workOrderId} ima neočekivani datum: ${verifiedDate.toLocaleDateString('sr-RS')}`);
      }
    }

    console.log(`\n📊 REZULTATI ZA OSTALE TRANSAKCIJE:`);
    console.log(`✅ Ispravno u septembru: ${correctlyInSeptember}`);
    console.log(`❌ Pogrešno u oktobru ili kasnije: ${incorrectlyInOctober}`);
    console.log(`⚠️  Ostali datumi: ${inOtherDatesOther}`);

    // 5. Ukupni rezime
    console.log(`\n🎯 UKUPNI REZIME:`);
    console.log(`📊 Ukupno transakcija: ${transactionsFromList.length + otherTransactions.length}`);
    console.log(`✅ Transakcije iz liste u oktobru: ${correctlyInOctober}/${transactionsFromList.length}`);
    console.log(`✅ Ostale transakcije u septembru: ${correctlyInSeptember}/${otherTransactions.length}`);
    console.log(`❌ Ukupno grešaka: ${incorrectlyInSeptember + incorrectlyInOctober}`);

    if (incorrectlyInSeptember + incorrectlyInOctober === 0) {
      console.log(`🎉 SAVRŠENO! Sve transakcije su ispravno raspoređene!`);
    } else {
      console.log(`⚠️  Ima ${incorrectlyInSeptember + incorrectlyInOctober} grešaka koje treba ispraviti.`);
    }

    await mongoose.disconnect();
    console.log('🔚 Konekcija zatvorena. Verifikacija završena!');

  } catch (error) {
    console.error('❌ Greška:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Pokretanje skripte
verifyFinancialTransactionDates();