const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');
const Vehicle = require('../models/Vehicle');
const { logActivity } = require('../middleware/activityLogger');
const { uploadServiceInvoice, deleteServiceInvoice } = require('../config/cloudinary');

// Multer config za upload slike fakture
const invoiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Samo slike su dozvoljene!'), false);
    }
  }
});

// Cache for vehicle statistics
let vehicleStatsCache = null;
let vehicleStatsCacheTime = 0;
const VEHICLE_STATS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Function to invalidate vehicle statistics cache
const invalidateVehicleStatsCache = () => {
  console.log('🗑️ Invalidating vehicle statistics cache due to vehicle change');
  vehicleStatsCache = null;
  vehicleStatsCacheTime = 0;
};

// GET - Get all vehicles (optimized)
router.get('/', async (req, res) => {
  try {
    const {
      statsOnly,
      page = 1,
      limit = 50,
      search = '',
      statusFilter = ''
    } = req.query;

    // Za dashboard, vraćaj samo broj elemenata
    if (statsOnly === 'true') {
      const count = await Vehicle.countDocuments({ status: { $ne: 'sold' } });
      return res.json({ total: count });
    }

    // Build filter object
    let filterObj = { status: { $ne: 'sold' } };

    if (search) {
      filterObj.$or = [
        { name: { $regex: search, $options: 'i' } },
        { licensePlate: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } },
        { model: { $regex: search, $options: 'i' } },
        { assignedTo: { $regex: search, $options: 'i' } }
      ];
    }

    if (statusFilter && statusFilter !== 'all') {
      filterObj.status = statusFilter;
    }

    // Server-side pagination setup
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 50, 100); // Max 100 per page
    const skip = (pageNum - 1) * limitNum;

    const [vehicles, totalCount] = await Promise.all([
      Vehicle.find(filterObj)
        .skip(skip)
        .limit(limitNum)
        .sort({ createdAt: -1 })
        .lean(), // Vratiti plain JS objekte umesto Mongoose dokumenata
      Vehicle.countDocuments(filterObj)
    ]);

    // Add computed properties efficiently
    const vehiclesWithStatus = vehicles.map(vehicle => {
      const vehicleObj = new Vehicle(vehicle);
      return {
        ...vehicle,
        registrationStatus: vehicleObj.registrationStatus,
        daysUntilRegistrationExpiry: vehicleObj.daysUntilRegistrationExpiry,
        latestService: vehicleObj.latestService,
        totalServiceCost: vehicleObj.totalServiceCost
      };
    });

    return res.json({
      data: vehiclesWithStatus,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalCount / limitNum),
        totalCount,
        limit: limitNum,
        hasNextPage: pageNum < Math.ceil(totalCount / limitNum),
        hasPrevPage: pageNum > 1
      }
    });
  } catch (error) {
    console.error('Greška pri dohvatanju vozila:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju vozila' });
  }
});

// GET - Get vehicles with registration status (optimized)
router.get('/with-status', async (req, res) => {
  try {
    const { statsOnly } = req.query;

    // Za dashboard, vrati samo broj elemenata
    if (statsOnly === 'true') {
      const count = await Vehicle.countDocuments({ status: { $ne: 'sold' } });
      return res.json({ total: count });
    }

    const vehicles = await Vehicle.find({ status: { $ne: 'sold' } })
      .sort({ registrationExpiry: 1 })
      .lean(); // Performance optimization

    // Add computed status to each vehicle
    const vehiclesWithStatus = vehicles.map(vehicle => {
      const vehicleObj = new Vehicle(vehicle);
      return {
        ...vehicle,
        registrationStatus: vehicleObj.registrationStatus,
        daysUntilRegistrationExpiry: vehicleObj.daysUntilRegistrationExpiry,
        latestService: vehicleObj.latestService,
        totalServiceCost: vehicleObj.totalServiceCost
      };
    });

    res.json(vehiclesWithStatus);
  } catch (error) {
    console.error('Greška pri dohvatanju vozila sa statusom:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju vozila sa statusom' });
  }
});

// GET - Get vehicles with expiring registrations
router.get('/expiring-registrations/:days?', async (req, res) => {
  try {
    const days = parseInt(req.params.days) || 30;
    const vehicles = await Vehicle.findExpiringRegistrations(days);
    
    res.json(vehicles);
  } catch (error) {
    console.error('Greška pri dohvatanju vozila sa istekajućim registracijama:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju vozila sa istekajućim registracijama' });
  }
});

