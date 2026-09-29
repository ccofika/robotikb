const mongoose = require('mongoose');
const { Schema } = mongoose;

// Svako prislanjanje telefona na tag (i ono koje nije prošlo)
const SecurityScanSchema = new Schema({
  at: { type: Date, required: true, index: true },   // vreme događaja
  receivedAt: { type: Date, default: Date.now },
  deviceAt: { type: Date, default: null },
  clientId: { type: String, default: null },         // id iz aplikacije, za dedup posle rada bez interneta

  workerId: { type: Schema.Types.ObjectId, ref: 'SecurityWorker', index: true },
  workerName: { type: String, default: '' },
  shiftId: { type: Schema.Types.ObjectId, ref: 'SecurityShift', default: null, index: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'SecurityFacility', default: null, index: true },
  facilityName: { type: String, default: '' },
  tagId: { type: Schema.Types.ObjectId, ref: 'NfcTag', default: null },
  tagName: { type: String, default: '' },
  uid: { type: String, default: '', uppercase: true },
  category: { type: String, default: '' },

  result: {
    type: String,
    enum: ['clock_in', 'clock_out', 'checkpoint', 'extra', 'unknown_tag', 'replaced_tag', 'retired_tag',
      'no_shift', 'no_clock_in', 'shift_done', 'confirm_early', 'duplicate'],
    required: true
  },
  lateMin: { type: Number, default: 0 },
  message: { type: String, default: '' },
  geo: { lat: Number, lng: Number, acc: Number },
  offline: { type: Boolean, default: false },
  source: { type: String, default: 'nfc' },
  flags: [String],                                   // far (GPS van objekta), fast (prebrz obilazak), clock (razlika u vremenu)
  handled: { type: Boolean, default: false }         // nepoznat tag koji je admin rešio
}, { timestamps: false });

SecurityScanSchema.index({ clientId: 1 }, { sparse: true });
SecurityScanSchema.index({ result: 1, at: -1 });

module.exports = mongoose.models.SecurityScan || mongoose.model('SecurityScan', SecurityScanSchema);
