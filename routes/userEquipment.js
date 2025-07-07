// Fajl za: server/routes/userEquipment.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Equipment = require('../models/Equipment');
const WorkOrder = require('../models/WorkOrder');
const WorkOrderEvidence = require('../models/WorkOrderEvidence');
const Technician = require('../models/Technician');
const { logEquipmentAdded, logEquipmentRemoved } = require('../utils/logger');

// Mapiranje kategorija opreme na validne enum vrednosti
function mapEquipmentTypeToEnum(category) {
  const categoryLower = (category || '').toLowerCase().trim();
  
  // Mapiranje postojećih kategorija na enum vrednosti
  const mapping = {
    'ont': 'ONT/HFC',
    'hfc': 'ONT/HFC',
    'ont/hfc': 'ONT/HFC',
    'hybrid': 'Hybrid',
    'stb': 'STB/CAM',
    'cam': 'STB/CAM',
    'stb/cam': 'STB/CAM',
    'kartica': 'Kartica',
    'mini node': 'Mini node',
    'mininode': 'Mini node',
    'modem': 'ONT/HFC',
    'router': 'Hybrid',
    'telefon': 'STB/CAM',
    'tv': 'STB/CAM',
    'decoder': 'STB/CAM'
  };
  
  // Pokušaj direktno mapiranje
  if (mapping[categoryLower]) {
    return mapping[categoryLower];
  }
  
  // Pokušaj pattern matching
  if (categoryLower.includes('ont') || categoryLower.includes('hfc') || categoryLower.includes('modem')) {
    return 'ONT/HFC';
  }
  if (categoryLower.includes('hybrid') || categoryLower.includes('router')) {
    return 'Hybrid';
  }
  if (categoryLower.includes('stb') || categoryLower.includes('cam') || categoryLower.includes('tv') || categoryLower.includes('decoder')) {
    return 'STB/CAM';
  }
  if (categoryLower.includes('kartica') || categoryLower.includes('card')) {
    return 'Kartica';
  }
  if (categoryLower.includes('mini') || categoryLower.includes('node')) {
    return 'Mini node';
  }
  
  // Default fallback
  return 'ONT/HFC';
}

// GET - Dohvati svu opremu kod korisnika
router.get('/', async (req, res) => {
  try {
    console.log('Fetching all installed user equipment');
    
    // Tražimo opremu gde location počinje sa "user-"
    const equipment = await Equipment.find({ 
      location: { $regex: /^user-/ },
      status: 'installed'
    }).sort({ updatedAt: -1 });
    
    console.log(`Found ${equipment.length} equipment items installed at users`);
    
    // Formatiraj podatke za frontend
    const formattedEquipment = equipment.map(eq => {
      // Izvuci ID korisnika iz location polja (format: "user-ID")
      const userTisId = eq.location.startsWith('user-') ? eq.location.substring(5) : null;
      
      return {
        _id: eq._id,
        id: eq._id,
        category: eq.category,
        equipmentType: eq.category,
        description: eq.description,
        equipmentDescription: eq.description,
        serialNumber: eq.serialNumber,
        status: eq.status,
        userTisId: userTisId, // Dodaj tisId korisnika
        installedAt: eq.installedAt || eq.createdAt,
        location: eq.location
      };
    });
    
    res.json(formattedEquipment);
  } catch (error) {
    console.error('Greška pri dohvatanju opreme:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju opreme' });
  }
});

// GET - Dohvati opremu po ID korisnika
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log('Fetching equipment for user ID:', userId);
    
    // Prvo probamo da nađemo korisnika po MongoDB ID-u
    let user = null;
    if (mongoose.Types.ObjectId.isValid(userId)) {
      user = await mongoose.model('User').findById(userId);
    }
    
    // Ako nismo našli korisnika po MongoDB ID-u, probamo po tisId
    if (!user) {
      user = await mongoose.model('User').findOne({ tisId: userId });
    }
    
    if (!user) {
      console.log(`User not found with ID: ${userId}`);
      return res.json([]);
    }
    
    console.log(`Found user: ${user.name}, tisId: ${user.tisId}`);
    
    // Tražimo opremu gde je location = "user-tisId"
    const equipment = await Equipment.find({ 
      location: `user-${user.tisId}`,
      status: 'installed'
    });
    
    console.log(`Found ${equipment.length} equipment items for user ${user.name} (tisId: ${user.tisId})`);
    
    // Formatiraj podatke za frontend
    const formattedEquipment = equipment.map(eq => ({
      _id: eq._id,
      id: eq._id,
      equipmentType: eq.category,
      category: eq.category,
      equipmentDescription: eq.description,
      description: eq.description,
      serialNumber: eq.serialNumber,
      status: eq.status,
      userId: user._id, // MongoDB ID korisnika
      userTisId: user.tisId, // TIS ID korisnika
      userName: user.name, // Ime korisnika
      installedAt: eq.installedAt || eq.createdAt,
      location: eq.location
    }));
    
    res.json(formattedEquipment);
  } catch (error) {
    console.error('Greška pri dohvatanju opreme korisnika:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju opreme korisnika' });
  }
});

