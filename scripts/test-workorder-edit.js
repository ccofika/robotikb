const mongoose = require('mongoose');
require('dotenv').config();

const { AdminActivityLog } = require('../models');

async function testWorkorderEdit() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected\n');

    const editLog = await AdminActivityLog.findOne({
      category: 'workorders',
      action: 'workorder_edit'
    }).lean();

    if (editLog) {
      console.log('=== WORKORDER EDIT LOG ===');
      console.log('Full details:', JSON.stringify(editLog.details, null, 2));
    } else {
      console.log('No edit logs found');
    }

    await mongoose.disconnect();
    console.log('\n✅ Done');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testWorkorderEdit();
