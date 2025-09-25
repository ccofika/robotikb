const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const MunicipalityDiscountConfirmationSchema = new Schema({
  municipality: {
    type: String,
    required: true,
    unique: true
  },
  discountPercent: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
    max: 100
  },
  confirmedByAdmin: {
    type: Boolean,
    default: false
  },
  confirmedAt: {
    type: Date
  },
  confirmedBy: {
    type: String // Admin name or ID
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('MunicipalityDiscountConfirmation', MunicipalityDiscountConfirmationSchema);