const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { Material } = require('../models');

// GET - Dohvati sve materijale sa podrškom za query parametre
router.get('/', async (req, res) => {
  try {
    const { stats, limit } = req.query;

    // Ako je traženo samo stats=true, vrati samo potrebne podatke za statistike
    if (stats === 'true') {
      const materials = await Material.find().select('type quantity'); // Samo type i quantity fields
      res.json(materials);
      return;
    }

    // Ako je tražen limit, ograniči rezultate
    if (limit) {
      const limitNum = parseInt(limit, 10);
      const materials = await Material.find().limit(limitNum);
      res.json(materials);
      return;
    }

    // Default - dohvati sve materijale
    const materials = await Material.find();
    res.json(materials);
  } catch (error) {
    console.error('Greška pri dohvatanju materijala:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju materijala' });
  }
});

// GET - Dohvati materijal po ID-u
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const material = await Material.findById(id);
    
    if (!material) {
      return res.status(404).json({ error: 'Materijal nije pronađen' });
    }
    
    res.json(material);
  } catch (error) {
    console.error('Greška pri dohvatanju materijala:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju materijala' });
  }
});

// POST - Dodaj novi materijal
router.post('/', async (req, res) => {
  try {
    const { type, quantity } = req.body;
    
    if (!type || quantity === undefined) {
      return res.status(400).json({ error: 'Vrsta i količina materijala su obavezna polja' });
    }
    
    // Provera da li materijal već postoji
    const existingMaterial = await Material.findOne({ 
      type: { $regex: new RegExp(`^${type}$`, 'i') }
    });
    
    if (existingMaterial) {
      return res.status(400).json({ error: 'Materijal sa ovim nazivom već postoji' });
    }
    
    const newMaterial = new Material({
      type,
      quantity: parseInt(quantity, 10)
    });
    
    const savedMaterial = await newMaterial.save();
    res.status(201).json(savedMaterial);
  } catch (error) {
    console.error('Greška pri kreiranju materijala:', error);
    res.status(500).json({ error: 'Greška pri kreiranju materijala' });
  }
});

// PUT - Ažuriranje materijala
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { type, quantity } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    if ((!type && quantity === undefined) || parseInt(quantity, 10) < 0) {
      return res.status(400).json({ error: 'Neispravni podaci za ažuriranje' });
    }
    
    const material = await Material.findById(id);
    
    if (!material) {
      return res.status(404).json({ error: 'Materijal nije pronađen' });
    }
    
    // Provera da li drugi materijal već koristi ovaj naziv
    if (type && type !== material.type) {
      const duplicateType = await Material.findOne({ 
        _id: { $ne: id },
        type: { $regex: new RegExp(`^${type}$`, 'i') }
      });
      
      if (duplicateType) {
        return res.status(400).json({ error: 'Materijal sa ovim nazivom već postoji' });
      }
      
      material.type = type;
    }
    
    if (quantity !== undefined) {
      material.quantity = parseInt(quantity, 10);
    }
    
    const updatedMaterial = await material.save();
    res.json(updatedMaterial);
  } catch (error) {
    console.error('Greška pri ažuriranju materijala:', error);
    res.status(500).json({ error: 'Greška pri ažuriranju materijala' });
  }
});

// DELETE - Brisanje materijala
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const deletedMaterial = await Material.findByIdAndDelete(id);
    
    if (!deletedMaterial) {
      return res.status(404).json({ error: 'Materijal nije pronađen' });
    }
    
    res.json({ message: 'Materijal uspešno obrisan' });
  } catch (error) {
    console.error('Greška pri brisanju materijala:', error);
    res.status(500).json({ error: 'Greška pri brisanju materijala' });
  }
});

module.exports = router;