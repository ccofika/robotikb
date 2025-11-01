const mongoose = require('mongoose');
require('dotenv').config();

const { AdminActivityLog } = require('../models');

async function testRecentBulk() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected\n');

    // Get the MOST RECENT bulk_assigned log
    const recentBulkAssigned = await AdminActivityLog.findOne({
      'details.action': 'bulk_assigned'
    }).sort({ timestamp: -1 }).lean();

    if (recentBulkAssigned) {
      console.log('=== MOST RECENT BULK ASSIGNED ===');
      console.log('Timestamp:', recentBulkAssigned.timestamp);
      console.log('Action:', recentBulkAssigned.action);
      console.log('Category:', recentBulkAssigned.category);
      console.log('\nDetails object:');
      console.log(JSON.stringify(recentBulkAssigned.details, null, 2));
      console.log('\nFull log:');
      console.log(JSON.stringify(recentBulkAssigned, null, 2));
    } else {
      console.log('No bulk_assigned logs found');
    }

    // Get ALL logs from last hour to see what's being saved
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentLogs = await AdminActivityLog.find({
      timestamp: { $gte: oneHourAgo }
    }).sort({ timestamp: -1 }).limit(10).lean();

    console.log('\n\n=== RECENT LOGS (last hour, max 10) ===');
    recentLogs.forEach((log, i) => {
      console.log(`\n--- Log ${i + 1} ---`);
      console.log('Timestamp:', log.timestamp);
      console.log('Action:', log.action);
      console.log('Category:', log.category);
      console.log('Details.action:', log.details?.action);
      console.log('Has assignedItems:', !!log.details?.assignedItems);
      console.log('AssignedItems length:', log.details?.assignedItems?.length || 0);
    });

    await mongoose.disconnect();
    console.log('\n✅ Done');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testRecentBulk();
