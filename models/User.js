const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  tisId: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  address: {
    type: String,
    required: true
  },
  phone: {
    type: String
  },
  workOrders: [{
    type: Schema.Types.ObjectId,
    ref: 'WorkOrder'
  }]
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema); 