// GET - Dohvati istoriju opreme po ID korisnika
router.get('/user/:userId/history', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Dohvati opremu koja je trenutno ili bila dodeljena korisniku
    const equipment = await Equipment.find({
      $or: [
        { assignedToUser: userId },
        { location: `user-${userId}` }
      ]
    }).sort({ updatedAt: -1 });
    
    // Formatiraj podatke za frontend
    const formattedEquipment = equipment.map(eq => ({
      id: eq._id,
      equipmentType: eq.category,  // Mapiranje category -> equipmentType
      equipmentDescription: eq.description,  // Mapiranje description -> equipmentDescription
      serialNumber: eq.serialNumber,
      status: eq.assignedToUser ? 'active' : 'removed',  // Mapiranje statusa
      installedAt: eq.installedAt || eq.createdAt,  // Koristimo installedAt ili createdAt kao fallback
      removedAt: eq.removedAt,  // Koristimo removedAt polje
      condition: eq.status === 'defective' ? 'defective' : 'working',  // Stanje opreme
      location: eq.location,
      originalStatus: eq.status  // Zadrži originalni status za debug
    }));
    
    res.json(formattedEquipment);
  } catch (error) {
    console.error('Greška pri dohvatanju istorije opreme korisnika:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju istorije opreme korisnika' });
  }
});

