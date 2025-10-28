const mongoose = require('mongoose');
require('dotenv').config();

const { AdminActivityLog, Technician } = require('../models');

async function testExportWorkorders() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected\n');

    // Query za workorders kao što backend radi
    const query = {
      category: 'workorders'
    };

    console.log('📊 Query:', JSON.stringify(query, null, 2));

    const activities = await AdminActivityLog.find(query)
      .sort({ timestamp: -1 })
      .limit(5)
      .lean();

    console.log(`\n✅ Found ${activities.length} activities\n`);

    // Helper function
    const getTechnicianName = async (technicianId) => {
      if (!technicianId) return '';
      try {
        const tech = await Technician.findById(technicianId).select('name').lean();
        return tech?.name || '';
      } catch (error) {
        return '';
      }
    };

    for (const activity of activities) {
      console.log('\n=== Activity ===');
      console.log('Timestamp:', activity.timestamp);
      console.log('Action:', activity.action);
      console.log('Category:', activity.category);

      if (activity.details?.action === 'bulk_created' && activity.details?.addedItems) {
        const items = activity.details.addedItems || [];
        console.log(`\n📦 BULK ADD - ${items.length} items`);

        // Show first item details
        if (items.length > 0) {
          const item = items[0];
          console.log('\n--- First item data ---');
          console.log('TIS Job ID:', item.tisJobId || 'MISSING');
          console.log('Adresa:', item.address || 'MISSING');
          console.log('Opština:', item.municipality || 'MISSING');
          console.log('Datum:', item.date || 'MISSING');
          console.log('Status:', item.status || 'MISSING');
          console.log('TechnicianId:', item.technicianId || 'MISSING');

          if (item.technicianId) {
            const techName = await getTechnicianName(item.technicianId);
            console.log('Tehnician Name (resolved):', techName || 'NOT FOUND');
          }
        }
      } else {
        // Single workorder
        const data = activity.details?.after || activity.details?.before || {};
        console.log('\n📋 SINGLE OPERATION');
        console.log('TIS Job ID:', data.tisJobId || 'MISSING');
        console.log('Adresa:', data.address || 'MISSING');
        console.log('Opština:', data.municipality || 'MISSING');
        console.log('Datum:', data.date || 'MISSING');
        console.log('Status:', data.status || 'MISSING');
        console.log('TechnicianId:', data.technicianId || 'MISSING');

        if (data.technicianId) {
          const techName = await getTechnicianName(data.technicianId);
          console.log('Technician Name (resolved):', techName || 'NOT FOUND');
        }
      }
    }

    await mongoose.disconnect();
    console.log('\n\n✅ Done');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testExportWorkorders();
