const mongoose = require('mongoose');
const { Schema } = mongoose;

// Objekat: mesto na kom su angažovani radnici obezbeđenja
const PlanItemSchema = new Schema({
  tagId: { type: Schema.Types.ObjectId, ref: 'NfcTag', required: true },
  time: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ } // HH:mm
}, { _id: false });

const StandingTaskSchema = new Schema({
  text: { type: String, required: true, trim: true },
  requireComment: { type: Boolean, default: false },
  order: { type: Number, default: 0 }
});

const SecurityFacilitySchema = new Schema({
  name: { type: String, required: true, unique: true, trim: true },
  type: { type: String, default: '', trim: true },          // npr. "Hotel", "Poslovna zgrada"
  address: { type: String, default: '', trim: true },
  city: { type: String, default: '', trim: true },
  description: { type: String, default: '' },
  instructions: { type: String, default: '' },              // napomene za radnike (ključevi, PP centrala...)
  contactName: { type: String, default: '' },
  contactPhone: { type: String, default: '' },

  geo: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null }
  },

  reportEmails: [{ type: String, trim: true, lowercase: true }],

  // Plan obilaska za dnevnu i noćnu smenu
  roundPlan: {
    day: [PlanItemSchema],
    night: [PlanItemSchema]
  },
  standingTasks: [StandingTaskSchema],

  // Pravila koja važe samo za ovaj objekat (null = globalna podešavanja)
  rules: {
    checkpointTolMin: { type: Number, default: null, min: 0, max: 60 },
    snoozeMin: { type: Number, default: null, min: 1, max: 60 }
  },

  active: { type: Boolean, default: true, index: true },
  createdById: { type: Schema.Types.ObjectId, default: null },
  createdByName: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.models.SecurityFacility || mongoose.model('SecurityFacility', SecurityFacilitySchema);
