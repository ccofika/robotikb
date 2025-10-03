const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Import models
const WorkOrder = require('../models/WorkOrder');
const WorkOrderEvidence = require('../models/WorkOrderEvidence');

// Backup file paths
const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');
const BACKUP_TIMESTAMP = new Date().toISOString().replace(/:/g, '-').split('.')[0];

async function connectDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB uspešno povezan\n');
  } catch (error) {
    console.error('❌ Greška pri povezivanju sa MongoDB:', error.message);
    process.exit(1);
  }
}

async function analyzeCurrentData() {
  console.log('=== ANALIZA TRENUTNIH PODATAKA ===\n');

  // WorkOrder analiza
  console.log('📊 WORKORDER TABELA:');
  const workOrderStats = await WorkOrder.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        verifiedCount: {
          $sum: { $cond: [{ $eq: ['$verified', true] }, 1, 0] }
        },
        unverifiedCount: {
          $sum: { $cond: [{ $eq: ['$verified', false] }, 1, 0] }
        }
      }
    }
  ]);

  console.log('   Status distribucija:');
  workOrderStats.forEach(stat => {
    console.log(`   - ${stat._id}: ${stat.count} dokumenata`);
    console.log(`     └─ verified=true: ${stat.verifiedCount}, verified=false: ${stat.unverifiedCount}`);
  });

  const totalWorkOrders = await WorkOrder.countDocuments();
  const nezavrsenCount = await WorkOrder.countDocuments({ status: 'nezavrsen' });
  console.log(`\n   UKUPNO: ${totalWorkOrders} dokumenata`);
  console.log(`   🎯 Pogođeno "nezavrsen" statusom: ${nezavrsenCount} dokumenata\n`);

  // WorkOrderEvidence analiza
  console.log('📊 WORKORDEREVIDENCE TABELA:');
  const evidenceStats = await WorkOrderEvidence.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        verifiedCount: {
          $sum: { $cond: [{ $eq: ['$verified', true] }, 1, 0] }
        },
        unverifiedCount: {
          $sum: { $cond: [{ $eq: ['$verified', false] }, 1, 0] }
        }
      }
    }
  ]);

  console.log('   Status distribucija:');
  evidenceStats.forEach(stat => {
    console.log(`   - ${stat._id}: ${stat.count} dokumenata`);
    console.log(`     └─ verified=true: ${stat.verifiedCount}, verified=false: ${stat.unverifiedCount}`);
  });

  const totalEvidence = await WorkOrderEvidence.countDocuments();
  const uTokuCount = await WorkOrderEvidence.countDocuments({ status: 'U TOKU' });
  const missingCustomerStatus = await WorkOrderEvidence.countDocuments({
    $or: [
      { customerStatus: { $exists: false } },
      { customerStatus: null },
      { customerStatus: '' }
    ]
  });

  console.log(`\n   UKUPNO: ${totalEvidence} dokumenata`);
  console.log(`   🎯 Pogođeno "U TOKU" statusom: ${uTokuCount} dokumenata`);
  console.log(`   🎯 Dokumenti bez customerStatus: ${missingCustomerStatus} dokumenata\n`);

  return {
    workOrderStats: {
      total: totalWorkOrders,
      nezavrsenCount
    },
    evidenceStats: {
      total: totalEvidence,
      uTokuCount,
      missingCustomerStatus
    }
  };
}

