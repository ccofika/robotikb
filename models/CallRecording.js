const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Model za čuvanje SVIH snimaka poziva tehničara
// Updated: 2026-01-11 - workOrderInfo is an embedded object, not a string
// Snimci se čuvaju nezavisno od toga da li su povezani sa radnim nalogom
const CallRecordingSchema = new Schema({
  // Tehničar koji je napravio snimak
  technicianId: {
    type: Schema.Types.ObjectId,
    ref: 'Technician',
    required: true,
    index: true
  },
  // Broj telefona korisnika (sa kojim je obavljen razgovor)
  customerPhone: {
    type: String,
    required: true
  },
  // Datum i vreme kada je poziv snimljen
  recordedAt: {
    type: Date,
    required: true,
    index: true
  },
  // URL do snimka na Cloudinary
  url: {
    type: String,
    required: true
  },
  // Ime fajla na Cloudinary
  fileName: {
    type: String
  },
  // Originalno ime fajla sa uređaja
  originalFileName: {
    type: String
  },
  // Jedinstveni ID za detekciju duplikata (customerPhone/fileName)
  fileUniqueId: {
    type: String,
    index: true
  },
  // Trajanje snimka u sekundama
  duration: {
    type: Number
  },
  // Veličina fajla u bajtovima
  fileSize: {
    type: Number
  },
  // Povezani radni nalog (null ako nije pronađen matching)
  workOrderId: {
    type: Schema.Types.ObjectId,
    ref: 'WorkOrder',
    default: null,
    index: true
  },
  // Keširane informacije o radnom nalogu (za brži prikaz bez join-a)
  workOrderInfo: {
    municipality: String,
    address: String,
    date: Date,
    userPhone: String,
    type: String
  }
}, {
  timestamps: true
});

// Compound index za efikasno pretraživanje po tehničaru i datumu
CallRecordingSchema.index({ technicianId: 1, recordedAt: -1 });

// Index za proveru duplikata
CallRecordingSchema.index({ technicianId: 1, fileUniqueId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('CallRecording', CallRecordingSchema);
