const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const { Technician, Equipment, Material } = require('../models');

// GET - Dohvati sve tehničare
router.get('/', async (req, res) => {
  try {
    const technicians = await Technician.find().select('-password');
    res.json(technicians);
  } catch (error) {
    console.error('Greška pri dohvatanju tehničara:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju tehničara' });
  }
});

// GET - Dohvati tehničara po ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const technician = await Technician.findById(id).select('-password');
    
    if (!technician) {
      return res.status(404).json({ error: 'Tehničar nije pronađen' });
    }
    
    // Dohvatanje opreme zadužene kod tehničara
    const equipment = await Equipment.find({ assignedTo: id });
    
    // Dohvatanje materijala zaduženih kod tehničara
    const materialsWithDetails = [];
    
    for (const materialItem of technician.materials || []) {
      const materialDetails = await Material.findById(materialItem.materialId);
      if (materialDetails) {
        materialsWithDetails.push({
          id: materialItem.materialId.toString(),
          _id: materialItem.materialId.toString(),
          type: materialDetails.type,
          quantity: materialItem.quantity
        });
      }
    }
    
    res.json({
      ...technician.toObject(),
      equipment,
      materials: materialsWithDetails
    });
  } catch (error) {
    console.error('Greška pri dohvatanju tehničara:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju tehničara' });
  }
});

// GET - Dohvati opremu tehničara
router.get('/:id/equipment', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('=== FETCHING TECHNICIAN EQUIPMENT ===');
    console.log('Technician ID:', id);
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.error('Invalid technician ID format:', id);
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const technician = await Technician.findById(id);
    if (!technician) {
      console.error('Technician not found with ID:', id);
      return res.status(404).json({ error: 'Tehničar nije pronađen' });
    }
    
    console.log('Technician found:', technician.name);
    
    // Dohvati svu opremu koja je dodeljena tehničaru
    const equipment = await Equipment.find({ assignedTo: id });
    
    console.log('Raw equipment query result:');
    console.log('Total equipment found:', equipment.length);
    
    equipment.forEach((eq, index) => {
      console.log(`Equipment ${index + 1}:`, {
        id: eq._id.toString(),
        serialNumber: eq.serialNumber,
        description: eq.description,
        status: eq.status,
        location: eq.location,
        assignedTo: eq.assignedTo?.toString(),
        assignedToUser: eq.assignedToUser
      });
    });
    
    console.log('Sending equipment response to frontend');
    res.json(equipment);
  } catch (error) {
    console.error('Greška pri dohvatanju opreme tehničara:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju opreme tehničara' });
  }
});

// GET - Dohvati materijale tehničara
router.get('/:id/materials', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('=== FETCHING TECHNICIAN MATERIALS ===');
    console.log('Technician ID:', id);
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.error('Invalid technician ID format:', id);
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const technician = await Technician.findById(id);
    if (!technician) {
      console.error('Technician not found with ID:', id);
      return res.status(404).json({ error: 'Tehničar nije pronađen' });
    }
    
    console.log('Technician found:', technician.name);
    console.log('Technician materials array:', technician.materials);
    
    // Dohvatanje materijala zaduženih kod tehničara sa detaljima
    const materialsWithDetails = [];
    
    for (const materialItem of technician.materials || []) {
      const materialDetails = await Material.findById(materialItem.materialId);
      if (materialDetails) {
        materialsWithDetails.push({
          id: materialItem.materialId.toString(),
          _id: materialItem.materialId.toString(),
          type: materialDetails.type,
          quantity: materialItem.quantity
        });
      }
    }
    
    console.log('Materials with details:', materialsWithDetails);
    console.log('Sending materials response to frontend');
    res.json(materialsWithDetails);
  } catch (error) {
    console.error('Greška pri dohvatanju materijala tehničara:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju materijala tehničara' });
  }
});

// POST - Kreiraj novog tehničara
router.post('/', async (req, res) => {
  try {
    const { name, password } = req.body;
    
    if (!name || !password) {
      return res.status(400).json({ error: 'Ime i lozinka su obavezna polja' });
    }
    
    // Provera da li tehničar sa istim imenom već postoji
    const existingTechnician = await Technician.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
    
    if (existingTechnician) {
      return res.status(400).json({ error: 'Tehničar sa ovim imenom već postoji' });
    }
    
    // Heširanje lozinke
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const newTechnician = new Technician({
      name,
      password: hashedPassword,
      materials: [],
      equipment: []
    });
    
    const savedTechnician = await newTechnician.save();
    
    // Ne vraćamo lozinku u odgovoru
    const technicianResponse = savedTechnician.toObject();
    delete technicianResponse.password;
    
    res.status(201).json(technicianResponse);
  } catch (error) {
    console.error('Greška pri kreiranju tehničara:', error);
    res.status(500).json({ error: 'Greška pri kreiranju tehničara' });
  }
});

