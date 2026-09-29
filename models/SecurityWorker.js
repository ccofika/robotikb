const mongoose = require('mongoose');
const { Schema } = mongoose;

// Radnici Robotik Security-ja (radnik obezbeđenja i koordinator objekta).
// Namerno odvojeni od Technician kolekcije: Montaža (tehničari, nalozi, finansije) ih nikad ne vidi.
const LicenseSchema = new Schema({
  type: { type: String, required: true, trim: true },          // npr. "Službenik obezbeđenja, bez oružja"
  number: { type: String, default: '', trim: true },
  issuedAt: { type: Date, default: null },
  validUntil: { type: Date, default: null },                    // null = trajno
  docUrl: { type: String, default: '' },
  docPublicId: { type: String, default: '' },
  docName: { type: String, default: '' },
  docLocal: { type: Boolean, default: false }
}, { timestamps: true });

const DocumentSchema = new Schema({
  name: { type: String, required: true },
  url: { type: String, required: true },
  publicId: { type: String, default: '' },
  local: { type: Boolean, default: false },
  fileType: { type: String, default: '' },
  fileSize: { type: Number, default: 0 },
  uploadedAt: { type: Date, default: Date.now }
});

const SecurityWorkerSchema = new Schema({
  name: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['guard', 'coordinator'], default: 'guard', index: true },
  isActive: { type: Boolean, default: true },

  // Lični podaci
  phone: { type: String, default: '', trim: true },
  email: { type: String, default: '', trim: true, lowercase: true },
  address: { type: String, default: '', trim: true },
  birthDate: { type: Date, default: null },
  jmbg: { type: String, default: '', trim: true },
  photoUrl: { type: String, default: '' },
  notes: { type: String, default: '' },

  // Ugovor: until = null znači ugovor na neodređeno
  contract: {
    from: { type: Date, default: null },
    until: { type: Date, default: null }
  },
  licenses: [LicenseSchema],
  documents: [DocumentSchema],

  // Satnica u dinarima po satu; null = podrazumevana iz podešavanja
  hourlyRate: { type: Number, default: null, min: 0 },

  // Radnik: objekti na kojima radi. Koordinator: objekti koje vodi.
  facilityIds: [{ type: Schema.Types.ObjectId, ref: 'SecurityFacility', index: true }],

  // Expo push token za Android aplikaciju
  pushToken: { type: String, default: null },
  pushEnabled: { type: Boolean, default: true },

  // Već poslati alarmi za istek ugovora/licenci (da se ne šalju svaki dan)
  alertsSent: [{ key: String, at: { type: Date, default: Date.now } }],

  createdById: { type: Schema.Types.ObjectId, default: null },
  createdByName: { type: String, default: '' }
}, { timestamps: true });

SecurityWorkerSchema.methods.toSafe = function toSafe() {
  const o = this.toObject();
  delete o.password;
  delete o.pushToken;
  return o;
};

module.exports = mongoose.models.SecurityWorker || mongoose.model('SecurityWorker', SecurityWorkerSchema);
