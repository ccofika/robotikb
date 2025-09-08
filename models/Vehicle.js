const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Service record schema for embedded services
const ServiceSchema = new Schema({
  date: {
    type: Date,
    required: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  comment: {
    type: String,
    trim: true,
    maxlength: 500
  },
  nextServiceDue: {
    type: Date
  },
  serviceType: {
    type: String,
    enum: ['regular', 'repair', 'inspection', 'oil_change', 'brake_check', 'other'],
    default: 'regular'
  }
}, { timestamps: true });

const VehicleSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  licensePlate: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 20
  },
  brand: {
    type: String,
    trim: true,
    maxlength: 50
  },
  model: {
    type: String,
    trim: true,
    maxlength: 50
  },
  year: {
    type: Number,
    min: 1900,
    max: new Date().getFullYear() + 1
  },
  registrationExpiry: {
    type: Date,
    required: true
  },
  registrationRenewalDate: {
    type: Date
  },
  insuranceExpiry: {
    type: Date
  },
  inspectionExpiry: {
    type: Date
  },
  mileage: {
    type: Number,
    min: 0,
    default: 0
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'maintenance', 'sold'],
    default: 'active'
  },
  services: [ServiceSchema],
  notes: {
    type: String,
    maxlength: 1000
  },
  assignedTo: {
    type: String,
    trim: true
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for registration status
VehicleSchema.virtual('registrationStatus').get(function() {
  const now = new Date();
  const expiry = this.registrationExpiry;
  const daysUntilExpiry = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
  
  if (daysUntilExpiry < 0) {
    return 'expired';
  } else if (daysUntilExpiry <= 30) {
    return 'expiring_soon';
  } else {
    return 'valid';
  }
});

// Virtual for days until registration expiry
VehicleSchema.virtual('daysUntilRegistrationExpiry').get(function() {
  const now = new Date();
  const expiry = this.registrationExpiry;
  return Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
});

// Virtual for latest service
VehicleSchema.virtual('latestService').get(function() {
  if (this.services && this.services.length > 0) {
    return this.services.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  }
  return null;
});

// Virtual for total service cost
VehicleSchema.virtual('totalServiceCost').get(function() {
  if (this.services && this.services.length > 0) {
    return this.services.reduce((total, service) => total + service.price, 0);
  }
  return 0;
});

// Index for efficient queries
VehicleSchema.index({ registrationExpiry: 1 });
VehicleSchema.index({ status: 1 });
VehicleSchema.index({ 'services.date': -1 });

// Method to add a new service
VehicleSchema.methods.addService = function(serviceData) {
  this.services.push(serviceData);
  return this.save();
};

// Method to get services within a date range
VehicleSchema.methods.getServicesByDateRange = function(startDate, endDate) {
  return this.services.filter(service => {
    const serviceDate = new Date(service.date);
    return serviceDate >= startDate && serviceDate <= endDate;
  });
};

// Static method to find vehicles with expiring registrations
VehicleSchema.statics.findExpiringRegistrations = function(days = 30) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);
  
  return this.find({
    registrationExpiry: { $lte: futureDate },
    status: { $ne: 'sold' }
  });
};

module.exports = mongoose.model('Vehicle', VehicleSchema);