// POST - Dodaj novu opremu korisniku
router.post('/', async (req, res) => {
  console.log('Received request to add equipment:', req.body);
  const { userId, equipmentId, workOrderId, technicianId } = req.body;
  
  if (!userId || !equipmentId || !workOrderId || !technicianId) {
    console.error('Missing required data:', { userId, equipmentId, workOrderId, technicianId });
    return res.status(400).json({ error: 'Nedostaju obavezni podaci' });
  }

  try {
    // Provera da li oprema postoji
    const equipment = await Equipment.findById(equipmentId);
    console.log('Found equipment:', equipment);
    
    if (!equipment) {
      console.error('Equipment not found with ID:', equipmentId);
      return res.status(400).json({ error: 'Oprema nije pronađena' });
    }

    // Provera da li je oprema već dodeljena nekom korisniku
    if (equipment.assignedToUser) {
      console.error('Equipment already assigned to user:', equipment.assignedToUser);
      return res.status(400).json({ error: 'Oprema je već dodeljena drugom korisniku' });
    }

    // Provera da li je oprema kod tehničara ili u magacinu
    const expectedLocation = `tehnicar-${technicianId}`;
    console.log('Checking equipment location:', equipment.location, 'Expected:', expectedLocation);
    
    if (equipment.location !== expectedLocation && equipment.location !== 'magacin') {
      console.error('Equipment not available to technician. Current location:', equipment.location);
      return res.status(400).json({ error: 'Tehničar nema traženu opremu u inventaru' });
    }

    // Ažuriraj opremu - dodeli korisniku ali OSTAVI kod tehničara
    equipment.assignedToUser = userId;
    equipment.location = `user-${userId}`;
    equipment.status = 'installed'; // Promena statusa na 'installed' umesto 'assigned'
    equipment.installedAt = new Date(); // Dodaj datum instalacije
    // NAPOMENA: equipment.assignedTo ostaje isti (tehničar i dalje "drži" opremu)
    
    await equipment.save();
    console.log('Equipment updated successfully');

    // Ažuriraj radni nalog sa informacijom o instaliranoj opremi
    const workOrder = await WorkOrder.findById(workOrderId);
    if (!workOrder) {
      console.error('Work order not found with ID:', workOrderId);
      return res.status(400).json({ error: 'Radni nalog nije pronađen' });
    }
    
    // Inicijalizuj installedEquipment ako ne postoji
    if (!workOrder.installedEquipment) {
      workOrder.installedEquipment = [];
    }
    
    // Dodaj opremu u installedEquipment polje
    workOrder.installedEquipment.push({
      equipmentId: equipment._id,
      installedAt: new Date(),
      technicianId
    });
    
    // Dodaj opremu i u equipment polje (za kompatibilnost)
    if (!workOrder.equipment) {
      workOrder.equipment = [];
    }
    
    // Proveri da li oprema već postoji u nizu
    const equipmentExists = workOrder.equipment.some(eq => eq.toString() === equipment._id.toString());
    if (!equipmentExists) {
      workOrder.equipment.push(equipment._id);
    }
    
    await workOrder.save();
    console.log('Work order updated with installed equipment:', workOrder);

    // Ažuriranje WorkOrderEvidence sa instaliranim uređajem
    try {
      const evidence = await WorkOrderEvidence.findOne({ workOrderId });
      if (evidence) {
        const mappedEquipmentType = mapEquipmentTypeToEnum(equipment.category);
        console.log(`Mapping equipment category '${equipment.category}' to '${mappedEquipmentType}'`);
        
        const equipmentData = {
          equipmentType: mappedEquipmentType,
          serialNumber: equipment.serialNumber || '',
          condition: equipment.status === 'defective' ? 'R' : 'N',
          installedAt: new Date(),
          notes: `Instalirano od tehničara - ${equipment.description || ''}`
        };

        console.log('Equipment data to be added:', equipmentData);
        
        // Logika za uklanjanje duplikata i premestanje između array-eva
        const serialNumber = equipmentData.serialNumber;
        
        // 1. Ukloni iz removedEquipment ako postoji (vraćamo uređaj u upotrebu)
        evidence.removedEquipment = evidence.removedEquipment.filter(
          removedEq => removedEq.serialNumber !== serialNumber
        );
        
        // 2. Proveri da li već postoji u installedEquipment i ukloni postojeći
        evidence.installedEquipment = evidence.installedEquipment.filter(
          installedEq => installedEq.serialNumber !== serialNumber
        );
        
        // 3. Dodaj novi zapis u installedEquipment
        evidence.installedEquipment.push(equipmentData);
        
        await evidence.save();
        console.log('WorkOrderEvidence updated with installed equipment - duplicates removed');
      } else {
        console.log('WorkOrderEvidence not found for workOrderId:', workOrderId);
      }
    } catch (evidenceError) {
      console.error('Greška pri ažuriranju WorkOrderEvidence:', evidenceError);
      // Ne prekidamo proces zbog greške u evidenciji
    }

    // Log equipment addition
    try {
      const technician = await Technician.findById(technicianId);
      if (technician) {
        await logEquipmentAdded(technicianId, technician.name, workOrder, equipment);
      }
    } catch (logError) {
      console.error('Greška pri logovanju dodavanja opreme:', logError);
    }

    res.status(201).json(equipment);
  } catch (error) {
    console.error('Error adding equipment:', error);
    res.status(500).json({ error: 'Greška pri dodavanju opreme' });
  }
});

