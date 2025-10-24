const mongoose = require('mongoose');
require('dotenv').config();

const { AdminActivityLog } = require('../models');

async function checkBulkAssigned() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected\n');

    const bulkAssigned = await AdminActivityLog.findOne({ 'details.action': 'bulk_assigned' }).lean();

    if (bulkAssigned) {
      console.log('=== FULL BULK ASSIGNED LOG ===');
      console.log(JSON.stringify(bulkAssigned, null, 2));
    } else {
      console.log('No bulk_assigned found');
    }

    const bulkUnassigned = await AdminActivityLog.findOne({ 'details.action': 'bulk_unassigned' }).lean();

    if (bulkUnassigned) {
      console.log('\n=== FULL BULK UNASSIGNED LOG ===');
      console.log(JSON.stringify(bulkUnassigned, null, 2));
    } else {
      console.log('No bulk_unassigned found');
    }

    await mongoose.disconnect();
    console.log('\n✅ Done');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkBulkAssigned();
