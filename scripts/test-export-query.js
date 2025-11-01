const mongoose = require('mongoose');
require('dotenv').config();

const { AdminActivityLog } = require('../models');

async function testExportQuery() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected\n');

    // Test query kao što backend radi
    const query = {
      category: 'technicians',
      action: 'equipment_assign_to_tech'
    };

    console.log('📊 Query:', JSON.stringify(query, null, 2));

    const activities = await AdminActivityLog.find(query).limit(5).lean();

    console.log(`\n✅ Found ${activities.length} activities\n`);

    activities.forEach((activity, i) => {
      console.log(`\n=== Activity ${i + 1} ===`);
      console.log('Timestamp:', activity.timestamp);
      console.log('Action:', activity.action);
      console.log('Category:', activity.category);
      console.log('EntityName:', activity.entityName);
      console.log('Details.action:', activity.details?.action);
      console.log('Details.summary:', JSON.stringify(activity.details?.summary, null, 2));
      console.log('AssignedItems:', activity.details?.assignedItems ?
        `${activity.details.assignedItems.length} items` : 'NONE');

      if (activity.details?.assignedItems && activity.details.assignedItems.length > 0) {
        console.log('First item:', JSON.stringify(activity.details.assignedItems[0], null, 2));
      }
    });

    await mongoose.disconnect();
    console.log('\n✅ Done');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testExportQuery();
