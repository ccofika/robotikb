const mongoose = require('mongoose');

const appUpdateSchema = new mongoose.Schema({
  version: {
    type: String,
    required: true,
    unique: true
  },
  runtimeVersion: {
    type: String,
    required: true
  },
  platform: {
    type: String,
    enum: ['android', 'ios', 'all'],
    default: 'all'
  },
  bundlePath: {
    type: String,
    required: true
  },
  assets: [{
    path: String,
    url: String
  }],
  changelog: {
    type: String,
    default: ''
  },
  isMandatory: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  publishedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Index za brzo pronalaženje najnovije verzije
appUpdateSchema.index({ platform: 1, isActive: 1, runtimeVersion: -1 });

// Statička metoda za pronalaženje najnovije aktivne verzije
appUpdateSchema.statics.getLatestUpdate = async function(platform = 'all', currentVersion = '1.0.0') {
  const update = await this.findOne({
    $or: [
      { platform: platform },
      { platform: 'all' }
    ],
    isActive: true,
    runtimeVersion: { $gt: currentVersion }
  }).sort({ runtimeVersion: -1 });

  return update;
};

// Statička metoda za kreiranje novog update-a
appUpdateSchema.statics.createUpdate = async function(updateData) {
  const update = new this({
    ...updateData,
    publishedAt: new Date()
  });

  await update.save();
  return update;
};

module.exports = mongoose.model('AppUpdate', appUpdateSchema);
