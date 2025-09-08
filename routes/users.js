// Kreirati u direktorijumu: routes/users.js
const express = require('express');
const router = express.Router();
const { User, WorkOrder } = require('../models');
const mongoose = require('mongoose');

// GET - Dohvati sve korisnike
router.get('/', async (req, res) => {
  try {
    const users = await User.find().populate({
      path: 'workOrders',
      select: 'status date type',
      options: { sort: { date: -1 } }
    });

    // Dodaj broj instalirane opreme i serijske brojeve za svakog korisnika
    const Equipment = require('../models/Equipment');
    const usersWithEquipment = await Promise.all(users.map(async (user) => {
      const installedEquipment = await Equipment.find({
        location: `user-${user.tisId}`,
        status: 'installed'
      }).select('serialNumber category description');
      
      return {
        ...user.toObject(),
        equipmentCount: installedEquipment.length,
        installedEquipment: installedEquipment.map(eq => ({
          serialNumber: eq.serialNumber,
          category: eq.category,
          description: eq.description
        }))
      };
    }));
    
    res.json(usersWithEquipment);
  } catch (error) {
    console.error('Greška pri dohvatanju korisnika:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju korisnika' });
  }
});

// GET - Dohvati korisnika po ID-u
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const user = await User.findById(id);
    
    if (!user) {
      return res.status(404).json({ error: 'Korisnik nije pronađen' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Greška pri dohvatanju korisnika:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju korisnika' });
  }
});

// GET - Dohvati korisnika po TIS ID-u
router.get('/tis/:tisId', async (req, res) => {
  try {
    const { tisId } = req.params;
    const user = await User.findOne({ tisId });
    
    if (!user) {
      return res.status(404).json({ error: 'Korisnik nije pronađen' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Greška pri dohvatanju korisnika:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju korisnika' });
  }
});

// GET - Pretraži korisnike po bilo kom polju
router.get('/search/:term', async (req, res) => {
  try {
    const { term } = req.params;
    
    const filteredUsers = await User.find({
      $or: [
        { name: { $regex: term, $options: 'i' } },
        { address: { $regex: term, $options: 'i' } },
        { phone: { $regex: term, $options: 'i' } },
        { tisId: { $regex: term, $options: 'i' } }
      ]
    });
    
    res.json(filteredUsers);
  } catch (error) {
    console.error('Greška pri pretraživanju korisnika:', error);
    res.status(500).json({ error: 'Greška pri pretraživanju korisnika' });
  }
});

// GET - Dohvati radne naloge korisnika
router.get('/:id/workorders', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const user = await User.findById(id);
    
    if (!user) {
      return res.status(404).json({ error: 'Korisnik nije pronađen' });
    }
    
    const userWorkOrders = await WorkOrder.find({ user: id })
      .populate('technicianId', 'name _id')
      .sort({ date: -1 })
      .lean();
    
    res.json(userWorkOrders);
  } catch (error) {
    console.error('Greška pri dohvatanju radnih naloga korisnika:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju radnih naloga korisnika' });
  }
});

// POST - Kreiraj novog korisnika
router.post('/', async (req, res) => {
  try {
    const { tisId, name, address, phone } = req.body;
    
    if (!tisId || !name || !address) {
      return res.status(400).json({ error: 'TIS ID, ime i adresa su obavezni' });
    }
    
    // Provera da li već postoji korisnik sa datim TIS ID-om
    const existingUser = await User.findOne({ tisId });
    if (existingUser) {
      return res.status(400).json({ error: 'Korisnik sa datim TIS ID-om već postoji' });
    }
    
    const newUser = new User({
      tisId,
      name,
      address,
      phone: phone || '',
      workOrders: []
    });
    
    const savedUser = await newUser.save();
    res.status(201).json(savedUser);
  } catch (error) {
    console.error('Greška pri kreiranju korisnika:', error);
    res.status(500).json({ error: 'Greška pri kreiranju korisnika' });
  }
});

// PUT - Ažuriraj korisnika
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { tisId, name, address, phone } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const user = await User.findById(id);
    
    if (!user) {
      return res.status(404).json({ error: 'Korisnik nije pronađen' });
    }
    
    // Ako se TIS ID menja, provera da li je jedinstven
    if (tisId && tisId !== user.tisId) {
      const duplicateTisId = await User.findOne({ tisId, _id: { $ne: id } });
      if (duplicateTisId) {
        return res.status(400).json({ error: 'TIS ID mora biti jedinstven' });
      }
    }
    
    user.tisId = tisId || user.tisId;
    user.name = name || user.name;
    user.address = address || user.address;
    user.phone = phone !== undefined ? phone : user.phone;
    
    const updatedUser = await user.save();
    res.json(updatedUser);
  } catch (error) {
    console.error('Greška pri ažuriranju korisnika:', error);
    res.status(500).json({ error: 'Greška pri ažuriranju korisnika' });
  }
});

// DELETE - Obriši korisnika
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const deletedUser = await User.findByIdAndDelete(id);
    
    if (!deletedUser) {
      return res.status(404).json({ error: 'Korisnik nije pronađen' });
    }
    
    // Možemo razmotriti brisanje i povezanih workOrders
    
    res.json({ message: 'Korisnik uspešno obrisan' });
  } catch (error) {
    console.error('Greška pri brisanju korisnika:', error);
    res.status(500).json({ error: 'Greška pri brisanju korisnika' });
  }
});

// POST - Dodaj radni nalog korisniku
router.post('/:id/workorders/:workOrderId', async (req, res) => {
  try {
    const { id, workOrderId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(workOrderId)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'Korisnik nije pronađen' });
    }
    
    const workOrder = await WorkOrder.findById(workOrderId);
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }
    
    // Proveri da li radni nalog već postoji kod korisnika
    if (!user.workOrders.includes(workOrderId)) {
      user.workOrders.push(workOrderId);
      await user.save();
    }
    
    res.json(user);
  } catch (error) {
    console.error('Greška pri dodavanju radnog naloga korisniku:', error);
    res.status(500).json({ error: 'Greška pri dodavanju radnog naloga korisniku' });
  }
});

// DELETE - Ukloni radni nalog sa korisnika
router.delete('/:id/workorders/:workOrderId', async (req, res) => {
  try {
    const { id, workOrderId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(workOrderId)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'Korisnik nije pronađen' });
    }
    
    // Ukloni radni nalog iz niza workOrders
    user.workOrders = user.workOrders.filter(
      orderId => orderId.toString() !== workOrderId
    );
    
    await user.save();
    res.json(user);
  } catch (error) {
    console.error('Greška pri uklanjanju radnog naloga sa korisnika:', error);
    res.status(500).json({ error: 'Greška pri uklanjanju radnog naloga sa korisnika' });
  }
});

module.exports = router;