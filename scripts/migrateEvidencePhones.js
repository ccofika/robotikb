const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Importovanje modela
const WorkOrder = require('../models/WorkOrder');
const WorkOrderEvidence = require('../models/WorkOrderEvidence');

// Funkcija za povezivanje sa MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB konekcija uspešna');
  } catch (error) {
    console.error('Greška pri povezivanju sa MongoDB:', error.message);
    process.exit(1);
  }
};

// Funkcija za migraciju telefona u WorkOrderEvidence
const migratePhones = async () => {
  try {
    // Postavi datum za poslednjih 4 dana
    const fourDaysAgo = new Date();
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
    fourDaysAgo.setHours(0, 0, 0, 0);

    console.log(`\n📞 Migracija telefona za radne naloge od ${fourDaysAgo.toLocaleDateString('sr-RS')}...\n`);

    // Pronađi sve WorkOrderEvidence zapise iz poslednjih 4 dana koji nemaju telefon
    const evidences = await WorkOrderEvidence.find({
      executionDate: { $gte: fourDaysAgo },
      $or: [
        { userPhone: { $exists: false } },
        { userPhone: null },
        { userPhone: '' }
      ]
    });

    console.log(`Pronađeno ${evidences.length} evidencija bez telefona.\n`);

    let updated = 0;
    let notFound = 0;
    let alreadyHasPhone = 0;

    for (const evidence of evidences) {
      // Pronađi originalni WorkOrder
      const workOrder = await WorkOrder.findById(evidence.workOrderId);

      if (!workOrder) {
        console.log(`⚠️  WorkOrder nije pronađen za evidenciju: ${evidence.tisJobId}`);
        notFound++;
        continue;
      }

      if (workOrder.userPhone) {
        // Ažuriraj WorkOrderEvidence sa telefonom
        evidence.userPhone = workOrder.userPhone;
        await evidence.save();
        console.log(`✅ Ažuriran telefon za: ${evidence.tisJobId} -> ${workOrder.userPhone}`);
        updated++;
      } else {
        console.log(`ℹ️  WorkOrder ${evidence.tisJobId} nema telefon`);
        alreadyHasPhone++;
      }
    }

    console.log('\n========================================');
    console.log('📊 REZULTAT MIGRACIJE:');
    console.log('========================================');
    console.log(`✅ Ažurirano: ${updated}`);
    console.log(`⚠️  WorkOrder nije pronađen: ${notFound}`);
    console.log(`ℹ️  Bez telefona u WorkOrder: ${alreadyHasPhone}`);
    console.log('========================================\n');

  } catch (error) {
    console.error('Greška pri migraciji:', error);
    throw error;
  }
};

// Glavna funkcija
const main = async () => {
  try {
    await connectDB();
    await migratePhones();
    console.log('✅ Migracija završena uspešno!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Greška pri migraciji:', error);
    process.exit(1);
  }
};

main();
