const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const MaterialSchema = new Schema({
  type: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    default: 0,
    min: 0
  }
}, { timestamps: true });

module.exports = mongoose.model('Material', MaterialSchema); 