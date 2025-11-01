const mongoose = require('mongoose');
require('dotenv').config();

const { AdminActivityLog } = require('../models');

async function testAdminLogs() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Fetch different types of activities
    console.log('=== EQUIPMENT ACTIVITIES ===');
    const equipmentLogs = await AdminActivityLog.find({ category: 'equipment' }).limit(3).lean();
    console.log(JSON.stringify(equipmentLogs, null, 2));

    console.log('\n=== MATERIALS ACTIVITIES ===');
    const materialsLogs = await AdminActivityLog.find({ category: 'materials' }).limit(3).lean();
    console.log(JSON.stringify(materialsLogs, null, 2));

    console.log('\n=== TECHNICIANS ACTIVITIES ===');
    const techniciansLogs = await AdminActivityLog.find({ category: 'technicians' }).limit(3).lean();
    console.log(JSON.stringify(techniciansLogs, null, 2));

    console.log('\n=== WORKORDERS ACTIVITIES ===');
    const workordersLogs = await AdminActivityLog.find({ category: 'workorders' }).limit(2).lean();
    console.log(JSON.stringify(workordersLogs, null, 2));

    console.log('\n=== ALL ACTION TYPES ===');
    const actions = await AdminActivityLog.distinct('action');
    console.log('Actions:', actions);

    console.log('\n=== ALL CATEGORIES ===');
    const categories = await AdminActivityLog.distinct('category');
    console.log('Categories:', categories);

    console.log('\n=== SAMPLE BULK ASSIGNED ===');
    const bulkAssigned = await AdminActivityLog.findOne({ 'details.action': 'bulk_assigned' }).lean();
    if (bulkAssigned) {
      console.log('Action:', bulkAssigned.action);
      console.log('Category:', bulkAssigned.category);
      console.log('Details.action:', bulkAssigned.details?.action);
      console.log('Details.summary:', JSON.stringify(bulkAssigned.details?.summary, null, 2));
      console.log('Details.assignedItems (first 2):', JSON.stringify(bulkAssigned.details?.assignedItems?.slice(0, 2), null, 2));
    } else {
      console.log('No bulk_assigned logs found');
    }

    console.log('\n=== SAMPLE BULK CREATED ===');
    const bulkCreated = await AdminActivityLog.findOne({ 'details.action': 'bulk_created' }).lean();
    if (bulkCreated) {
      console.log('Action:', bulkCreated.action);
      console.log('Category:', bulkCreated.category);
      console.log('Details.action:', bulkCreated.details?.action);
      console.log('Details.summary:', JSON.stringify(bulkCreated.details?.summary, null, 2));
      console.log('Details.addedItems (first 2):', JSON.stringify(bulkCreated.details?.addedItems?.slice(0, 2), null, 2));
    } else {
      console.log('No bulk_created logs found');
    }

    console.log('\n=== SAMPLE MATERIAL ASSIGN ===');
    const materialAssign = await AdminActivityLog.findOne({ action: 'material_assign_to_tech' }).lean();
    if (materialAssign) {
      console.log(JSON.stringify(materialAssign, null, 2));
    } else {
      console.log('No material_assign_to_tech logs found');
    }

    console.log('\n=== SAMPLE EQUIPMENT ADD ===');
    const equipmentAdd = await AdminActivityLog.findOne({ action: 'equipment_add' }).lean();
    if (equipmentAdd) {
      console.log(JSON.stringify(equipmentAdd, null, 2));
    } else {
      console.log('No equipment_add logs found');
    }

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testAdminLogs();
