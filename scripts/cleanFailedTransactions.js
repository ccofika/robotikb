const mongoose = require('mongoose');
const FailedFinancialTransaction = require('../models/FailedFinancialTransaction');
const WorkOrder = require('../models/WorkOrder');

async function cleanFailedTransactions() {
  try {
    console.log('=== CLEANING FAILED FINANCIAL TRANSACTIONS ===');

    // Connect to MongoDB if not already connected
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/robotikb', {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      console.log('Connected to MongoDB');
    }

    // Find all failed transactions that should be deleted
    const failureMessagesToDelete = [
      'Cena nije postavljena za tip usluge: Nov korisnik',
      'WorkOrderEvidence zapis nije pronađen za ovaj radni nalog'
    ];

    console.log('Looking for failed transactions with these failure messages:');
    failureMessagesToDelete.forEach((msg, index) => {
      console.log(`${index + 1}. ${msg}`);
    });

    // Count how many will be deleted
    const toDeleteCount = await FailedFinancialTransaction.countDocuments({
      failureMessage: { $in: failureMessagesToDelete }
    });

    console.log(`\nFound ${toDeleteCount} failed transactions to delete`);

    if (toDeleteCount === 0) {
      console.log('No failed transactions found to delete');
      return {
        success: true,
        deleted: 0,
        message: 'No failed transactions found to delete'
      };
    }

    // Get details of what will be deleted (for logging purposes)
    const transactionsToDelete = await FailedFinancialTransaction.find({
      failureMessage: { $in: failureMessagesToDelete }
    }).populate('workOrderId', 'tisJobId address municipality');

    console.log('\nTransactions to be deleted:');
    transactionsToDelete.forEach((transaction, index) => {
      console.log(`${index + 1}. TIS: ${transaction.workOrderDetails?.tisJobId || 'N/A'} - ${transaction.failureMessage}`);
    });

    // Ask for confirmation (in production, you might want to make this automatic)
    console.log(`\n⚠️  About to delete ${toDeleteCount} failed transaction records...`);

    // Delete the transactions
    const deleteResult = await FailedFinancialTransaction.deleteMany({
      failureMessage: { $in: failureMessagesToDelete }
    });

    console.log(`✅ Successfully deleted ${deleteResult.deletedCount} failed transaction records`);

    // Summary
    console.log('\n=== CLEANUP COMPLETE ===');
    console.log(`Deleted records: ${deleteResult.deletedCount}`);

    return {
      success: true,
      deleted: deleteResult.deletedCount,
      message: `Successfully deleted ${deleteResult.deletedCount} failed transaction records`
    };

  } catch (error) {
    console.error('Fatal error during cleanup:', error);
    return {
      success: false,
      error: error.message,
      deleted: 0
    };
  }
}

// Function to clean specific failure reasons (more flexible)
async function cleanFailedTransactionsByReason(failureReasons) {
  try {
    console.log('=== CLEANING FAILED TRANSACTIONS BY REASON ===');

    if (!Array.isArray(failureReasons) || failureReasons.length === 0) {
      throw new Error('failureReasons must be a non-empty array');
    }

    // Connect to MongoDB if not already connected
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/robotikb', {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
    }

    console.log('Looking for failed transactions with these failure reasons:');
    failureReasons.forEach((reason, index) => {
      console.log(`${index + 1}. ${reason}`);
    });

    const deleteResult = await FailedFinancialTransaction.deleteMany({
      failureReason: { $in: failureReasons }
    });

    console.log(`✅ Successfully deleted ${deleteResult.deletedCount} failed transaction records`);

    return {
      success: true,
      deleted: deleteResult.deletedCount
    };

  } catch (error) {
    console.error('Error in cleanFailedTransactionsByReason:', error);
    return {
      success: false,
      error: error.message,
      deleted: 0
    };
  }
}

// Function to clean by specific work order IDs
async function cleanFailedTransactionsByWorkOrderIds(workOrderIds) {
  try {
    console.log('=== CLEANING FAILED TRANSACTIONS BY WORK ORDER IDS ===');

    if (!Array.isArray(workOrderIds) || workOrderIds.length === 0) {
      throw new Error('workOrderIds must be a non-empty array');
    }

    // Connect to MongoDB if not already connected
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/robotikb', {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
    }

    console.log(`Looking for failed transactions for ${workOrderIds.length} work orders...`);

    const deleteResult = await FailedFinancialTransaction.deleteMany({
      workOrderId: { $in: workOrderIds }
    });

    console.log(`✅ Successfully deleted ${deleteResult.deletedCount} failed transaction records`);

    return {
      success: true,
      deleted: deleteResult.deletedCount
    };

  } catch (error) {
    console.error('Error in cleanFailedTransactionsByWorkOrderIds:', error);
    return {
      success: false,
      error: error.message,
      deleted: 0
    };
  }
}

// Run the script if called directly
if (require.main === module) {
  cleanFailedTransactions()
    .then((result) => {
      console.log('\nScript completed:', result);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = {
  cleanFailedTransactions,
  cleanFailedTransactionsByReason,
  cleanFailedTransactionsByWorkOrderIds
};