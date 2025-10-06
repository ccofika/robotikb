// Quick script to check total logs in MongoDB
const mongoose = require('mongoose');

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/robotik', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  console.log('✅ Connected to MongoDB');

  // Define Log schema (minimal)
  const logSchema = new mongoose.Schema({}, { strict: false, collection: 'logs' });
  const Log = mongoose.model('Log', logSchema);

  try {
    // Count total logs
    const totalLogs = await Log.countDocuments({});
    console.log(`\n📊 TOTAL LOGS IN DATABASE: ${totalLogs}`);

    // Count by action type
    const actions = await Log.aggregate([
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    console.log('\n📋 Logs by Action Type:');
    actions.forEach(action => {
      console.log(`   - ${action._id || 'undefined'}: ${action.count}`);
    });

    // Count by technician
    const technicians = await Log.aggregate([
      { $group: { _id: '$performedByName', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    console.log('\n👷 Logs by Technician:');
    technicians.slice(0, 10).forEach(tech => {
      console.log(`   - ${tech._id || 'undefined'}: ${tech.count}`);
    });

    // Recent logs (last 10)
    const recentLogs = await Log.find({})
      .sort({ timestamp: -1 })
      .limit(10)
      .select('action description performedByName timestamp');

    console.log('\n🕒 Last 10 Logs:');
    recentLogs.forEach((log, idx) => {
      console.log(`   ${idx + 1}. [${log.action}] ${log.description || 'N/A'} - ${log.performedByName || 'N/A'} - ${new Date(log.timestamp).toLocaleString('sr-RS')}`);
    });

    // Check for logs without required fields
    const logsWithoutPerformedBy = await Log.countDocuments({ performedBy: { $exists: false } });
    const logsWithoutTimestamp = await Log.countDocuments({ timestamp: { $exists: false } });

    console.log('\n⚠️  Missing Data:');
    console.log(`   - Logs without performedBy: ${logsWithoutPerformedBy}`);
    console.log(`   - Logs without timestamp: ${logsWithoutTimestamp}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Connection closed');
    process.exit(0);
  }
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});