// PUT - Ukloni opremu od korisnika
router.put('/:id/remove', async (req, res) => {
  const { id } = req.params;
  const { workOrderId, technicianId, isWorking, removalReason } = req.body;
  
  if (!workOrderId || !technicianId) {
    return res.status(400).json({ error: 'Nedostaju obavezni podaci' });
  }

  try {
    // Pronađi radni nalog
    const workOrder = await WorkOrder.findById(workOrderId);
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }
    
    // Pronađi opremu u installedEquipment
    let equipmentId = null;
    let installedEquipmentIndex = -1;
    
    if (workOrder.installedEquipment && workOrder.installedEquipment.length > 0) {
      installedEquipmentIndex = workOrder.installedEquipment.findIndex(
        item => item._id.toString() === id
      );
      
      if (installedEquipmentIndex !== -1) {
        equipmentId = workOrder.installedEquipment[installedEquipmentIndex].equipmentId;
      }
    }
    
    // Ako nismo našli u installedEquipment, probaj direktno sa ID-jem opreme
    if (!equipmentId) {
      equipmentId = id;
    }
    
    // Pronađi opremu
    const equipment = await Equipment.findById(equipmentId);
    if (!equipment) {
      return res.status(404).json({ error: 'Oprema nije pronađena' });
    }
    
    // Ažuriraj status opreme
    if (isWorking) {
      // Ako je oprema ispravna, vrati je tehničaru
      equipment.location = `tehnicar-${technicianId}`;
      equipment.status = 'assigned'; // Promena: 'assigned' umesto 'available' - oprema se vraća tehničaru
      equipment.assignedToUser = null; // Ukloni dodelu korisniku
      equipment.removedAt = new Date(); // Dodaj datum uklanjanja
      // NAPOMENA: equipment.assignedTo ostaje isti (tehničar i dalje drži opremu)
    } else {
      // Ako je oprema neispravna, potpuno je ukloni iz inventara
      equipment.location = 'defective';
      equipment.status = 'defective';
      equipment.assignedToUser = null;
      equipment.assignedTo = null; // Ukloni i dodelu tehničaru jer je oprema neispravna
      equipment.removedAt = new Date(); // Dodaj datum uklanjanja
    }
    
    await equipment.save();
    
    // Ažuriraj radni nalog - ukloni opremu iz installedEquipment
    if (installedEquipmentIndex !== -1) {
      workOrder.installedEquipment.splice(installedEquipmentIndex, 1);
    }
    
    // Ažuriraj radni nalog - ukloni opremu iz equipment
    if (workOrder.equipment && workOrder.equipment.length > 0) {
      const equipmentIndex = workOrder.equipment.findIndex(
        eq => eq.toString() === equipmentId.toString()
      );
      
      if (equipmentIndex !== -1) {
        workOrder.equipment.splice(equipmentIndex, 1);
      }
    }
    
    await workOrder.save();
    
    // Ažuriranje WorkOrderEvidence sa uklonjenim uređajem
    try {
      const evidence = await WorkOrderEvidence.findOne({ workOrderId });
      if (evidence) {
        const mappedEquipmentType = mapEquipmentTypeToEnum(equipment.category);
        console.log(`Mapping equipment category '${equipment.category}' to '${mappedEquipmentType}' for removal`);
        
        const equipmentData = {
          equipmentType: mappedEquipmentType,
          serialNumber: equipment.serialNumber || '',
          condition: isWorking ? 'N' : 'R', // N-ispravno, R-neispravno
          removedAt: new Date(),
          reason: isWorking ? 'Zamena' : 'Kvar',
          notes: removalReason || `Uklonjeno od tehničara - ${equipment.description || ''}`
        };

        console.log('Removed equipment data to be added:', equipmentData);
        
        // Logika za uklanjanje duplikata i premestanje između array-eva
        const serialNumber = equipmentData.serialNumber;
        
        // 1. Ukloni iz installedEquipment ako postoji (premestamo uređaj u removed)
        evidence.installedEquipment = evidence.installedEquipment.filter(
          installedEq => installedEq.serialNumber !== serialNumber
        );
        
        // 2. Proveri da li već postoji u removedEquipment i ukloni postojeći
        evidence.removedEquipment = evidence.removedEquipment.filter(
          removedEq => removedEq.serialNumber !== serialNumber
        );
        
        // 3. Dodaj novi zapis u removedEquipment
        evidence.removedEquipment.push(equipmentData);
        
        await evidence.save();
        console.log('WorkOrderEvidence updated with removed equipment - duplicates removed');
      } else {
        console.log('WorkOrderEvidence not found for workOrderId:', workOrderId);
      }
    } catch (evidenceError) {
      console.error('Greška pri ažuriranju WorkOrderEvidence:', evidenceError);
      // Ne prekidamo proces zbog greške u evidenciji
    }
    
    // Log equipment removal
    try {
      const technician = await Technician.findById(technicianId);
      if (technician) {
        await logEquipmentRemoved(technicianId, technician.name, workOrder, equipment, isWorking, removalReason);
      }
    } catch (logError) {
      console.error('Greška pri logovanju uklanjanja opreme:', logError);
    }
    
    res.json({ 
      message: 'Oprema uspešno uklonjena', 
      equipment,
      isWorking,
      removalReason
    });
  } catch (error) {
    console.error('Greška pri uklanjanju opreme:', error);
    res.status(500).json({ error: 'Greška pri uklanjanju opreme' });
  }
});

// GET - Dohvati opremu po radnom nalogu
router.get('/workorder/:workOrderId', async (req, res) => {
  try {
    const { workOrderId } = req.params;
    const workOrder = await WorkOrder.findById(workOrderId);
    
    if (!workOrder) {
      return res.json([]);
    }

    const equipment = await Equipment.find({
      assignedToUser: workOrder.tisId,
      status: 'installed'
    });

    res.json(equipment);
  } catch (error) {
    console.error('Greška pri dohvatanju opreme radnog naloga:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju opreme radnog naloga' });
  }
});

module.exports = router;