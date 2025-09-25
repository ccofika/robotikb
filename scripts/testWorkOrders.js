const { connectDB } = require('../config/db');
const { User, WorkOrder } = require('../models');
const mongoose = require('mongoose');

async function testWorkOrders() {
  try {
    console.log('🔍 Testing WorkOrder aggregation...');

    // Get first 5 users
    const users = await User.find().limit(5).lean();
    console.log(`Found ${users.length} users for testing`);
    console.log('Sample users:', users.map(u => ({ id: u._id.toString(), tisId: u.tisId, name: u.name })));

    // Check total work orders
    const totalWorkOrders = await WorkOrder.countDocuments();
    console.log(`Total work orders in database: ${totalWorkOrders}`);

    // Check work orders structure
    const sampleWorkOrder = await WorkOrder.findOne().lean();
    console.log('Sample work order structure:');
    if (sampleWorkOrder) {
      console.log({
        _id: sampleWorkOrder._id,
        user: sampleWorkOrder.user,
        tisId: sampleWorkOrder.tisId,
        status: sampleWorkOrder.status,
        hasUserField: !!sampleWorkOrder.user
      });
    }

    // Test aggregation with user IDs
    const userIds = users.map(u => u._id);
    console.log('\nTesting aggregation with userIds:', userIds.map(id => id.toString()));

    const workOrderCounts = await WorkOrder.aggregate([
      { $match: { user: { $in: userIds } } },
      { $group: { _id: '$user', count: { $sum: 1 } } }
    ]);

    console.log('Work order counts result:', workOrderCounts);

    // Test with specific user
    if (users.length > 0) {
      const specificUser = users[0];
      console.log(`\nChecking work orders for specific user: ${specificUser.name} (${specificUser._id})`);

      const directCount = await WorkOrder.countDocuments({ user: specificUser._id });
      console.log(`Direct count for user ${specificUser._id}: ${directCount}`);

      const workOrdersForUser = await WorkOrder.find({ user: specificUser._id }).select('_id tisId status').lean();
      console.log(`Work orders for this user:`, workOrdersForUser);
    }

  } catch (error) {
    console.error('❌ Error testing work orders:', error);
  } finally {
    mongoose.disconnect();
    process.exit(0);
  }
}

// Connect to database and test
connectDB().then(() => {
  testWorkOrders();
});