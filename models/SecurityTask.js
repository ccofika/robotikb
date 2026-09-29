const mongoose = require('mongoose');
const { Schema } = mongoose;

// Povremeni zadatak: izdaje se za tačno određenu smenu i vreme. Radnik ga zatvara uz obavezan komentar.
const SecurityTaskSchema = new Schema({
  facilityId: { type: Schema.Types.ObjectId, ref: 'SecurityFacility', required: true, index: true },
  shiftId: { type: Schema.Types.ObjectId, ref: 'SecurityShift', default: null, index: true },
  dueAt: { type: Date, required: true, index: true },
  text: { type: String, required: true, trim: true },
  status: { type: String, enum: ['open', 'done', 'cancelled'], default: 'open', index: true },
  doneAt: { type: Date, default: null },
  doneById: { type: Schema.Types.ObjectId, default: null },
  doneByName: { type: String, default: '' },
  comment: { type: String, default: '' },
  photos: [{ url: String, publicId: String, local: Boolean }],
  createdById: { type: Schema.Types.ObjectId, default: null },
  createdByName: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.models.SecurityTask || mongoose.model('SecurityTask', SecurityTaskSchema);
