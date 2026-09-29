const mongoose = require('mongoose');
const { Schema } = mongoose;

// Trajni upis u dosije radnika (kašnjenja, alarmi, odlaganja, beleške)
const SecurityDossierSchema = new Schema({
  workerId: { type: Schema.Types.ObjectId, ref: 'SecurityWorker', required: true, index: true },
  at: { type: Date, default: Date.now, index: true },
  kind: {
    type: String,
    enum: ['late', 'master', 'cp_late', 'cp_snooze', 'cp_admin', 'early_leave', 'no_clock_out', 'missed',
      'contract', 'license', 'note'],
    required: true
  },
  level: { type: String, enum: ['info', 'warn', 'critical', 'ok'], default: 'warn' },
  text: { type: String, required: true },
  facilityId: { type: Schema.Types.ObjectId, default: null },
  facilityName: { type: String, default: '' },
  shiftId: { type: Schema.Types.ObjectId, default: null },
  alarmId: { type: Schema.Types.ObjectId, default: null },
  byName: { type: String, default: '' }
}, { timestamps: false });

SecurityDossierSchema.index({ workerId: 1, at: -1 });

module.exports = mongoose.models.SecurityDossier || mongoose.model('SecurityDossier', SecurityDossierSchema);
