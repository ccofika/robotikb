const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const DismissedWorkOrderSchema = new Schema({
  workOrderId: {
    type: Schema.Types.ObjectId,
    ref: 'WorkOrder',
    required: true,
    unique: true
  },
  dismissedAt: {
    type: Date,
    default: Date.now
  },
  dismissedBy: {
    type: String,
    default: 'admin'
  }
}, { timestamps: true });

module.exports = mongoose.model('DismissedWorkOrder', DismissedWorkOrderSchema);