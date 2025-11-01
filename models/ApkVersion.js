const mongoose = require('mongoose');

const apkVersionSchema = new mongoose.Schema({
  version: {
    type: String,
    required: true,
    unique: true
  },
  versionCode: {
    type: Number,
    required: true,
    unique: true
  },
  fileName: {
    type: String,
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  changelog: {
    type: String,
    required: true
  },
  isMandatory: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  minAndroidVersion: {
    type: Number,
    default: 21 // Android 5.0+
  },
  downloadCount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  publishedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for faster queries
apkVersionSchema.index({ versionCode: -1 });
apkVersionSchema.index({ isActive: 1, versionCode: -1 });

module.exports = mongoose.model('ApkVersion', apkVersionSchema);
