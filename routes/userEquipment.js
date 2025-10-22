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

// GET - Dohvati svu opremu kod korisnika (optimized)
router.get('/', async (req, res) => {
  try {
    const { statsOnly } = req.query;
    console.log('Fetching all installed user equipment');

    // Za dashboard, vraćaj samo osnovne statistike
    if (statsOnly === 'true') {
      console.log('📊 Fetching user equipment stats only...');
      const startTime = Date.now();

      const stats = await Equipment.aggregate([
        {
          $match: {
            location: { $regex: /^user-/ },
            status: 'installed'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            byCategory: {
              $push: {
                category: '$category',
                count: 1
              }
            }
          }
        }
      ]);

      const result = {
        total: stats[0]?.total || 0,
        byCategory: {}
      };

      // Group by category
      if (stats[0]?.byCategory) {
        stats[0].byCategory.forEach(item => {
          if (!result.byCategory[item.category]) {
            result.byCategory[item.category] = 0;
          }
          result.byCategory[item.category]++;
        });
      }

      const endTime = Date.now();
      console.log(`📊 User equipment stats fetched in ${endTime - startTime}ms`);

      return res.json({
        success: true,
        stats: result
      });
    }

    // Tražimo opremu gde location počinje sa "user-"
    const equipment = await Equipment.find({
      location: { $regex: /^user-/ },
      status: 'installed'
    })
    .sort({ updatedAt: -1 })
    .lean(); // Performance optimization
    
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
        const serialNumber = equipment.serialNumber;

        // Ukloni opremu iz installedEquipment array-a
        evidence.installedEquipment = evidence.installedEquipment.filter(
          installedEq => installedEq.serialNumber !== serialNumber
        );
        
        await evidence.save();
        console.log('WorkOrderEvidence updated - equipment removed from installedEquipment');
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

// POST - Ukloni opremu po serijskom broju
router.post('/remove-by-serial', async (req, res) => {
  const { workOrderId, technicianId, equipmentName, equipmentDescription, serialNumber } = req.body;

  if (!workOrderId || !technicianId || !equipmentName || !equipmentDescription || !serialNumber) {
    return res.status(400).json({ error: 'Nedostaju obavezni podaci (naziv, opis, serijski broj)' });
  }

  try {
    // Pronađi radni nalog
    const workOrder = await WorkOrder.findById(workOrderId);
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }

    // Pronađi opremu po serijskom broju (samo po S/N, ne proverava lokaciju)
    const equipment = await Equipment.findOne({
      serialNumber: serialNumber
    });

    let equipmentRemoved = false;
    let equipmentDetails = null;

    if (equipment) {
      // Oprema postoji u sistemu - dodeli je tehničaru
      console.log('Found equipment in system:', equipment);

      // Automatski dodeljuje opremu tehničaru
      equipment.location = `tehnicar-${technicianId}`;
      equipment.status = 'assigned';
      equipment.assignedTo = technicianId;
      equipment.assignedToUser = null;
      equipment.removedAt = new Date();

      await equipment.save();
      equipmentRemoved = true;
      equipmentDetails = equipment;

      // Ukloni opremu iz radnog naloga
      if (workOrder.installedEquipment) {
        workOrder.installedEquipment = workOrder.installedEquipment.filter(
          item => item.equipmentId.toString() !== equipment._id.toString()
        );
      }

      if (workOrder.equipment) {
        workOrder.equipment = workOrder.equipment.filter(
          eq => eq.toString() !== equipment._id.toString()
        );
      }

      await workOrder.save();

    } else {
      console.log('Equipment not found in system - creating new equipment and assigning to technician');

      // Kreira novu opremu koja se automatski dodeljuje tehničaru
      const newEquipment = new Equipment({
        category: equipmentName,
        description: equipmentDescription,
        serialNumber: serialNumber,
        location: `tehnicar-${technicianId}`,
        status: 'assigned',
        assignedTo: technicianId,
        assignedToUser: null,
        removedAt: new Date()
      });

      await newEquipment.save();
      console.log('New equipment created and assigned to technician:', newEquipment);

      equipmentDetails = newEquipment;
      equipmentRemoved = true;
    }

    // Ažuriranje WorkOrderEvidence sa uklonjenom opremom
    try {
      const evidence = await WorkOrderEvidence.findOne({ workOrderId });
      if (evidence) {
        // Proveri da li oprema već postoji u removedEquipment
        const alreadyRemoved = evidence.removedEquipment.some(
          removedEq => removedEq.serialNumber === serialNumber
        );

        if (alreadyRemoved) {
          return res.status(400).json({ error: 'Ova oprema je već uklonjena u ovom radnom nalogu' });
        }

        const mappedEquipmentType = mapEquipmentTypeToEnum(equipmentName);

        // Ukloni iz installedEquipment ako postoji
        evidence.installedEquipment = evidence.installedEquipment.filter(
          installedEq => installedEq.serialNumber !== serialNumber
        );

        // Dodaj u removedEquipment
        const removedEquipmentData = {
          equipmentType: mappedEquipmentType,
          serialNumber: serialNumber,
          condition: 'N', // Sva oprema se automatski dodeljuje tehničaru kao 'N' (ispravna)
          removedAt: new Date(),
          notes: `Uklonjeno od tehničara - ${equipmentName}`
        };

        evidence.removedEquipment.push(removedEquipmentData);

        await evidence.save();
        console.log('WorkOrderEvidence updated with removed equipment');
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
        await logEquipmentRemoved(technicianId, technician.name, workOrder, equipmentDetails, true, `Uklonjeno po serijskom broju: ${equipmentName}`);
      }
    } catch (logError) {
      console.error('Greška pri logovanju uklanjanja opreme:', logError);
    }

    res.json({
      success: true,
      message: 'Oprema uspešno uklonjena',
      equipmentRemoved,
      equipment: equipmentDetails
    });
  } catch (error) {
    console.error('Greška pri uklanjanju opreme po serijskom broju:', error);
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

// GET - Dohvati uklonjenu opremu za radni nalog
router.get('/workorder/:workOrderId/removed', async (req, res) => {
  try {
    const { workOrderId } = req.params;

    const evidence = await WorkOrderEvidence.findOne({ workOrderId });

    if (!evidence || !evidence.removedEquipment) {
      return res.json([]);
    }

    // Formatiraj podatke za frontend
    const formattedRemovedEquipment = evidence.removedEquipment.map((eq, index) => ({
      id: `removed-${index}`,
      equipmentType: eq.equipmentType,
      serialNumber: eq.serialNumber,
      condition: eq.condition === 'N' ? 'ispravna' : 'neispravna',
      removedAt: eq.removedAt,
      notes: eq.notes
    }));

    res.json(formattedRemovedEquipment);
  } catch (error) {
    console.error('Greška pri dohvatanju uklonjene opreme:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju uklonjene opreme' });
  }
});

module.exports = router;