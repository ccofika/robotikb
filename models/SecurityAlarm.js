const mongoose = require('mongoose');
const { Schema } = mongoose;

// Alarm i ceo njegov put: od aktiviranja do preuzimanja i rešavanja
const SecurityAlarmSchema = new Schema({
  kind: {
    type: String,
    enum: ['late', 'master', 'checkpoint1', 'checkpoint2', 'no_clock_out', 'contract', 'license'],
    required: true,
    index: true
  },
  level: { type: String, enum: ['info', 'warn', 'critical'], default: 'warn' },
  title: { type: String, required: true },
  message: { type: String, default: '' },

  facilityId: { type: Schema.Types.ObjectId, ref: 'SecurityFacility', default: null, index: true },
  facilityName: { type: String, default: '' },
  shiftId: { type: Schema.Types.ObjectId, ref: 'SecurityShift', default: null, index: true },
  workerId: { type: Schema.Types.ObjectId, ref: 'SecurityWorker', default: null, index: true },
  workerName: { type: String, default: '' },
  roundIndex: { type: Number, default: null },
  tagName: { type: String, default: '' },

  firedAt: { type: Date, default: Date.now, index: true },
  state: { type: String, enum: ['open', 'snoozed', 'escalated', 'ack', 'resolved'], default: 'open', index: true },
  snoozes: [{ at: Date, until: Date, reason: String }],
  ackById: { type: Schema.Types.ObjectId, default: null },
  ackByName: { type: String, default: '' },
  ackAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null },
  resolution: { type: String, default: '' },

  recipients: [{ name: String, role: String }],
  channels: [String]
}, { timestamps: true });

module.exports = mongoose.models.SecurityAlarm || mongoose.model('SecurityAlarm', SecurityAlarmSchema);
