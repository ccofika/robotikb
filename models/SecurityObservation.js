const mongoose = require('mongoose');
const { Schema } = mongoose;

// Zapažanje radnika ili izveštaj o primenjenim ovlašćenjima (kind), uz fotografije
const SecurityObservationSchema = new Schema({
  kind: { type: String, enum: ['observation', 'authority'], default: 'observation', index: true },
  shiftId: { type: Schema.Types.ObjectId, ref: 'SecurityShift', default: null, index: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'SecurityFacility', default: null, index: true },
  facilityName: { type: String, default: '' },
  workerId: { type: Schema.Types.ObjectId, ref: 'SecurityWorker', required: true, index: true },
  workerName: { type: String, default: '' },
  at: { type: Date, default: Date.now, index: true },
  clientId: { type: String, default: null },

  text: { type: String, required: true, trim: true },       // zapažanje ili opis događaja
  power: { type: String, default: '' },                      // vrsta ovlašćenja
  subject: { type: String, default: '' },                    // lice na koje je primenjeno
  witnesses: { type: String, default: '' },
  photos: [{ url: String, publicId: String, local: Boolean }]
}, { timestamps: true });

SecurityObservationSchema.index({ clientId: 1 }, { sparse: true });

module.exports = mongoose.models.SecurityObservation || mongoose.model('SecurityObservation', SecurityObservationSchema);