// GET - Get single vehicle by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const vehicle = await Vehicle.findById(id);
    
    if (!vehicle) {
      return res.status(404).json({ error: 'Vozilo nije pronađeno' });
    }
    
    // Add computed properties
    const vehicleWithStatus = {
      ...vehicle.toObject(),
      registrationStatus: vehicle.registrationStatus,
      daysUntilRegistrationExpiry: vehicle.daysUntilRegistrationExpiry,
      latestService: vehicle.latestService,
      totalServiceCost: vehicle.totalServiceCost
    };
    
    res.json(vehicleWithStatus);
  } catch (error) {
    console.error('Greška pri dohvatanju vozila:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju vozila' });
  }
});

// GET - Get vehicle services by ID
router.get('/:id/services', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const vehicle = await Vehicle.findById(id);
    
    if (!vehicle) {
      return res.status(404).json({ error: 'Vozilo nije pronađeno' });
    }
    
    // Sort services by date (newest first)
    const services = vehicle.services.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    res.json(services);
  } catch (error) {
    console.error('Greška pri dohvatanju servisa vozila:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju servisa vozila' });
  }
});

// POST - Create new vehicle
router.post('/', logActivity('vehicles', 'vehicle_add', {
  getEntityName: (req, responseData) => responseData?.vehicleName || responseData?.licensePlate
}), async (req, res) => {
  try {
    const vehicleData = req.body;
    
    // Validation
    if (!vehicleData.name || !vehicleData.registrationExpiry) {
      return res.status(400).json({ error: 'Naziv vozila i datum isteka registracije su obavezni' });
    }
    
    // Check if vehicle with same license plate exists
    if (vehicleData.licensePlate) {
      const existingVehicle = await Vehicle.findOne({ 
        licensePlate: vehicleData.licensePlate.toUpperCase(),
        status: { $ne: 'sold' }
      });
      if (existingVehicle) {
        return res.status(400).json({ error: 'Vozilo sa ovom registarskom oznakom već postoji' });
      }
    }
    
    const newVehicle = new Vehicle({
      name: vehicleData.name.trim(),
      licensePlate: vehicleData.licensePlate ? vehicleData.licensePlate.toUpperCase().trim() : undefined,
      brand: vehicleData.brand ? vehicleData.brand.trim() : undefined,
      model: vehicleData.model ? vehicleData.model.trim() : undefined,
      year: vehicleData.year,
      registrationExpiry: new Date(vehicleData.registrationExpiry),
      registrationRenewalDate: vehicleData.registrationRenewalDate ? new Date(vehicleData.registrationRenewalDate) : undefined,
      insuranceExpiry: vehicleData.insuranceExpiry ? new Date(vehicleData.insuranceExpiry) : undefined,
      inspectionExpiry: vehicleData.inspectionExpiry ? new Date(vehicleData.inspectionExpiry) : undefined,
      mileage: vehicleData.mileage || 0,
      status: vehicleData.status || 'active',
      notes: vehicleData.notes ? vehicleData.notes.trim() : undefined,
      assignedTo: vehicleData.assignedTo ? vehicleData.assignedTo.trim() : undefined
    });
    
    const savedVehicle = await newVehicle.save();

    // Invalidate statistics cache after creating new vehicle
    invalidateVehicleStatsCache();

    // Return with computed properties
    const vehicleWithStatus = {
      ...savedVehicle.toObject(),
      registrationStatus: savedVehicle.registrationStatus,
      daysUntilRegistrationExpiry: savedVehicle.daysUntilRegistrationExpiry,
      latestService: savedVehicle.latestService,
      totalServiceCost: savedVehicle.totalServiceCost
    };

    res.status(201).json(vehicleWithStatus);
  } catch (error) {
    console.error('Greška pri kreiranju vozila:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: 'Neispravni podaci o vozilu' });
    }
    res.status(500).json({ error: 'Greška pri kreiranju vozila' });
  }
});

