const mongoose = require('mongoose');
require('dotenv').config();

const { AdminActivityLog } = require('../models');

async function testWorkordersLogs() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected\n');

    // Test single workorder add
    const singleAdd = await AdminActivityLog.findOne({
      category: 'workorders',
      action: 'workorder_add'
    }).lean();

    if (singleAdd) {
      console.log('=== SINGLE WORKORDER ADD ===');
      console.log('Details:', JSON.stringify(singleAdd.details, null, 2));
    }

    // Test bulk add
    const bulkAdd = await AdminActivityLog.findOne({
      category: 'workorders',
      action: 'workorder_bulk_add'
    }).lean();

    if (bulkAdd && bulkAdd.details?.addedItems) {
      console.log('\n=== BULK WORKORDER ADD ===');
      console.log('First item:', JSON.stringify(bulkAdd.details.addedItems[0], null, 2));
    }

    await mongoose.disconnect();
    console.log('\n✅ Done');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testWorkordersLogs();
