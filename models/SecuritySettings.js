const mongoose = require('mongoose');
const { Schema } = mongoose;

// Jedna globalna podešavanja Security modula. Admin ih menja iz aplikacije,
// a cron ih čita pri svakom pokretanju, pa izmena važi od sledećeg minuta.
const SecuritySettingsSchema = new Schema({
  key: { type: String, default: 'global', unique: true },

  dayStart: { type: String, default: '07:00' },
  nightStart: { type: String, default: '19:00' },

  alarms: {
    enabled: { type: Boolean, default: true },
    lateMin: { type: Number, default: 15, min: 1, max: 120 },          // alarm radniku
    masterMin: { type: Number, default: 30, min: 2, max: 240 },        // MASTER ALARM koordinatoru i adminu
    checkpointTolMin: { type: Number, default: 5, min: 0, max: 60 },   // tolerancija za checkpoint
    snoozeMin: { type: Number, default: 10, min: 1, max: 60 },         // odlaganje uz razlog
    maxSnoozes: { type: Number, default: 1, min: 1, max: 5 },
    noClockOutEnabled: { type: Boolean, default: true },
    noClockOutMin: { type: Number, default: 30, min: 5, max: 240 },
    earlyClockInMin: { type: Number, default: 60, min: 0, max: 240 }   // koliko ranije može prijava
  },

  expiry: {
    contractDays: { type: [Number], default: [30] },                    // mesec dana pre isteka
    licenseEnabled: { type: Boolean, default: true },
    licenseDays: { type: [Number], default: [60] },
    dailyTime: { type: String, default: '09:00' },
    emailAdmins: { type: Boolean, default: true }
  },

  pay: {
    defaultRate: { type: Number, default: 400, min: 0 },
    nightPct: { type: Number, default: 26, min: 0, max: 300 },          // rad noću 22-06
    holidayPct: { type: Number, default: 110, min: 0, max: 300 },       // rad na dan praznika
    overtimePct: { type: Number, default: 26, min: 0, max: 300 }
  },

  reports: {
    ccCoordinator: { type: Boolean, default: true },
    attachPdf: { type: Boolean, default: true }
  },

  gpsRadiusM: { type: Number, default: 300, min: 50, max: 5000 },

  history: [{
    at: { type: Date, default: Date.now },
    byName: String,
    changes: String
  }]
}, { timestamps: true });

module.exports = mongoose.models.SecuritySettings || mongoose.model('SecuritySettings', SecuritySettingsSchema);
