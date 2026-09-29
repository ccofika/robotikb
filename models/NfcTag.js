const mongoose = require('mongoose');
const { Schema } = mongoose;

// NFC tag na objektu. Identitet taga je ovaj zapis, a UID je trenutni fizički čip.
// Zamena oštećenog taga menja samo UID, pa plan obilaska i istorija ostaju isti.
const HistorySchema = new Schema({
  at: { type: Date, default: Date.now },
  byId: { type: Schema.Types.ObjectId, default: null },
  byName: { type: String, default: '' },
  action: {
    type: String,
    enum: ['created', 'renamed', 'moved', 'category', 'transferred', 'replaced', 'retired', 'reactivated', 'ndef', 'note'],
    required: true
  },
  details: { type: String, default: '' }
}, { _id: false });

const NfcTagSchema = new Schema({
  facilityId: { type: Schema.Types.ObjectId, ref: 'SecurityFacility', required: true, index: true },
  category: { type: String, enum: ['workplace', 'checkpoint'], required: true },
  name: { type: String, required: true, trim: true },
  location: { type: String, default: '', trim: true },     // sprat, zona, gde tačno stoji
  note: { type: String, default: '' },

  uid: { type: String, required: true, uppercase: true, trim: true }, // 04:A2:1F:9B:5C:3E:80
  chip: { type: String, default: 'NTAG215' },
  geo: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    acc: { type: Number, default: null }
  },
  ndef: {
    written: { type: Boolean, default: false },
    locked: { type: Boolean, default: false }
  },

  status: { type: String, enum: ['active', 'retired'], default: 'active', index: true },
  previousUids: [{
    uid: String,
    replacedAt: { type: Date, default: Date.now },
    reason: { type: String, default: '' }
  }],
  history: [HistorySchema],

  lastScanAt: { type: Date, default: null },
  lastScanByName: { type: String, default: '' },

  createdById: { type: Schema.Types.ObjectId, default: null },
  createdByName: { type: String, default: '' }
}, { timestamps: true });

// Jedan fizički čip može biti samo na jednom tagu
NfcTagSchema.index({ uid: 1 }, { unique: true });
NfcTagSchema.index({ 'previousUids.uid': 1 });

module.exports = mongoose.models.NfcTag || mongoose.model('NfcTag', NfcTagSchema);