// PUT - Ažuriranje tehničara
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, password } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const technician = await Technician.findById(id);
    
    if (!technician) {
      return res.status(404).json({ error: 'Tehničar nije pronađen' });
    }
    
    // Ako se menja ime, proveriti da li već postoji tehničar sa tim imenom
    if (name && name !== technician.name) {
      const existingTechnician = await Technician.findOne({
        _id: { $ne: id },
        name: { $regex: new RegExp(`^${name}$`, 'i') }
      });
      
      if (existingTechnician) {
        return res.status(400).json({ error: 'Tehničar sa ovim imenom već postoji' });
      }
      
      technician.name = name;
    }
    
    // Ako se menja lozinka, heširati novu
    if (password) {
      const salt = await bcrypt.genSalt(10);
      technician.password = await bcrypt.hash(password, salt);
    }
    
    const updatedTechnician = await technician.save();
    
    // Ne vraćamo lozinku u odgovoru
    const technicianResponse = updatedTechnician.toObject();
    delete technicianResponse.password;
    
    res.json(technicianResponse);
  } catch (error) {
    console.error('Greška pri ažuriranju tehničara:', error);
    res.status(500).json({ error: 'Greška pri ažuriranju tehničara' });
  }
});

// DELETE - Brisanje tehničara
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const technician = await Technician.findById(id);
    
    if (!technician) {
      return res.status(404).json({ error: 'Tehničar nije pronađen' });
    }
    
    // Proveri da li je admin
    if (technician.isAdmin) {
      return res.status(403).json({ error: 'Nije moguće obrisati administratora' });
    }
    
    // Oslobodi svu opremu koja je dodeljena ovom tehničaru
    await Equipment.updateMany(
      { assignedTo: id },
      { $set: { assignedTo: null, location: 'magacin', status: 'available' } }
    );
    
    await Technician.findByIdAndDelete(id);
    
    res.json({ message: 'Tehničar uspešno obrisan' });
  } catch (error) {
    console.error('Greška pri brisanju tehničara:', error);
    res.status(500).json({ error: 'Greška pri brisanju tehničara' });
  }
});

// POST - Dodaj materijal tehničaru
router.post('/:id/materials', async (req, res) => {
  try {
    const { id } = req.params;
    const { materialId, quantity } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(materialId)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    if (!quantity || quantity <= 0) {
      return res.status(400).json({ error: 'Količina mora biti pozitivan broj' });
    }
    
    const technician = await Technician.findById(id);
    if (!technician) {
      return res.status(404).json({ error: 'Tehničar nije pronađen' });
    }
    
    const material = await Material.findById(materialId);
    if (!material) {
      return res.status(404).json({ error: 'Materijal nije pronađen' });
    }
    
    // Proveri da li ima dovoljno materijala na stanju
    if (material.quantity < quantity) {
      return res.status(400).json({ error: 'Nema dovoljno materijala na stanju' });
    }
    
    // Proveri da li tehničar već ima ovaj materijal
    const existingMaterialIndex = technician.materials.findIndex(
      item => item.materialId.toString() === materialId
    );
    
    if (existingMaterialIndex !== -1) {
      // Ažuriraj postojeću količinu
      technician.materials[existingMaterialIndex].quantity += parseInt(quantity, 10);
    } else {
      // Dodaj novi materijal
      technician.materials.push({
        materialId,
        quantity: parseInt(quantity, 10)
      });
    }
    
    // Smanji količinu materijala u magacinu
    material.quantity -= parseInt(quantity, 10);
    await material.save();
    
    // Sačuvaj tehničara
    const updatedTechnician = await technician.save();
    
    // Dohvati ažurirane podatke o materijalima
    const materialsWithDetails = [];
    
    for (const materialItem of updatedTechnician.materials) {
      const materialDetails = await Material.findById(materialItem.materialId);
      if (materialDetails) {
        materialsWithDetails.push({
          id: materialItem.materialId.toString(),
          _id: materialItem.materialId.toString(),
          type: materialDetails.type,
          quantity: materialItem.quantity
        });
      }
    }
    
    res.json({
      ...updatedTechnician.toObject(),
      materials: materialsWithDetails
    });
  } catch (error) {
    console.error('Greška pri dodavanju materijala tehničaru:', error);
    res.status(500).json({ error: 'Greška pri dodavanju materijala tehničaru' });
  }
});