// POST - Add service to vehicle
router.post('/:id/services', async (req, res) => {
  try {
    const { id } = req.params;
    const serviceData = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    // Validation
    if (!serviceData.date || serviceData.price === undefined || serviceData.price < 0) {
      return res.status(400).json({ error: 'Datum i cena servisa su obavezni' });
    }

    const vehicle = await Vehicle.findById(id);

    if (!vehicle) {
      return res.status(404).json({ error: 'Vozilo nije pronađeno' });
    }

    const newService = {
      date: new Date(serviceData.date),
      partsPrice: serviceData.partsPrice ? parseFloat(serviceData.partsPrice) : 0,
      laborPrice: serviceData.laborPrice ? parseFloat(serviceData.laborPrice) : 0,
      price: parseFloat(serviceData.price),
      comment: serviceData.comment ? serviceData.comment.trim() : '',
      mileage: serviceData.mileage ? parseInt(serviceData.mileage) : undefined,
      nextServiceDue: serviceData.nextServiceDue ? new Date(serviceData.nextServiceDue) : undefined,
      serviceType: serviceData.serviceType || 'regular'
    };

    vehicle.services.push(newService);

    // Update vehicle mileage if provided
    if (serviceData.mileage && serviceData.mileage > vehicle.mileage) {
      vehicle.mileage = serviceData.mileage;
    }

    const updatedVehicle = await vehicle.save();

    // Invalidate statistics cache after adding service
    invalidateVehicleStatsCache();

    // Return the newly added service
    const addedService = updatedVehicle.services[updatedVehicle.services.length - 1];

    res.status(201).json(addedService);
  } catch (error) {
    console.error('Greška pri dodavanju servisa:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: 'Neispravni podaci o servisu' });
    }
    res.status(500).json({ error: 'Greška pri dodavanju servisa' });
  }
});

// PUT - Update vehicle
router.put('/:id', logActivity('vehicles', 'vehicle_edit', {
  getEntityId: (req) => req.params.id,
  getEntityName: (req, responseData) => responseData?.vehicleName || responseData?.licensePlate
}), async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const vehicle = await Vehicle.findById(id);
    
    if (!vehicle) {
      return res.status(404).json({ error: 'Vozilo nije pronađeno' });
    }
    
    // Check for duplicate license plate (if updating)
    if (updateData.licensePlate && updateData.licensePlate !== vehicle.licensePlate) {
      const duplicatePlate = await Vehicle.findOne({
        _id: { $ne: id },
        licensePlate: updateData.licensePlate.toUpperCase(),
        status: { $ne: 'sold' }
      });
      
      if (duplicatePlate) {
        return res.status(400).json({ error: 'Vozilo sa ovom registarskom oznakom već postoji' });
      }
    }
    
    // Update fields
    if (updateData.name) vehicle.name = updateData.name.trim();
    if (updateData.licensePlate !== undefined) vehicle.licensePlate = updateData.licensePlate ? updateData.licensePlate.toUpperCase().trim() : undefined;
    if (updateData.brand !== undefined) vehicle.brand = updateData.brand ? updateData.brand.trim() : undefined;
    if (updateData.model !== undefined) vehicle.model = updateData.model ? updateData.model.trim() : undefined;
    if (updateData.year) vehicle.year = updateData.year;
    if (updateData.registrationExpiry) vehicle.registrationExpiry = new Date(updateData.registrationExpiry);
    if (updateData.registrationRenewalDate !== undefined) vehicle.registrationRenewalDate = updateData.registrationRenewalDate ? new Date(updateData.registrationRenewalDate) : undefined;
    if (updateData.insuranceExpiry !== undefined) vehicle.insuranceExpiry = updateData.insuranceExpiry ? new Date(updateData.insuranceExpiry) : undefined;
    if (updateData.inspectionExpiry !== undefined) vehicle.inspectionExpiry = updateData.inspectionExpiry ? new Date(updateData.inspectionExpiry) : undefined;
    if (updateData.mileage !== undefined) vehicle.mileage = updateData.mileage;
    if (updateData.status) vehicle.status = updateData.status;
    if (updateData.notes !== undefined) vehicle.notes = updateData.notes ? updateData.notes.trim() : undefined;
    if (updateData.assignedTo !== undefined) vehicle.assignedTo = updateData.assignedTo ? updateData.assignedTo.trim() : undefined;
    
    const updatedVehicle = await vehicle.save();

    // Invalidate statistics cache after updating vehicle
    invalidateVehicleStatsCache();

    // Return with computed properties
    const vehicleWithStatus = {
      ...updatedVehicle.toObject(),
      registrationStatus: updatedVehicle.registrationStatus,
      daysUntilRegistrationExpiry: updatedVehicle.daysUntilRegistrationExpiry,
      latestService: updatedVehicle.latestService,
      totalServiceCost: updatedVehicle.totalServiceCost
    };

    res.json(vehicleWithStatus);
  } catch (error) {
    console.error('Greška pri ažuriranju vozila:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: 'Neispravni podaci o vozilu' });
    }
    res.status(500).json({ error: 'Greška pri ažuriranju vozila' });
  }
});

