const mongoose = require('mongoose');
const { Log } = require('./models');

// Test data
const testLog = {
  action: 'comment_added',
  description: 'Test log entry',
  performedBy: new mongoose.Types.ObjectId(),
  performedByName: 'Test Technician',
  workOrderId: new mongoose.Types.ObjectId(),
  workOrderInfo: {
    municipality: 'Test Municipality',
    address: 'Test Address 123',
    type: 'Test Type',
    tisId: '12345',
    userName: 'Test User'
  },
  commentText: 'This is a test comment'
};

async function testLogging() {
  try {
    // Connect to MongoDB
    await mongoose.connect('mongodb+srv://ccofika:maksimgej@cluster0.ozvllua.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');
    console.log('Connected to MongoDB Atlas');

    // Create test log
    const log = new Log(testLog);
    await log.save();
    console.log('Test log created successfully:', log);

    // Retrieve the log
    const savedLog = await Log.findById(log._id);
    console.log('Retrieved log:', savedLog);

    process.exit(0);
  } catch (error) {
    console.error('Error testing logging:', error);
    process.exit(1);
  }
}

testLogging(); 