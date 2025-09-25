const mongoose = require('mongoose');
const WorkOrder = require('../models/WorkOrder');
const WorkOrderEvidence = require('../models/WorkOrderEvidence');
const FinancialTransaction = require('../models/FinancialTransaction');
const FailedFinancialTransaction = require('../models/FailedFinancialTransaction');
const FinancialSettings = require('../models/FinancialSettings');
const MunicipalityDiscountConfirmation = require('../models/MunicipalityDiscountConfirmation');

// Import the financial transaction creation function
const { createFinancialTransaction } = require('../routes/workorders');

async function recalculateAllFinancialTransactions() {
  try {
    console.log('=== STARTING FINANCIAL RECALCULATION FOR ALL VERIFIED WORK ORDERS ===');

    // Connect to MongoDB if not already connected
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/robotikb', {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      console.log('Connected to MongoDB');
    }

    // Find all verified work orders that have status 'zavrsen'
    const verifiedWorkOrders = await WorkOrder.find({
      verified: true,
      status: 'zavrsen'
    }).populate('technicianId technician2Id');

    console.log(`Found ${verifiedWorkOrders.length} verified and completed work orders`);

    if (verifiedWorkOrders.length === 0) {
      console.log('No verified work orders found to recalculate');
      return {
        success: true,
        message: 'No verified work orders found to recalculate',
        processed: 0,
        errors: []
      };
    }

    // Statistics
    let processed = 0;
    let created = 0;
    let updated = 0;
    let errors = [];

    for (const workOrder of verifiedWorkOrders) {
      try {
        console.log(`\n--- Processing Work Order: ${workOrder.tisJobId || workOrder._id} ---`);

        // Check if financial transaction already exists
        const existingTransaction = await FinancialTransaction.findOne({
          workOrderId: workOrder._id
        });

        if (existingTransaction) {
          console.log(`Financial transaction already exists, deleting for recalculation...`);
          await FinancialTransaction.deleteOne({ workOrderId: workOrder._id });
          console.log('Existing transaction deleted');
        }

        // Remove any failed transactions for this work order
        await FailedFinancialTransaction.deleteMany({ workOrderId: workOrder._id });

        // Create new financial transaction using the existing logic
        await createFinancialTransaction(workOrder._id);

        // Check if transaction was created successfully
        const newTransaction = await FinancialTransaction.findOne({
          workOrderId: workOrder._id
        });

        if (newTransaction) {
          if (existingTransaction) {
            updated++;
            console.log('✅ Transaction updated successfully');
          } else {
            created++;
            console.log('✅ Transaction created successfully');
          }
        } else {
          // Check if it failed
          const failedTransaction = await FailedFinancialTransaction.findOne({
            workOrderId: workOrder._id
          });

          if (failedTransaction) {
            errors.push({
              workOrderId: workOrder._id,
              tisJobId: workOrder.tisJobId,
              error: failedTransaction.failureMessage,
              reason: failedTransaction.failureReason
            });
            console.log(`❌ Transaction failed: ${failedTransaction.failureMessage}`);
          } else {
            errors.push({
              workOrderId: workOrder._id,
              tisJobId: workOrder.tisJobId,
              error: 'Unknown error - no transaction or failed record found'
            });
            console.log('❌ Transaction failed with unknown error');
          }
        }

        processed++;

      } catch (error) {
        console.error(`Error processing work order ${workOrder._id}:`, error.message);
        errors.push({
          workOrderId: workOrder._id,
          tisJobId: workOrder.tisJobId,
          error: error.message,
          stack: error.stack
        });
        processed++;
      }
    }

    // Summary
    console.log('\n=== RECALCULATION COMPLETE ===');
    console.log(`Total work orders processed: ${processed}`);
    console.log(`New transactions created: ${created}`);
    console.log(`Existing transactions updated: ${updated}`);
    console.log(`Errors encountered: ${errors.length}`);

    if (errors.length > 0) {
      console.log('\n=== ERRORS ===');
      errors.forEach((error, index) => {
        console.log(`${index + 1}. Work Order: ${error.tisJobId || error.workOrderId}`);
        console.log(`   Error: ${error.error}`);
        if (error.reason) {
          console.log(`   Reason: ${error.reason}`);
        }
      });
    }

    return {
      success: true,
      processed,
      created,
      updated,
      errors,
      message: `Processed ${processed} work orders: ${created} created, ${updated} updated, ${errors.length} errors`
    };

  } catch (error) {
    console.error('Fatal error during recalculation:', error);
    return {
      success: false,
      error: error.message,
      processed: 0,
      created: 0,
      updated: 0,
      errors: []
    };
  }
}

// Function to recalculate specific work orders by their IDs
async function recalculateSpecificWorkOrders(workOrderIds) {
  try {
    console.log('=== RECALCULATING SPECIFIC WORK ORDERS ===');
    console.log('Work Order IDs:', workOrderIds);

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

    const results = [];

    for (const workOrderId of workOrderIds) {
      try {
        const workOrder = await WorkOrder.findById(workOrderId);
        if (!workOrder) {
          results.push({
            workOrderId,
            success: false,
            error: 'Work order not found'
          });
          continue;
        }

        if (!workOrder.verified || workOrder.status !== 'zavrsen') {
          results.push({
            workOrderId,
            tisJobId: workOrder.tisJobId,
            success: false,
            error: 'Work order is not verified and completed'
          });
          continue;
        }

        // Delete existing transaction and failed records
        await FinancialTransaction.deleteOne({ workOrderId });
        await FailedFinancialTransaction.deleteMany({ workOrderId });

        // Recalculate
        await createFinancialTransaction(workOrderId);

        // Check result
        const newTransaction = await FinancialTransaction.findOne({ workOrderId });
        if (newTransaction) {
          results.push({
            workOrderId,
            tisJobId: workOrder.tisJobId,
            success: true,
            message: 'Transaction recalculated successfully'
          });
        } else {
          const failedTransaction = await FailedFinancialTransaction.findOne({ workOrderId });
          results.push({
            workOrderId,
            tisJobId: workOrder.tisJobId,
            success: false,
            error: failedTransaction?.failureMessage || 'Unknown error'
          });
        }

      } catch (error) {
        results.push({
          workOrderId,
          success: false,
          error: error.message
        });
      }
    }

    return {
      success: true,
      results
    };

  } catch (error) {
    console.error('Error in recalculateSpecificWorkOrders:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Run the script if called directly
if (require.main === module) {
  recalculateAllFinancialTransactions()
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
  recalculateAllFinancialTransactions,
  recalculateSpecificWorkOrders
};