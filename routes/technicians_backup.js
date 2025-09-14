const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const { Technician, Equipment, Material } = require('../models');
const { uploadImage } = require('../config/cloudinary');
const emailService = require('../services/emailService');

const JWT_SECRET = process.env.JWT_SECRET || 'telco-super-secret-key';

// Helper funkcija da dobije korisnika iz tokena
const getUserFromToken = async (req) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Pokušaj da nađeš korisnika u bazi po imenu (za admin) ili ID-u
    if (decoded.role === 'admin') {
      return await Technician.findOne({ name: decoded.name, isAdmin: true });
    } else {
      return await Technician.findById(decoded.id || decoded._id);
    }
  } catch (error) {
    return null;
  }
};

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
    
    // Dohvati samo opremu koju tehničar fizički poseduje (nije instalirana kod korisnika)
    const equipment = await Equipment.find({ 
      assignedTo: id,
      assignedToUser: null,  // Oprema nije dodeljena korisniku
      status: { $in: ['assigned', 'available'] }  // Oprema je dostupna tehničaru
    });
    
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
    
    console.log('Sending equipment response to frontend - showing only equipment physically with technician');
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
    const { name, password, gmail, profileImage } = req.body;
    
    // Ako se pokušava ažurirati sa "admin" ID-om, pronađi pravog korisnika iz tokena
    let technician;
    
    if (id === 'admin') {
      // Dobij korisnika iz JWT tokena
      technician = await getUserFromToken(req);
      if (!technician) {
        return res.status(401).json({ error: 'Neautorizovan pristup' });
      }
    } else {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Neispravan ID format' });
      }
      
      technician = await Technician.findById(id);
      
      if (!technician) {
        return res.status(404).json({ error: 'Tehničar nije pronađen' });
      }
    }
    
    // Ako se menja ime, proveriti da li već postoji tehničar sa tim imenom
    if (name && name !== technician.name) {
      const existingTechnician = await Technician.findOne({
        _id: { $ne: technician._id },
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
    
    // Ažuriraj Gmail adresu
    if (gmail !== undefined) {
      technician.gmail = gmail;
    }
    
    // Ažuriraj profilnu sliku
    if (profileImage !== undefined) {
      technician.profileImage = profileImage;
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
    
    // Update all equipment items - nova logika za potvrđivanje
    const updateResults = await Equipment.updateMany(
      { 
        serialNumber: { $in: serialNumbers },
        location: 'magacin'  // Only allow assigning from warehouse
      },
      { 
        $set: { 
          assignedTo: id,
          location: `tehnicar-${id}`,
          status: 'pending_confirmation',
          awaitingConfirmation: true,
          confirmationStatus: 'pending'
        }
      }
    );
    
    if (updateResults.modifiedCount === 0) {
      return res.status(400).json({ error: 'No equipment was available for assignment' });
    }
    
    // Send email notification to technician
    try {
      if (technician.gmail) {
        // Get the assigned equipment details for email
        const assignedEquipment = await Equipment.find({ 
          serialNumber: { $in: serialNumbers },
          assignedTo: id
        });
        
        const emailResult = await emailService.sendEmailToTechnician(
          id,
          'equipmentAssignment',
          {
            technicianName: technician.name,
            assignmentType: 'assign',
            equipment: assignedEquipment.map(eq => ({
              category: eq.category,
              description: eq.description,
              serialNumber: eq.serialNumber,
              status: eq.status
            }))
          }
        );
        
        if (emailResult.success) {
          console.log(`Email sent to technician ${technician.name} about equipment assignment`);
        } else {
          console.error('Failed to send email notification:', emailResult.error);
        }
      }
    } catch (emailError) {
      console.error('Error sending equipment assignment email:', emailError);
      // Ne prekidamo proces ako email ne uspe
    }

    res.json({ 
      message: `Successfully assigned ${updateResults.modifiedCount} equipment items - awaiting technician confirmation`,
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
    
    // Get equipment details before updating for email
    const equipmentToReturn = await Equipment.find({
      serialNumber: { $in: serialNumbers },
      assignedTo: id
    });
    
    if (equipmentToReturn.length === 0) {
      return res.status(400).json({ error: 'No equipment was available for return' });
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
    
    // Send email notification to technician
    try {
      if (technician.gmail) {
        const emailResult = await emailService.sendEmailToTechnician(
          id,
          'equipmentUnassignment',
          {
            technicianName: technician.name,
            equipment: equipmentToReturn.map(item => ({
              category: item.category,
              description: item.description,
              serialNumber: item.serialNumber,
              status: item.status
            }))
          }
        );
        
        if (emailResult.success) {
          console.log(`Unassignment email sent to technician ${technician.name} about ${equipmentToReturn.length} returned equipment items`);
        } else {
          console.error('Failed to send unassignment email notification:', emailResult.error);
        }
      }
    } catch (emailError) {
      console.error('Error sending equipment unassignment email:', emailError);
      // Ne prekidamo proces ako email ne uspe
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

// GET - Dohvati opremu koja čeka potvrdu za tehničara
router.get('/:id/equipment/pending', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format tehničara' });
    }
    
    const pendingEquipment = await Equipment.find({
      assignedTo: id,
      awaitingConfirmation: true,
      confirmationStatus: 'pending'
    });
    
    res.json(pendingEquipment);
  } catch (error) {
    console.error('Greška pri dohvatanju opreme koja čeka potvrdu:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju opreme koja čeka potvrdu' });
  }
});

// POST - Potvrdi opremu
router.post('/:id/equipment/confirm', async (req, res) => {
  try {
    const { id } = req.params;
    const { equipmentId } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(equipmentId)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const equipment = await Equipment.findOne({
      _id: equipmentId,
      assignedTo: id,
      awaitingConfirmation: true,
      confirmationStatus: 'pending'
    });
    
    if (!equipment) {
      return res.status(404).json({ error: 'Oprema nije pronađena ili ne čeka potvrdu' });
    }
    
    // Potvrdi opremu
    equipment.awaitingConfirmation = false;
    equipment.confirmationStatus = 'confirmed';
    equipment.status = 'assigned';
    equipment.confirmationDate = new Date();
    
    await equipment.save();
    
    res.json({ 
      message: 'Oprema je uspešno potvrđena',
      equipment: equipment
    });
  } catch (error) {
    console.error('Greška pri potvrđivanju opreme:', error);
    res.status(500).json({ error: 'Greška pri potvrđivanju opreme' });
  }
});

// POST - Odbaci opremu
router.post('/:id/equipment/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { equipmentId, reason } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(equipmentId)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ error: 'Razlog odbijanja je obavezan' });
    }
    
    const equipment = await Equipment.findOne({
      _id: equipmentId,
      assignedTo: id,
      awaitingConfirmation: true,
      confirmationStatus: 'pending'
    });
    
    if (!equipment) {
      return res.status(404).json({ error: 'Oprema nije pronađena ili ne čeka potvrdu' });
    }
    
    // Odbaci opremu - vrati u magacin
    equipment.awaitingConfirmation = false;
    equipment.confirmationStatus = 'rejected';
    equipment.status = 'available';
    equipment.location = 'magacin';
    equipment.assignedTo = null;
    equipment.rejectionReason = reason.trim();
    equipment.confirmationDate = new Date();
    
    await equipment.save();
    
    res.json({ 
      message: 'Oprema je uspešno odbijena i vraćena u magacin',
      equipment: equipment
    });
  } catch (error) {
    console.error('Greška pri odbijanju opreme:', error);
    res.status(500).json({ error: 'Greška pri odbijanju opreme' });
  }
});

// Multer konfiguracija za profile slike
const profileImageStorage = multer.memoryStorage();
const profileImageUpload = multer({
  storage: profileImageStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Samo slike su dozvoljene'), false);
    }
  }
});

// POST - Upload profilne slike
router.post('/upload-profile-image', profileImageUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Slika nije uploadovana' });
    }

    // Upload sliku na Cloudinary sa custom transformacijom za profile
    const result = await new Promise((resolve, reject) => {
      const uploadStream = require('cloudinary').v2.uploader.upload_stream(
        {
          folder: 'profile_images',
          resource_type: 'image',
          public_id: `profile_${Date.now()}`,
          transformation: [
            {
              width: 400,
              height: 400,
              crop: 'fill',
              gravity: 'face', // Fokus na lice ako je moguće
              quality: 'auto:good',
              format: 'webp'
            }
          ]
        },
        (error, result) => {
          if (error) {
            console.error('Cloudinary upload greška:', error);
            reject(error);
          } else {
            console.log('Cloudinary upload uspešan:', result.secure_url);
            resolve(result);
          }
        }
      );
      
      uploadStream.end(req.file.buffer);
    });

    res.json({
      url: result.secure_url,
      publicId: result.public_id
    });
  } catch (error) {
    console.error('Greška pri upload-u profilne slike:', error);
    res.status(500).json({ error: 'Greška pri upload-u profilne slike' });
  }
});

module.exports = router;