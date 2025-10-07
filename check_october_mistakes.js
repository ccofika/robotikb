const mongoose = require('mongoose');
require('dotenv').config();

// WorkOrder model definicija
const WorkOrderSchema = new mongoose.Schema({
  date: Date,
  time: String,
  municipality: String,
  address: String,
  type: String,
  technicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'Technician' },
  technician2Id: { type: mongoose.Schema.Types.ObjectId, ref: 'Technician' },
  details: String,
  comment: String,
  status: {
    type: String,
    enum: ['zavrsen', 'nezavrsen', 'otkazan', 'odlozen'],
    default: 'nezavrsen'
  },
  statusChangedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Technician' },
  statusChangedAt: Date,
  postponeDateTime: Date,
  postponeComment: String,
  tisId: String,
  tisJobId: String,
  userName: String,
  userPhone: String,
  userEmail: String,
  description: String,
  notes: String,
  verified: { type: Boolean, default: false },
  verifiedAt: Date,
  adminComment: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

const WorkOrder = mongoose.model('WorkOrder', WorkOrderSchema);

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

async function checkOctoberMistakes() {
  try {
    console.log('🔗 Povezujem se na MongoDB bazu...');

    // Povezivanje na bazu
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Povezano na MongoDB bazu!');

    // Definiši datumske opsege
    const septemberStart = new Date('2025-09-01T00:00:00.000Z');
    const septemberEnd = new Date('2025-09-30T23:59:59.999Z');
    const octoberStart = new Date('2025-10-01T00:00:00.000Z');

    console.log(`📅 Septembar: ${septemberStart.toLocaleDateString('sr-RS')} - ${septemberEnd.toLocaleDateString('sr-RS')}`);
    console.log(`📅 Oktobar početak: ${octoberStart.toLocaleDateString('sr-RS')}`);

    console.log('\n🔍 TRAŽIM FINANSIJSKE TRANSAKCIJE POSTAVLJENE NA 1. SEPTEMBAR...');

    // Pronađi sve transakcije postavljene na 1. septembar 2025
    const septemberTransactions = await FinancialTransaction.find({
      verifiedAt: {
        $gte: septemberStart,
        $lte: septemberEnd
      }
    });

    console.log(`📊 Pronađeno ${septemberTransactions.length} transakcija sa datumom u septembru`);

    if (septemberTransactions.length === 0) {
      console.log('ℹ️  Nema transakcija u septembru za proveru.');
      await mongoose.disconnect();
      return;
    }

    // Izvuci workOrderId-jeve iz ovih transakcija
    const workOrderIds = septemberTransactions.map(t => t.workOrderId);

    console.log('\n🔍 PROVERAVAM DATUME KREIRANJA RADNIH NALOGA...');

    // Pronađi odgovarajuće WorkOrder-e
    const workOrders = await WorkOrder.find({
      _id: { $in: workOrderIds }
    });

    console.log(`📊 Pronađeno ${workOrders.length} radnih naloga`);

    // Analiziraj svaki radni nalog
    let mistakesFound = 0;
    let correctlySeptember = 0;
    let missingWorkOrders = 0;

    console.log('\n📋 DETALJANA ANALIZA:');
    console.log('====================================');

    for (const transaction of septemberTransactions) {
      const workOrder = workOrders.find(wo => wo._id.toString() === transaction.workOrderId.toString());

      if (!workOrder) {
        missingWorkOrders++;
        console.log(`⚠️  NEDOSTAJE WorkOrder za transakciju ${transaction._id}`);
        continue;
      }

      const createdAt = new Date(workOrder.createdAt);
      const verifiedAt = new Date(transaction.verifiedAt);

      // Proveri da li je radni nalog kreiran u oktobru ili kasnije
      if (createdAt >= octoberStart) {
        mistakesFound++;
        console.log(`❌ GREŠKA PRONAĐENA:`);
        console.log(`   WorkOrder ID: ${workOrder._id}`);
        console.log(`   TIS Job ID: ${workOrder.tisJobId || 'N/A'}`);
        console.log(`   WorkOrder kreiran: ${createdAt.toLocaleString('sr-RS')}`);
        console.log(`   FinancialTransaction datum: ${verifiedAt.toLocaleString('sr-RS')}`);
        console.log(`   Opština: ${workOrder.municipality || 'N/A'}`);
        console.log(`   Status: ${workOrder.status || 'N/A'}`);
        console.log('   ---');
      } else {
        correctlySeptember++;
        // Samo izbrojimo, ne ispisujemo sve ispravne da ne zagadimo izlaz
      }
    }

    // Rezultati
    console.log('\n🎯 REZULTATI ANALIZE:');
    console.log(`📊 Ukupno transakcija u septembru: ${septemberTransactions.length}`);
    console.log(`✅ Ispravno postavljene (radni nalog kreiran pre oktobra): ${correctlySeptember}`);
    console.log(`❌ GREŠKE (radni nalog kreiran u oktobru ili kasnije): ${mistakesFound}`);
    console.log(`⚠️  Nedostaju WorkOrder zapisi: ${missingWorkOrders}`);

    if (mistakesFound === 0) {
      console.log('\n🎉 ODLIČNO! Nema grešaka - svi radni nalozi kreirani u oktobru su ispravno ostali u oktobru!');
    } else {
      console.log(`\n⚠️  PRONAĐENO ${mistakesFound} grešaka koje treba ispraviti!`);
      console.log('   Ovi radni nalozi su kreirani u oktobru ili kasnije, ali im je finansijska transakcija prebačena u septembar.');
    }

    await mongoose.disconnect();
    console.log('🔚 Konekcija zatvorena. Analiza završena!');

  } catch (error) {
    console.error('❌ Greška:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Pokretanje skripte
checkOctoberMistakes();