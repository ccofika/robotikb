const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

// Učitaj modele
const WorkOrder = require('../models/WorkOrder');
const WorkOrderEvidence = require('../models/WorkOrderEvidence');
const Technician = require('../models/Technician');

// MongoDB konekcija
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/management-app';

async function checkMissingTransactionsStatus() {
  try {
    // Poveži se sa MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('Povezan sa MongoDB\n');

    const missingWorkOrderIds = [
      '68dc5737cbf92023fe3a1cdf', // 636401305
      '68dc573acbf92023fe3a1e39', // 636190454
      '68de5fc8cbf92023fe3a510d', // 123123123
      '68dfdef0cbf92023fe3ab4d8', // 636391636
      '68e3fdcf0009e277975237d8', // 636678542
      '68e3fdd00009e2779752390a', // 636647876
      '68e3fdd10009e27797523958', // 636398549
      '68e3fdd10009e2779752394d', // 636400640
      '68e4c7a062e566782ef36213'  // 124356535234512
    ];

    console.log('=== PROVERA STATUSA RADNIH NALOGA BEZ TRANSAKCIJA ===\n');

    for (const woId of missingWorkOrderIds) {
      try {
        const workOrder = await WorkOrder.findById(woId)
          .populate('technicianId')
          .populate('technician2Id')
          .lean();

        if (!workOrder) {
          console.log(`✗ Radni nalog ${woId} NE POSTOJI u bazi\n`);
          continue;
        }

        console.log(`TIS Job ID: ${workOrder.tisJobId}`);
        console.log(`  _id: ${workOrder._id}`);
        console.log(`  Status: ${workOrder.status}`);
        console.log(`  Verified: ${workOrder.verified ? 'DA' : 'NE'}`);
        console.log(`  Verified At: ${workOrder.verifiedAt ? new Date(workOrder.verifiedAt).toLocaleString('sr-RS') : 'N/A'}`);
        console.log(`  Datum naloga: ${new Date(workOrder.date).toLocaleDateString('sr-RS')}`);
        console.log(`  Opština: ${workOrder.municipality}`);
        console.log(`  Tehničar 1: ${workOrder.technicianId?.name || 'N/A'}`);
        console.log(`  Tehničar 2: ${workOrder.technician2Id?.name || 'N/A'}`);

        // Proveri da li ima WorkOrderEvidence
        const evidence = await WorkOrderEvidence.findOne({ workOrderId: workOrder._id }).lean();
        if (evidence) {
          console.log(`  WorkOrderEvidence: DA`);
          console.log(`    Customer Status: ${evidence.customerStatus || 'N/A'}`);
        } else {
          console.log(`  WorkOrderEvidence: NE`);
        }

        // Razlog zašto nema transakciju
        if (workOrder.status !== 'zavrsen') {
          console.log(`  ⚠️  RAZLOG: Radni nalog nije završen (status: ${workOrder.status})`);
        } else if (!workOrder.verified) {
          console.log(`  ⚠️  RAZLOG: Radni nalog nije verifikovan`);
        } else if (!evidence) {
          console.log(`  ⚠️  RAZLOG: Nema WorkOrderEvidence (potreban za finansijski obračun)`);
        } else {
          console.log(`  ❓ RAZLOG: Nepoznat - trebalo bi da ima transakciju`);
        }

        console.log('');
      } catch (e) {
        console.log(`✗ Greška pri proveri radnog naloga ${woId}: ${e.message}\n`);
      }
    }

  } catch (error) {
    console.error('Greška:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Odpojen od MongoDB');
  }
}

checkMissingTransactionsStatus();
