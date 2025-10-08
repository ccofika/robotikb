const mongoose = require('mongoose');

const aiTechnicianAnalysisSchema = new mongoose.Schema({
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
    topPerformers: {
      type: String,
      required: true
    },
    problemAreas: {
      type: String,
      required: true
    },
    trainingNeeds: {
      type: String,
      required: true
    },
    bestPractices: {
      type: String,
      required: true
    },
    appImprovements: {
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
    totalTechnicians: Number,
    totalWorkOrders: Number,
    totalMaterialUsage: Number,
    totalEquipmentChanges: Number,
    topTechnicians: Array,
    actionsByType: Object,
    materialUsageByTechnician: Array,
    completionRates: Array,
    postponeCancelRates: Array
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
aiTechnicianAnalysisSchema.index({ analysisDate: -1 });
aiTechnicianAnalysisSchema.index({ periodStart: 1, periodEnd: 1 });

module.exports = mongoose.model('AITechnicianAnalysis', aiTechnicianAnalysisSchema);