// PUT - Ažuriraj količinu materijala kod tehničara
router.put('/:id/materials/:materialId', async (req, res) => {
  try {
    const { id, materialId } = req.params;
    const { quantity } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(materialId)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    if (quantity === undefined || quantity < 0) {
      return res.status(400).json({ error: 'Količina mora biti pozitivan broj ili nula' });
    }
    
    const technician = await Technician.findById(id);
    if (!technician) {
      return res.status(404).json({ error: 'Tehničar nije pronađen' });
    }
    
    const material = await Material.findById(materialId);
    if (!material) {
      return res.status(404).json({ error: 'Materijal nije pronađen' });
    }
    
    // Pronađi materijal kod tehničara
    const materialIndex = technician.materials.findIndex(
      item => item.materialId.toString() === materialId
    );
    
    if (materialIndex === -1) {
      return res.status(404).json({ error: 'Tehničar nema zadužen ovaj materijal' });
    }
    
    const oldQuantity = technician.materials[materialIndex].quantity;
    const quantityDiff = parseInt(quantity, 10) - oldQuantity;
    
    // Ako se količina smanjuje, vrati razliku u magacin
    if (quantityDiff < 0) {
      material.quantity += Math.abs(quantityDiff);
      await material.save();
    }
    // Ako se količina povećava, proveri da li ima dovoljno u magacinu
    else if (quantityDiff > 0) {
      if (material.quantity < quantityDiff) {
        return res.status(400).json({ error: 'Nema dovoljno materijala na stanju' });
      }
      
      material.quantity -= quantityDiff;
      await material.save();
    }
    
    // Ažuriraj količinu kod tehničara
    if (parseInt(quantity, 10) === 0) {
      // Ako je količina 0, ukloni materijal
      technician.materials.splice(materialIndex, 1);
    } else {
      // Inače ažuriraj količinu
      technician.materials[materialIndex].quantity = parseInt(quantity, 10);
    }
    
    const updatedTechnician = await technician.save();
    
    // Dohvati ažurirane podatke o materijalima
    const materialsWithDetails = [];
    
    for (const materialItem of updatedTechnician.materials) {
      const materialDetails = await Material.findById(materialItem.materialId);
      if (materialDetails) {
        materialsWithDetails.push({
          id: materialItem.materialId.toString(),
          _id: materialItem.materialId.toString(),
          type: materialDetails.type,
          quantity: materialItem.quantity
        });
      }
    }
    
    res.json({
      ...updatedTechnician.toObject(),
      materials: materialsWithDetails
    });
  } catch (error) {
    console.error('Greška pri ažuriranju materijala tehničara:', error);
    res.status(500).json({ error: 'Greška pri ažuriranju materijala tehničara' });
  }
});

// DELETE - Ukloni materijal od tehničara
router.delete('/:id/materials/:materialId', async (req, res) => {
  try {
    const { id, materialId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(materialId)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const technician = await Technician.findById(id);
    if (!technician) {
      return res.status(404).json({ error: 'Tehničar nije pronađen' });
    }
    
    // Pronađi materijal kod tehničara
    const materialIndex = technician.materials.findIndex(
      item => item.materialId.toString() === materialId
    );
    
    if (materialIndex === -1) {
      return res.status(404).json({ error: 'Tehničar nema zadužen ovaj materijal' });
    }
    
    // Vrati materijal u magacin
    const material = await Material.findById(materialId);
    if (material) {
      material.quantity += technician.materials[materialIndex].quantity;
      await material.save();
    }
    
    // Ukloni materijal od tehničara
    technician.materials.splice(materialIndex, 1);
    const updatedTechnician = await technician.save();
    
    // Dohvati ažurirane podatke o materijalima
    const materialsWithDetails = [];
    
    for (const materialItem of updatedTechnician.materials) {
      const materialDetails = await Material.findById(materialItem.materialId);
      if (materialDetails) {
        materialsWithDetails.push({
          id: materialItem.materialId.toString(),
          _id: materialItem.materialId.toString(),
          type: materialDetails.type,
          quantity: materialItem.quantity
        });
      }
    }
    
    res.json({
      ...updatedTechnician.toObject(),
      materials: materialsWithDetails
    });
  } catch (error) {
    console.error('Greška pri uklanjanju materijala od tehničara:', error);
    res.status(500).json({ error: 'Greška pri uklanjanju materijala od tehničara' });
  }
});

// POST - Assign equipment to technician
router.post('/:id/equipment', async (req, res) => {
  try {
    const { id } = req.params;
    const { serialNumbers } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid technician ID format' });
    }
    
    if (!Array.isArray(serialNumbers) || serialNumbers.length === 0) {
      return res.status(400).json({ error: 'No equipment selected for assignment' });
    }
    
    const technician = await Technician.findById(id);
    if (!technician) {
      return res.status(404).json({ error: 'Technician not found' });
    }
    
    // Update all equipment items
    const updateResults = await Equipment.updateMany(
      { 
        serialNumber: { $in: serialNumbers },
        location: 'magacin'  // Only allow assigning from warehouse
      },
      { 
        $set: { 
          assignedTo: id,
          location: `tehnicar-${id}`,
          status: 'assigned'
        }
      }
    );
    
    if (updateResults.modifiedCount === 0) {
      return res.status(400).json({ error: 'No equipment was available for assignment' });
    }
    
    res.json({ 
      message: `Successfully assigned ${updateResults.modifiedCount} equipment items`,
      modifiedCount: updateResults.modifiedCount
    });
  } catch (error) {
    console.error('Error assigning equipment:', error);
    res.status(500).json({ error: 'Error assigning equipment' });
  }
});

