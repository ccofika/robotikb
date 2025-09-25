const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const FailedFinancialTransactionSchema = new Schema({
  workOrderId: {
    type: Schema.Types.ObjectId,
    ref: 'WorkOrder',
    required: true,
    unique: true // Samo jedan failed zapis po work order-u
  },
  failureReason: {
    type: String,
    required: true,
    enum: [
      'MISSING_WORK_ORDER_EVIDENCE',
      'MISSING_CUSTOMER_STATUS',
      'MISSING_FINANCIAL_SETTINGS',
      'NO_PRICE_FOR_CUSTOMER_STATUS',
      'NO_TECHNICIANS_ASSIGNED',
      'WORK_ORDER_NOT_FOUND',
      'MISSING_TECHNICIAN_PRICING',
      'PENDING_DISCOUNT_CONFIRMATION',
      'OTHER_ERROR'
    ]
  },
  failureMessage: {
    type: String,
    required: true
  },
  missingFields: [{
    field: String,
    description: String
  }],
  workOrderDetails: {
    tisJobId: String,
    address: String,
    municipality: String,
    technicianNames: [String],
    customerStatus: String,
    status: String,
    verified: Boolean
  },
  attemptCount: {
    type: Number,
    default: 1
  },
  lastAttemptAt: {
    type: Date,
    default: Date.now
  },
  resolved: {
    type: Boolean,
    default: false
  },
  resolvedAt: {
    type: Date
  },
  // Za pending confirmations
  pendingDiscountConfirmation: {
    municipality: String,
    suggestedDiscount: { type: Number, default: 0 }
  },
  requiresAdminAction: {
    type: Boolean,
    default: false
  },
  // Da li je radni nalog potpuno isključen iz finansijskih kalkulacija
  excludedFromFinances: {
    type: Boolean,
    default: false
  },
  excludedAt: {
    type: Date
  },
  excludedBy: {
    type: String
  }
}, {
  timestamps: true
});

// Index za brže pretraživanje nerazrešenih slučajeva
FailedFinancialTransactionSchema.index({ resolved: 1, createdAt: -1 });

module.exports = mongoose.model('FailedFinancialTransaction', FailedFinancialTransactionSchema);