// PUT - Update service
router.put('/:id/services/:serviceId', async (req, res) => {
  try {
    const { id, serviceId } = req.params;
    const updateData = req.body;

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    const vehicle = await Vehicle.findById(id);

    if (!vehicle) {
      return res.status(404).json({ error: 'Vozilo nije pronađeno' });
    }

    const service = vehicle.services.id(serviceId);

    if (!service) {
      return res.status(404).json({ error: 'Servis nije pronađen' });
    }

    // Update service fields
    if (updateData.date) service.date = new Date(updateData.date);
    if (updateData.partsPrice !== undefined) service.partsPrice = updateData.partsPrice ? parseFloat(updateData.partsPrice) : 0;
    if (updateData.laborPrice !== undefined) service.laborPrice = updateData.laborPrice ? parseFloat(updateData.laborPrice) : 0;
    if (updateData.price !== undefined) service.price = parseFloat(updateData.price);
    if (updateData.comment !== undefined) service.comment = updateData.comment.trim();
    if (updateData.mileage !== undefined) service.mileage = updateData.mileage ? parseInt(updateData.mileage) : undefined;
    if (updateData.nextServiceDue !== undefined) service.nextServiceDue = updateData.nextServiceDue ? new Date(updateData.nextServiceDue) : undefined;
    if (updateData.serviceType) service.serviceType = updateData.serviceType;

    const updatedVehicle = await vehicle.save();

    // Invalidate statistics cache after updating service
    invalidateVehicleStatsCache();

    const updatedService = updatedVehicle.services.id(serviceId);
    res.json(updatedService);
  } catch (error) {
    console.error('Greška pri ažuriranju servisa:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: 'Neispravni podaci o servisu' });
    }
    res.status(500).json({ error: 'Greška pri ažuriranju servisa' });
  }
});

// DELETE - Delete vehicle
router.delete('/:id', logActivity('vehicles', 'vehicle_delete', {
  getEntityId: (req) => req.params.id
}), async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const deletedVehicle = await Vehicle.findByIdAndDelete(id);

    if (!deletedVehicle) {
      return res.status(404).json({ error: 'Vozilo nije pronađeno' });
    }

    // Invalidate statistics cache after deleting vehicle
    invalidateVehicleStatsCache();

    res.json({ message: 'Vozilo uspešno obrisano' });
  } catch (error) {
    console.error('Greška pri brisanju vozila:', error);
    res.status(500).json({ error: 'Greška pri brisanju vozila' });
  }
});