// POST - Return equipment from technician
router.post('/:id/equipment/return', async (req, res) => {
  try {
    const { id } = req.params;
    const { serialNumbers } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid technician ID format' });
    }
    
    if (!Array.isArray(serialNumbers) || serialNumbers.length === 0) {
      return res.status(400).json({ error: 'No equipment selected for return' });
    }
    
    const technician = await Technician.findById(id);
    if (!technician) {
      return res.status(404).json({ error: 'Technician not found' });
    }
    
    // Update all equipment items
    const updateResults = await Equipment.updateMany(
      { 
        serialNumber: { $in: serialNumbers },
        assignedTo: id  // Only allow returning equipment assigned to this technician
      },
      { 
        $set: { 
          assignedTo: null,
          location: 'magacin',
          status: 'available'
        }
      }
    );
    
    if (updateResults.modifiedCount === 0) {
      return res.status(400).json({ error: 'No equipment was available for return' });
    }
    
    res.json({ 
      message: `Successfully returned ${updateResults.modifiedCount} equipment items`,
      modifiedCount: updateResults.modifiedCount
    });
  } catch (error) {
    console.error('Error returning equipment:', error);
    res.status(500).json({ error: 'Error returning equipment' });
  }
});

// POST - Return material from technician
router.post('/:id/materials/return', async (req, res) => {
  try {
    const { id } = req.params;
    const { materialId, quantity } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(materialId)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    if (!quantity || quantity <= 0) {
      return res.status(400).json({ error: 'Količina mora biti pozitivan broj' });
    }
    
    const technician = await Technician.findById(id);
    if (!technician) {
      return res.status(404).json({ error: 'Tehničar nije pronađen' });
    }
    
    // Pronađi materijal kod tehničara
    const technicianMaterialIndex = technician.materials.findIndex(
      item => item.materialId.toString() === materialId
    );
    
    if (technicianMaterialIndex === -1) {
      return res.status(404).json({ error: 'Tehničar nema zadužen ovaj materijal' });
    }
    
    const technicianMaterial = technician.materials[technicianMaterialIndex];
    
    // Proveri da li tehničar ima dovoljno materijala za razduženje
    if (technicianMaterial.quantity < quantity) {
      return res.status(400).json({ error: 'Tehničar nema dovoljno materijala za razduženje' });
    }
    
    // Dohvati materijal iz magacina
    const material = await Material.findById(materialId);
    if (!material) {
      return res.status(404).json({ error: 'Materijal nije pronađen' });
    }
    
    // Ažuriraj količinu kod tehničara
    technicianMaterial.quantity -= parseInt(quantity, 10);
    
    // Ako je količina 0, ukloni materijal iz liste
    if (technicianMaterial.quantity === 0) {
      technician.materials.splice(technicianMaterialIndex, 1);
    }
    
    // Vrati materijal u magacin
    material.quantity += parseInt(quantity, 10);
    
    // Sačuvaj promene
    await Promise.all([
      technician.save(),
      material.save()
    ]);
    
    // Dohvati ažurirane podatke o materijalima
    const materialsWithDetails = [];
    
    for (const materialItem of technician.materials) {
      const materialDetails = await Material.findById(materialItem.materialId);
      if (materialDetails) {
        materialsWithDetails.push({
          id: materialItem.materialId.toString(),
          _id: materialItem.materialId.toString(),
          type: materialDetails.type,
          quantity: materialItem.quantity
        });
      }
    }
    
    res.json({
      ...technician.toObject(),
      materials: materialsWithDetails
    });
  } catch (error) {
    console.error('Greška pri razduživanju materijala:', error);
    res.status(500).json({ error: 'Greška pri razduživanju materijala' });
  }
});

module.exports = router;