async function createBackup() {
  console.log('=== KREIRANJE BACKUP-A ===\n');

  // Ensure backup directory exists
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log(`✅ Kreiran backup direktorijum: ${BACKUP_DIR}`);
  }

  try {
    // Backup WorkOrder documents that will be affected
    const workOrdersToBackup = await WorkOrder.find({ status: 'nezavrsen' }).lean();
    const workOrderBackupPath = path.join(BACKUP_DIR, `workorder_backup_${BACKUP_TIMESTAMP}.json`);
    fs.writeFileSync(workOrderBackupPath, JSON.stringify(workOrdersToBackup, null, 2));
    console.log(`✅ WorkOrder backup kreiran: ${workOrderBackupPath}`);
    console.log(`   - ${workOrdersToBackup.length} dokumenata sa status="nezavrsen"\n`);

    // Backup WorkOrderEvidence documents that will be affected
    const evidenceToBackup = await WorkOrderEvidence.find({
      $or: [
        { status: 'U TOKU' },
        { customerStatus: { $exists: false } },
        { customerStatus: null },
        { customerStatus: '' }
      ]
    }).lean();
    const evidenceBackupPath = path.join(BACKUP_DIR, `workorderevidence_backup_${BACKUP_TIMESTAMP}.json`);
    fs.writeFileSync(evidenceBackupPath, JSON.stringify(evidenceToBackup, null, 2));
    console.log(`✅ WorkOrderEvidence backup kreiran: ${evidenceBackupPath}`);
    console.log(`   - ${evidenceToBackup.length} dokumenata sa status="U TOKU" ili bez customerStatus\n`);

    return {
      workOrderBackupPath,
      evidenceBackupPath,
      workOrderCount: workOrdersToBackup.length,
      evidenceCount: evidenceToBackup.length
    };
  } catch (error) {
    console.error('❌ GREŠKA pri kreiranju backup-a:', error.message);
    throw error;
  }
}

async function showProposedChanges(stats) {
  console.log('=== PREDLOŽENE PROMENE ===\n');

  console.log('📝 WORKORDER promene:');
  console.log(`   1. UPDATE status: "nezavrsen" → "zavrsen"`);
  console.log(`      - Pogođeno dokumenata: ${stats.workOrderStats.nezavrsenCount}`);
  console.log(`   2. SET verified = true`);
  console.log(`      - Pogođeno dokumenata: ${stats.workOrderStats.nezavrsenCount}`);
  console.log('');

  console.log('📝 WORKORDEREVIDENCE promene:');
  console.log(`   1. UPDATE status: "U TOKU" → "ZAVRŠENO"`);
  console.log(`      - Pogođeno dokumenata: ${stats.evidenceStats.uTokuCount}`);
  console.log(`   2. SET customerStatus = "Nov Korisnik" (ako ne postoji)`);
  console.log(`      - Pogođeno dokumenata: ${stats.evidenceStats.missingCustomerStatus}`);
  console.log(`   3. SET verified = true`);
  console.log(`      - Pogođeno dokumenata: ${stats.evidenceStats.uTokuCount + stats.evidenceStats.missingCustomerStatus}`);
  console.log('');
}

async function executeUpdates() {
  console.log('=== IZVRŠAVANJE PROMENA ===\n');

  try {
    // Update WorkOrder
    console.log('🔄 Ažuriram WorkOrder tabelu...');
    const workOrderResult = await WorkOrder.updateMany(
      { status: 'nezavrsen' },
      {
        $set: {
          status: 'zavrsen',
          verified: true
        }
      }
    );
    console.log(`✅ WorkOrder: ${workOrderResult.modifiedCount} dokumenata ažurirano\n`);

    // Update WorkOrderEvidence - status
    console.log('🔄 Ažuriram WorkOrderEvidence status...');
    const evidenceStatusResult = await WorkOrderEvidence.updateMany(
      { status: 'U TOKU' },
      {
        $set: {
          status: 'ZAVRŠENO',
          verified: true
        }
      }
    );
    console.log(`✅ WorkOrderEvidence status: ${evidenceStatusResult.modifiedCount} dokumenata ažurirano\n`);

    // Update WorkOrderEvidence - customerStatus
    console.log('🔄 Ažuriram WorkOrderEvidence customerStatus...');
    const evidenceCustomerResult = await WorkOrderEvidence.updateMany(
      {
        $or: [
          { customerStatus: { $exists: false } },
          { customerStatus: null },
          { customerStatus: '' }
        ]
      },
      {
        $set: {
          customerStatus: 'Nov Korisnik',
          verified: true
        }
      }
    );
    console.log(`✅ WorkOrderEvidence customerStatus: ${evidenceCustomerResult.modifiedCount} dokumenata ažurirano\n`);

    return {
      workOrderModified: workOrderResult.modifiedCount,
      evidenceStatusModified: evidenceStatusResult.modifiedCount,
      evidenceCustomerModified: evidenceCustomerResult.modifiedCount
    };
  } catch (error) {
    console.error('❌ GREŠKA pri izvršavanju update-a:', error.message);
    throw error;
  }
}

