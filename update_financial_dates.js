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

async function updateFinancialTransactionDates() {
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

    // Ekstraktuj ID-jeve iz fajla (format: "1. ID: 68e4c7a062e566782ef36213 |")
    const workOrderIds = [];
    const lines = fileContent.split('\n');

    for (const line of lines) {
      const match = line.match(/ID:\s*([a-f0-9]{24})/i);
      if (match) {
        workOrderIds.push(match[1]);
      }
    }

    console.log(`📦 Učitao ${workOrderIds.length} workOrder ID-jeva iz fajla`);

    if (workOrderIds.length === 0) {
      console.log('❌ Nema ID-jeva za obradu!');
      await mongoose.disconnect();
      return;
    }

    // 2. Pronađi sve finansijske transakcije
    console.log('🔍 Pronalazim sve finansijske transakcije...');

    const allTransactions = await FinancialTransaction.find({});
    console.log(`📊 Ukupno finansijskih transakcija: ${allTransactions.length}`);

    // 3. Filtriraj transakcije koje NISU u listi (treba ih ažurirati)
    const transactionsToUpdate = allTransactions.filter(transaction => {
      const workOrderIdStr = transaction.workOrderId.toString();
      return !workOrderIds.includes(workOrderIdStr);
    });

    console.log(`🎯 Transakcije za ažuriranje: ${transactionsToUpdate.length}`);
    console.log(`✅ Transakcije koje ostaju: ${allTransactions.length - transactionsToUpdate.length}`);

    if (transactionsToUpdate.length === 0) {
      console.log('ℹ️  Nema transakcija za ažuriranje.');
      await mongoose.disconnect();
      return;
    }

    // 4. Postavi novi datum (1. septembar 2025)
    const newDate = new Date('2025-09-01T00:00:00.000Z');
    console.log(`📅 Novi datum za ažuriranje: ${newDate.toISOString()}`);

    // 5. Ažuriraj transakcije
    console.log('🔄 Ažuriram datume finansijskih transakcija...');

    let updatedCount = 0;
    let errorCount = 0;

    for (const transaction of transactionsToUpdate) {
      try {
        await FinancialTransaction.updateOne(
          { _id: transaction._id },
          { verifiedAt: newDate }
        );
        updatedCount++;

        if (updatedCount % 50 === 0) {
          console.log(`   ⏳ Ažurirano ${updatedCount}/${transactionsToUpdate.length} transakcija...`);
        }
      } catch (error) {
        console.error(`❌ Greška pri ažuriranju transakcije ${transaction._id}:`, error.message);
        errorCount++;
      }
    }

    // 6. Rezultati
    console.log('\n🎉 ZAVRŠENO!');
    console.log(`✅ Uspešno ažurirano: ${updatedCount} transakcija`);
    console.log(`❌ Greške: ${errorCount} transakcija`);
    console.log(`📅 Novi datum: ${newDate.toLocaleDateString('sr-RS')}`);

    // Verifikacija - proveri koliko transakcija sada ima novi datum
    const verificationCount = await FinancialTransaction.countDocuments({
      verifiedAt: newDate
    });
    console.log(`🔍 Verifikacija: ${verificationCount} transakcija ima datum ${newDate.toLocaleDateString('sr-RS')}`);

    await mongoose.disconnect();
    console.log('🔚 Konekcija zatvorena. Proces završen!');

  } catch (error) {
    console.error('❌ Greška:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Pokretanje skripte
updateFinancialTransactionDates();