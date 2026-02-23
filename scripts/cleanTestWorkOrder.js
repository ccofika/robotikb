/**
 * Skripta za brisanje test radnog naloga sa tisJobId: 123123123123123
 * Briše iz SVIH povezanih kolekcija.
 *
 * Pokretanje: node scripts/cleanTestWorkOrder.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const TEST_TIS_JOB_ID = '123123123123123';

async function cleanTestWorkOrder() {
  try {
    // Konekcija na bazu
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      console.error('MONGODB_URI nije postavljen u .env fajlu');
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log('Povezan na MongoDB');

    // Učitaj modele
    const WorkOrder = require('../models/WorkOrder');
    const WorkOrderEvidence = require('../models/WorkOrderEvidence');
    const FinancialTransaction = require('../models/FinancialTransaction');
    const FailedFinancialTransaction = require('../models/FailedFinancialTransaction');
    const DismissedWorkOrder = require('../models/DismissedWorkOrder');
    const Log = require('../models/Log');
    const Notification = require('../models/Notification');
    const AndroidNotification = require('../models/AndroidNotification');
    const AdminActivityLog = require('../models/AdminActivityLog');
    const Review = require('../models/Review');

    // 1. Pronađi radni nalog
    const workOrder = await WorkOrder.findOne({ tisJobId: TEST_TIS_JOB_ID });

    if (!workOrder) {
      console.log(`Radni nalog sa tisJobId "${TEST_TIS_JOB_ID}" nije pronađen. Nema šta da se briše.`);
      await mongoose.disconnect();
      return;
    }

    const woId = workOrder._id;
    console.log(`\nPronađen radni nalog: ${woId} (tisJobId: ${TEST_TIS_JOB_ID})`);
    console.log('-------------------------------------------');

    // 2. Brisanje iz svih povezanih kolekcija
    const results = {};

    results.financialTransaction = await FinancialTransaction.deleteMany({ workOrderId: woId });
    console.log(`FinancialTransaction:       ${results.financialTransaction.deletedCount} obrisano`);

    results.failedFinancial = await FailedFinancialTransaction.deleteMany({ workOrderId: woId });
    console.log(`FailedFinancialTransaction: ${results.failedFinancial.deletedCount} obrisano`);

    results.evidence = await WorkOrderEvidence.deleteMany({ workOrderId: woId });
    console.log(`WorkOrderEvidence:          ${results.evidence.deletedCount} obrisano`);

    results.dismissed = await DismissedWorkOrder.deleteMany({ workOrderId: woId });
    console.log(`DismissedWorkOrder:         ${results.dismissed.deletedCount} obrisano`);

    results.logs = await Log.deleteMany({ workOrderId: woId });
    console.log(`Log:                        ${results.logs.deletedCount} obrisano`);

    results.notifications = await Notification.deleteMany({ workOrderId: woId });
    console.log(`Notification:               ${results.notifications.deletedCount} obrisano`);

    results.androidNotifications = await AndroidNotification.deleteMany({ relatedId: woId });
    console.log(`AndroidNotification:        ${results.androidNotifications.deletedCount} obrisano`);

    results.adminLogs = await AdminActivityLog.deleteMany({ entityId: woId.toString() });
    console.log(`AdminActivityLog:           ${results.adminLogs.deletedCount} obrisano`);

    results.reviews = await Review.deleteMany({ workOrderId: woId });
    console.log(`Review:                     ${results.reviews.deletedCount} obrisano`);

    // 3. Brisanje samog radnog naloga
    await WorkOrder.deleteOne({ _id: woId });
    console.log(`WorkOrder:                  1 obrisano`);

    console.log('-------------------------------------------');
    console.log('Test radni nalog uspešno obrisan iz svih kolekcija.\n');

    await mongoose.disconnect();
  } catch (error) {
    console.error('Greška:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

cleanTestWorkOrder();
