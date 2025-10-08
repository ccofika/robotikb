const mongoose = require('mongoose');

const aiAnalysisSchema = new mongoose.Schema({
  analysisDate: {
    type: Date,
    default: Date.now,
    required: true
  },
  periodStart: {
    type: Date,
    required: true
  },
  periodEnd: {
    type: Date,
    required: true
  },
  analysisType: {
    type: String,
    enum: ['scheduled', 'manual'],
    default: 'scheduled'
  },
  analysis: {
    trends: {
      type: String,
      required: true
    },
    patterns: {
      type: String,
      required: true
    },
    automationSuggestions: {
      type: String,
      required: true
    },
    improvementIdeas: {
      type: String,
      required: true
    },
    summary: {
      type: String,
      required: true
    }
  },
  statistics: {
    totalLogs: Number,
    adminActivities: Number,
    userActivities: Number,
    technicianActivities: Number,
    mostActiveUsers: Array,
    mostCommonActions: Array
  },
  rawData: {
    logsAnalyzed: Number,
    dataPoints: Array
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Index for faster queries
aiAnalysisSchema.index({ analysisDate: -1 });
aiAnalysisSchema.index({ periodStart: 1, periodEnd: 1 });

module.exports = mongoose.model('AIAnalysis', aiAnalysisSchema);
