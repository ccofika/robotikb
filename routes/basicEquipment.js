const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { BasicEquipment } = require('../models');
const { logActivity } = require('../middleware/activityLogger');

// GET - Dohvati svu osnovnu opremu
router.get('/', async (req, res) => {
  try {
    const basicEquipment = await BasicEquipment.find();
    res.json(basicEquipment);
  } catch (error) {
    console.error('Greška pri dohvatanju osnovne opreme:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju osnovne opreme' });
  }
});

// GET - Dohvati osnovnu opremu po ID-u
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    const basicEquipment = await BasicEquipment.findById(id);

    if (!basicEquipment) {
      return res.status(404).json({ error: 'Osnovna oprema nije pronađena' });
    }

    res.json(basicEquipment);
  } catch (error) {
    console.error('Greška pri dohvatanju osnovne opreme:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju osnovne opreme' });
  }
});

// POST - Dodaj novu osnovnu opremu
router.post('/', logActivity('equipment', 'basic_equipment_add', {
  getEntityName: (req, responseData) => responseData?.type
}), async (req, res) => {
  try {
    const { type, serialNumber, quantity } = req.body;

    if (!type || quantity === undefined) {
      return res.status(400).json({ error: 'Vrsta i količina osnovne opreme su obavezna polja' });
    }

    // Provera da li osnovna oprema već postoji
    const existingBasicEquipment = await BasicEquipment.findOne({
      type: { $regex: new RegExp(`^${type}$`, 'i') }
    });

    if (existingBasicEquipment) {
      return res.status(400).json({ error: 'Osnovna oprema sa ovim nazivom već postoji' });
    }

    const newBasicEquipment = new BasicEquipment({
      type,
      serialNumber: serialNumber || '',
      quantity: parseInt(quantity, 10)
    });

    const savedBasicEquipment = await newBasicEquipment.save();
    res.status(201).json(savedBasicEquipment);
  } catch (error) {
    console.error('Greška pri kreiranju osnovne opreme:', error);
    res.status(500).json({ error: 'Greška pri kreiranju osnovne opreme' });
  }
});

// PUT - Ažuriranje osnovne opreme
router.put('/:id', logActivity('equipment', 'basic_equipment_edit', {
  getEntityId: (req) => req.params.id,
  getEntityName: (req, responseData) => responseData?.type
}), async (req, res) => {
  try {
    const { id } = req.params;
    const { type, serialNumber, quantity } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    if ((!type && quantity === undefined && serialNumber === undefined) || (quantity !== undefined && parseInt(quantity, 10) < 0)) {
      return res.status(400).json({ error: 'Neispravni podaci za ažuriranje' });
    }

    const basicEquipment = await BasicEquipment.findById(id);

    if (!basicEquipment) {
      return res.status(404).json({ error: 'Osnovna oprema nije pronađena' });
    }

    // Provera da li druga osnovna oprema već koristi ovaj naziv
    if (type && type !== basicEquipment.type) {
      const duplicateType = await BasicEquipment.findOne({
        _id: { $ne: id },
        type: { $regex: new RegExp(`^${type}$`, 'i') }
      });

      if (duplicateType) {
        return res.status(400).json({ error: 'Osnovna oprema sa ovim nazivom već postoji' });
      }

      basicEquipment.type = type;
    }

    if (serialNumber !== undefined) {
      basicEquipment.serialNumber = serialNumber;
    }

    if (quantity !== undefined) {
      basicEquipment.quantity = parseInt(quantity, 10);
    }

    const updatedBasicEquipment = await basicEquipment.save();
    res.json(updatedBasicEquipment);
  } catch (error) {
    console.error('Greška pri ažuriranju osnovne opreme:', error);
    res.status(500).json({ error: 'Greška pri ažuriranju osnovne opreme' });
  }
});

// DELETE - Brisanje osnovne opreme
router.delete('/:id', logActivity('equipment', 'basic_equipment_delete', {
  getEntityId: (req) => req.params.id
}), async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    const deletedBasicEquipment = await BasicEquipment.findByIdAndDelete(id);

    if (!deletedBasicEquipment) {
      return res.status(404).json({ error: 'Osnovna oprema nije pronađena' });
    }

    res.json({ message: 'Osnovna oprema uspešno obrisana' });
  } catch (error) {
    console.error('Greška pri brisanju osnovne opreme:', error);
    res.status(500).json({ error: 'Greška pri brisanju osnovne opreme' });
  }
});

module.exports = router;