// DELETE - Delete service
router.delete('/:id/services/:serviceId', async (req, res) => {
  try {
    const { id, serviceId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const vehicle = await Vehicle.findById(id);
    
    if (!vehicle) {
      return res.status(404).json({ error: 'Vozilo nije pronađeno' });
    }
    
    const service = vehicle.services.id(serviceId);
    
    if (!service) {
      return res.status(404).json({ error: 'Servis nije pronađen' });
    }
    
    vehicle.services.pull(serviceId);
    await vehicle.save();

    // Invalidate statistics cache after deleting service
    invalidateVehicleStatsCache();

    res.json({ message: 'Servis uspešno obrisan' });
  } catch (error) {
    console.error('Greška pri brisanju servisa:', error);
    res.status(500).json({ error: 'Greška pri brisanju servisa' });
  }
});

// GET - Get vehicle statistics (optimized with caching)
router.get('/stats/overview', async (req, res) => {
  try {
    const now = Date.now();

    // Return cached data if still valid
    if (vehicleStatsCache && (now - vehicleStatsCacheTime) < VEHICLE_STATS_CACHE_TTL) {
      console.log('Returning cached vehicle statistics');
      return res.json(vehicleStatsCache);
    }

    console.log('Calculating fresh vehicle statistics...');
    const startTime = Date.now();

    // Use aggregation pipeline for better performance
    const [statsAgg, expiringRegistrations] = await Promise.all([
      Vehicle.aggregate([
        {
          $match: { status: { $ne: 'sold' } }
        },
        {
          $group: {
            _id: null,
            totalVehicles: { $sum: 1 },
            activeVehicles: {
              $sum: {
                $cond: [{ $eq: ['$status', 'active'] }, 1, 0]
              }
            },
            inMaintenanceVehicles: {
              $sum: {
                $cond: [{ $eq: ['$status', 'maintenance'] }, 1, 0]
              }
            },
            totalServiceCosts: {
              $sum: {
                $reduce: {
                  input: '$services',
                  initialValue: 0,
                  in: { $add: ['$$value', '$$this.price'] }
                }
              }
            },
            recentServicesCount: {
              $sum: {
                $size: {
                  $filter: {
                    input: '$services',
                    as: 'service',
                    cond: {
                      $gte: [
                        '$$service.date',
                        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
                      ]
                    }
                  }
                }
              }
            }
          }
        }
      ]),
      Vehicle.findExpiringRegistrations(30)
    ]);

    // Get basic statistics
    const basicStats = statsAgg[0] || {
      totalVehicles: 0,
      activeVehicles: 0,
      inMaintenanceVehicles: 0,
      totalServiceCosts: 0,
      recentServicesCount: 0
    };

    const result = {
      ...basicStats,
      expiringRegistrations: expiringRegistrations.length
    };

    // Cache the result
    vehicleStatsCache = result;
    vehicleStatsCacheTime = now;

    const endTime = Date.now();
    console.log(`Vehicle statistics calculated in ${endTime - startTime}ms (cached for ${VEHICLE_STATS_CACHE_TTL/1000}s)`);

    res.json(result);
  } catch (error) {
    console.error('Greška pri dohvatanju statistika vozila:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju statistika vozila' });
  }
});

// POST - Upload invoice image for service
router.post('/:id/services/:serviceId/invoice', invoiceUpload.single('invoice'), async (req, res) => {
  try {
    const { id, serviceId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Slika fakture nije priložena' });
    }

    const vehicle = await Vehicle.findById(id);

    if (!vehicle) {
      return res.status(404).json({ error: 'Vozilo nije pronađeno' });
    }

    const service = vehicle.services.id(serviceId);

    if (!service) {
      return res.status(404).json({ error: 'Servis nije pronađen' });
    }

    // Upload image to Cloudinary
    console.log('Uploading service invoice to Cloudinary...');
    const cloudinaryResult = await uploadServiceInvoice(req.file.buffer, id, serviceId);

    // Save the URL to the service
    service.invoiceImage = cloudinaryResult.secure_url;
    await vehicle.save();

    console.log('Service invoice uploaded successfully:', cloudinaryResult.secure_url);

    res.json({
      message: 'Slika fakture uspešno uploadovana',
      invoiceImage: cloudinaryResult.secure_url
    });
  } catch (error) {
    console.error('Greška pri upload-u slike fakture:', error);
    res.status(500).json({ error: 'Greška pri upload-u slike fakture' });
  }
});

// DELETE - Delete invoice image for service
router.delete('/:id/services/:serviceId/invoice', async (req, res) => {
  try {
    const { id, serviceId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    const vehicle = await Vehicle.findById(id);

    if (!vehicle) {
      return res.status(404).json({ error: 'Vozilo nije pronađeno' });
    }

    const service = vehicle.services.id(serviceId);

    if (!service) {
      return res.status(404).json({ error: 'Servis nije pronađen' });
    }

    if (!service.invoiceImage) {
      return res.status(400).json({ error: 'Servis nema sliku fakture' });
    }

    // Extract public_id from Cloudinary URL
    const urlParts = service.invoiceImage.split('/');
    const folderAndFilename = urlParts.slice(-2).join('/'); // vehicle-service-invoices/filename
    const publicId = folderAndFilename.split('.')[0]; // Remove extension

    // Delete from Cloudinary
    console.log('Deleting service invoice from Cloudinary:', publicId);
    await deleteServiceInvoice(publicId);

    // Remove URL from service
    service.invoiceImage = undefined;
    await vehicle.save();

    console.log('Service invoice deleted successfully');

    res.json({ message: 'Slika fakture uspešno obrisana' });
  } catch (error) {
    console.error('Greška pri brisanju slike fakture:', error);
    res.status(500).json({ error: 'Greška pri brisanju slike fakture' });
  }
});

module.exports = router;