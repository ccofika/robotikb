const mongoose = require('mongoose');
const { Schema } = mongoose;

// Jedna smena radnika na objektu (dnevna 07-19 ili noćna 19-07)
const PunchSchema = new Schema({
  at: Date,                 // vreme događaja (sa telefona ako je očitano bez interneta)
  receivedAt: Date,         // kad je server primio očitavanje
  deviceAt: Date,
  tagId: { type: Schema.Types.ObjectId, ref: 'NfcTag' },
  uid: String,
  geo: { lat: Number, lng: Number, acc: Number },
  offline: { type: Boolean, default: false },
  source: { type: String, default: 'nfc' },   // nfc | simulated | manual
  byName: { type: String, default: '' },      // ručni upis od strane admina
  early: { type: Boolean, default: false },
  auto: { type: Boolean, default: false }
}, { _id: false });

const RoundSchema = new Schema({
  tagId: { type: Schema.Types.ObjectId, ref: 'NfcTag', required: true },
  tagName: { type: String, default: '' },
  dueAt: { type: Date, required: true },
  scannedAt: { type: Date, default: null },
  scanId: { type: Schema.Types.ObjectId, default: null },
  lateMin: { type: Number, default: 0 },
  alarm1At: { type: Date, default: null },
  alarm2At: { type: Date, default: null },
  snoozedUntil: { type: Date, default: null },
  snoozes: [{ at: Date, until: Date, reason: String }]
}, { _id: false });

const SecurityShiftSchema = new Schema({
  facilityId: { type: Schema.Types.ObjectId, ref: 'SecurityFacility', required: true, index: true },
  workerId: { type: Schema.Types.ObjectId, ref: 'SecurityWorker', required: true, index: true },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // lokalni datum početka
  type: { type: String, enum: ['day', 'night'], required: true },
  plannedStart: { type: Date, required: true },
  plannedEnd: { type: Date, required: true },

  status: { type: String, enum: ['planned', 'active', 'done', 'missed', 'cancelled'], default: 'planned', index: true },
  published: { type: Boolean, default: false, index: true },
  publishedAt: { type: Date, default: null },
  note: { type: String, default: '' },

  clockIn: { type: PunchSchema, default: null },
  clockOut: { type: PunchSchema, default: null },
  lateMin: { type: Number, default: 0 },
  earlyLeaveMin: { type: Number, default: 0 },

  rounds: [RoundSchema],
  standingDone: [{
    taskId: Schema.Types.ObjectId,
    text: String,
    doneAt: Date,
    comment: { type: String, default: '' }
  }],

  handover: {
    radio: { type: String, default: '' },
    items: [String],
    condition: { type: String, enum: ['ok', 'damaged'], default: 'ok' },
    note: { type: String, default: '' },
    at: { type: Date, default: null }
  },
  receivedBy: {
    workerId: { type: Schema.Types.ObjectId, default: null },
    name: { type: String, default: '' },
    at: { type: Date, default: null }
  },
  review: {
    byId: { type: Schema.Types.ObjectId, default: null },
    byName: { type: String, default: '' },
    at: { type: Date, default: null },
    remark: { type: Boolean, default: false },
    note: { type: String, default: '' }
  },

  // Zauzimanje alarma (atomski claim, da se isti alarm ne pošalje dva puta)
  alarms: {
    lateAt: { type: Date, default: null },
    masterAt: { type: Date, default: null },
    noClockOutAt: { type: Date, default: null }
  },
  report: {
    sentAt: { type: Date, default: null },
    sentTo: [String],
    error: { type: String, default: '' },
    attempts: { type: Number, default: 0 },
    noClockOut: { type: Boolean, default: false }
  },

  replaced: [{
    fromWorkerId: Schema.Types.ObjectId,
    fromName: String,
    toName: String,
    at: { type: Date, default: Date.now },
    byName: String
  }],

  createdById: { type: Schema.Types.ObjectId, default: null },
  createdByName: { type: String, default: '' }
}, { timestamps: true });

SecurityShiftSchema.index({ facilityId: 1, plannedStart: 1 });
SecurityShiftSchema.index({ workerId: 1, plannedStart: 1 });
SecurityShiftSchema.index({ status: 1, plannedStart: 1 });
// Radnik ima najviše jednu dnevnu i jednu noćnu smenu po datumu (dvostruki klik ili dva admina u istoj sekundi)
SecurityShiftSchema.index({ workerId: 1, date: 1, type: 1 }, { unique: true });

module.exports = mongoose.models.SecurityShift || mongoose.model('SecurityShift', SecurityShiftSchema);
