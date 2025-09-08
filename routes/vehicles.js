const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Vehicle = require('../models/Vehicle');

// GET - Get all vehicles
router.get('/', async (req, res) => {
  try {
    const vehicles = await Vehicle.find()
      .sort({ createdAt: -1 })
      .populate('services');
    
    res.json(vehicles);
  } catch (error) {
    console.error('Greška pri dohvatanju vozila:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju vozila' });
  }
});

// GET - Get vehicles with registration status
router.get('/with-status', async (req, res) => {
  try {
    const vehicles = await Vehicle.find({ status: { $ne: 'sold' } })
      .sort({ registrationExpiry: 1 });
    
    // Add computed status to each vehicle
    const vehiclesWithStatus = vehicles.map(vehicle => ({
      ...vehicle.toObject(),
      registrationStatus: vehicle.registrationStatus,
      daysUntilRegistrationExpiry: vehicle.daysUntilRegistrationExpiry,
      latestService: vehicle.latestService,
      totalServiceCost: vehicle.totalServiceCost
    }));
    
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
router.post('/', async (req, res) => {
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
      price: parseFloat(serviceData.price),
      comment: serviceData.comment ? serviceData.comment.trim() : '',
      nextServiceDue: serviceData.nextServiceDue ? new Date(serviceData.nextServiceDue) : undefined,
      serviceType: serviceData.serviceType || 'regular'
    };
    
    vehicle.services.push(newService);
    
    // Update vehicle mileage if provided
    if (serviceData.mileage && serviceData.mileage > vehicle.mileage) {
      vehicle.mileage = serviceData.mileage;
    }
    
    const updatedVehicle = await vehicle.save();
    
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
router.put('/:id', async (req, res) => {
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
    if (updateData.price !== undefined) service.price = parseFloat(updateData.price);
    if (updateData.comment !== undefined) service.comment = updateData.comment.trim();
    if (updateData.nextServiceDue !== undefined) service.nextServiceDue = updateData.nextServiceDue ? new Date(updateData.nextServiceDue) : undefined;
    if (updateData.serviceType) service.serviceType = updateData.serviceType;
    
    const updatedVehicle = await vehicle.save();
    
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
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const deletedVehicle = await Vehicle.findByIdAndDelete(id);
    
    if (!deletedVehicle) {
      return res.status(404).json({ error: 'Vozilo nije pronađeno' });
    }
    
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
    
    res.json({ message: 'Servis uspešno obrisan' });
  } catch (error) {
    console.error('Greška pri brisanju servisa:', error);
    res.status(500).json({ error: 'Greška pri brisanju servisa' });
  }
});

// GET - Get vehicle statistics
router.get('/stats/overview', async (req, res) => {
  try {
    const totalVehicles = await Vehicle.countDocuments({ status: { $ne: 'sold' } });
    const activeVehicles = await Vehicle.countDocuments({ status: 'active' });
    const inMaintenanceVehicles = await Vehicle.countDocuments({ status: 'maintenance' });
    
    // Get expiring registrations (next 30 days)
    const expiringRegistrations = await Vehicle.findExpiringRegistrations(30);
    
    // Calculate total service costs
    const vehicles = await Vehicle.find({ status: { $ne: 'sold' } });
    const totalServiceCosts = vehicles.reduce((total, vehicle) => total + vehicle.totalServiceCost, 0);
    
    // Recent services (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentServicesCount = vehicles.reduce((count, vehicle) => {
      const recentServices = vehicle.services.filter(service => new Date(service.date) >= thirtyDaysAgo);
      return count + recentServices.length;
    }, 0);
    
    res.json({
      totalVehicles,
      activeVehicles,
      inMaintenanceVehicles,
      expiringRegistrations: expiringRegistrations.length,
      totalServiceCosts,
      recentServicesCount
    });
  } catch (error) {
    console.error('Greška pri dohvatanju statistika vozila:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju statistika vozila' });
  }
});

module.exports = router;