async function verifyChanges() {
  console.log('=== VERIFIKACIJA PROMENA ===\n');

  // Verify WorkOrder
  const remainingNezavrsen = await WorkOrder.countDocuments({ status: 'nezavrsen' });
  const unverifiedWorkOrders = await WorkOrder.countDocuments({
    status: 'zavrsen',
    verified: false
  });

  console.log('✅ WORKORDER verifikacija:');
  console.log(`   - Preostalo "nezavrsen" statusа: ${remainingNezavrsen}`);
  console.log(`   - Broj "zavrsen" sa verified=false: ${unverifiedWorkOrders}`);

  if (remainingNezavrsen === 0) {
    console.log('   ✅ SVI "nezavrsen" statusi su promenjeni!\n');
  } else {
    console.log(`   ⚠️  UPOZORENJE: Još uvek postoji ${remainingNezavrsen} "nezavrsen" statusa!\n`);
  }

  // Verify WorkOrderEvidence
  const remainingUToku = await WorkOrderEvidence.countDocuments({ status: 'U TOKU' });
  const missingCustomerStatus = await WorkOrderEvidence.countDocuments({
    $or: [
      { customerStatus: { $exists: false } },
      { customerStatus: null },
      { customerStatus: '' }
    ]
  });
  const unverifiedEvidence = await WorkOrderEvidence.countDocuments({
    $or: [
      { status: 'ZAVRŠENO' },
      { customerStatus: 'Nov Korisnik' }
    ],
    verified: false
  });

  console.log('✅ WORKORDEREVIDENCE verifikacija:');
  console.log(`   - Preostalo "U TOKU" statusа: ${remainingUToku}`);
  console.log(`   - Dokumenata bez customerStatus: ${missingCustomerStatus}`);
  console.log(`   - Broj ažuriranih sa verified=false: ${unverifiedEvidence}`);

  if (remainingUToku === 0 && missingCustomerStatus === 0) {
    console.log('   ✅ SVE promene su uspešno izvršene!\n');
  } else {
    console.log(`   ⚠️  UPOZORENJE: Još uvek postoje neažurirani dokumenti!\n`);
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║   SKRIPTA ZA AŽURIRANJE STATUSA U BAZI PODATAKA          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    // Step 1: Connect to database
    await connectDatabase();

    // Step 2: Analyze current data
    const stats = await analyzeCurrentData();

    // Step 3: Create backup
    const backupInfo = await createBackup();

    // Step 4: Show proposed changes
    await showProposedChanges(stats);

    // Step 5: Ask for confirmation
    console.log('⚠️  UPOZORENJE: Ove promene će biti trajne!');
    console.log(`📁 Backup fajlovi kreirani u: ${BACKUP_DIR}`);
    console.log(`   - ${backupInfo.workOrderBackupPath}`);
    console.log(`   - ${backupInfo.evidenceBackupPath}\n`);

    console.log('❓ Da li želiš da nastaviš sa ažuriranjem? (da/ne)');
    console.log('   Pokreni skriptu sa argumentom "execute" za izvršavanje:');
    console.log('   node update_database_status.js execute\n');

    // Check if execute argument is provided
    if (process.argv[2] === 'execute') {
      console.log('✅ Korisnik je potvrdio - nastavljam sa ažuriranjem...\n');

      // Step 6: Execute updates
      const results = await executeUpdates();

      // Step 7: Verify changes
      await verifyChanges();

      console.log('╔════════════════════════════════════════════════════════════╗');
      console.log('║   AŽURIRANJE USPEŠNO ZAVRŠENO                             ║');
      console.log('╚════════════════════════════════════════════════════════════╝\n');
      console.log(`📊 Rezultati:`);
      console.log(`   - WorkOrder ažurirano: ${results.workOrderModified} dokumenata`);
      console.log(`   - WorkOrderEvidence (status): ${results.evidenceStatusModified} dokumenata`);
      console.log(`   - WorkOrderEvidence (customerStatus): ${results.evidenceCustomerModified} dokumenata\n`);
    } else {
      console.log('ℹ️  Skripta je pokrenuta u PREVIEW modu - nikakve promene nisu izvršene.');
      console.log('   Za izvršavanje promena pokreni: node update_database_status.js execute\n');
    }

  } catch (error) {
    console.error('\n❌ KRITIČNA GREŠKA:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('✅ Konekcija sa bazom zatvorena.');
  }
}

// Run the script
main();
