// Fajl za: server/routes/userEquipment.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const userEquipmentFilePath = path.join(__dirname, '../data/userEquipment.json');
const equipmentFilePath = path.join(__dirname, '../data/equipment.json');
const techniciansFilePath = path.join(__dirname, '../data/technicians.json');

// Pomoćne funkcije za rad sa fajlovima
const readUserEquipmentFile = () => {
  try {
    if (fs.existsSync(userEquipmentFilePath)) {
      const data = fs.readFileSync(userEquipmentFilePath, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('Greška pri čitanju korisničke opreme:', error);
    return [];
  }
};

const saveUserEquipmentFile = (data) => {
  try {
    fs.writeFileSync(userEquipmentFilePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Greška pri čuvanju korisničke opreme:', error);
    return false;
  }
};

const readEquipmentFile = () => {
  try {
    const data = fs.readFileSync(equipmentFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Greška pri čitanju opreme:', error);
    return [];
  }
};

const readTechniciansFile = () => {
  try {
    const data = fs.readFileSync(techniciansFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Greška pri čitanju tehničara:', error);
    return [];
  }
};

const saveTechniciansFile = (data) => {
  try {
    fs.writeFileSync(techniciansFilePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Greška pri čuvanju tehničara:', error);
    return false;
  }
};

const saveEquipmentFile = (data) => {
  try {
    fs.writeFileSync(equipmentFilePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Greška pri čuvanju opreme:', error);
    return false;
  }
};

// GET - Dohvati svu opremu kod korisnika
router.get('/', (req, res) => {
  const userEquipment = readUserEquipmentFile();
  res.json(userEquipment);
});

// GET - Dohvati opremu po ID korisnika
router.get('/user/:userId', (req, res) => {
  const { userId } = req.params;
  const userEquipment = readUserEquipmentFile();
  
  const userItems = userEquipment.filter(item => item.userId === userId && item.status === 'active');
  
  res.json(userItems);
});

// GET - Dohvati istoriju opreme po ID korisnika
router.get('/user/:userId/history', (req, res) => {
  const { userId } = req.params;
  const userEquipment = readUserEquipmentFile();
  
  const history = userEquipment.filter(item => item.userId === userId);
  
  res.json(history);
});

// POST - Dodaj novu opremu korisniku
router.post('/', (req, res) => {
  const { userId, equipmentId, workOrderId, technicianId } = req.body;
  
  if (!userId || !equipmentId || !workOrderId || !technicianId) {
    return res.status(400).json({ error: 'Nedostaju obavezni podaci' });
  }
  
  const userEquipment = readUserEquipmentFile();
  const allEquipment = readEquipmentFile();
  const technicians = readTechniciansFile();
  
  // Provera da li oprema postoji
  const equipment = allEquipment.find(item => item.id === equipmentId);
  if (!equipment) {
    return res.status(400).json({ error: 'Oprema nije pronađena' });
  }
  
  // MODIFIKOVANI KOD: Provera da li je oprema dostupna tehničaru
  // 1. Prvo proveravamo da li je oprema već kod nekog korisnika
  if (equipment.location && equipment.location.startsWith('user-')) {
    return res.status(400).json({ error: 'Oprema je već dodeljena drugom korisniku' });
  }
  
  // 2. Proveravamo da li je oprema kod tehničara
  // Oprema mora biti u lokaciji "tehnicar-{technicianId}" ili kod magacina
  if (equipment.location !== `tehnicar-${technicianId}` && equipment.location !== 'magacin') {
    return res.status(400).json({ error: 'Tehničar nema traženu opremu u inventaru' });
  }
  
  // Ne proveravamo više equipment u technicians[technicianIndex].equipment jer to nije pouzdan način

  // Kreiraj novi zapis o opremi korisnika
  const newUserEquipment = {
    id: Date.now().toString(),
    userId,
    equipmentId,
    equipmentType: equipment.category,
    equipmentDescription: equipment.description,
    serialNumber: equipment.serialNumber,
    installedAt: new Date().toISOString(),
    workOrderId,
    technicianId,
    status: 'active',
    condition: 'unused'
  };
  
  userEquipment.push(newUserEquipment);
  
  // Ažuriraj lokaciju opreme
  const equipmentIndex = allEquipment.findIndex(item => item.id === equipmentId);
  if (equipmentIndex !== -1) {
    allEquipment[equipmentIndex].location = `user-${userId}`;
    allEquipment[equipmentIndex].status = 'in-use';
  }
  
  // Sačuvaj promene
  saveUserEquipmentFile(userEquipment);
  saveEquipmentFile(allEquipment);
  
  res.status(201).json(newUserEquipment);
});

// PUT - Ukloni opremu od korisnika
// PUT - Ukloni opremu od korisnika
router.put('/:id/remove', (req, res) => {
  const { id } = req.params;
  const { workOrderId, technicianId, isWorking, removalReason } = req.body;
  
  if (!workOrderId || !technicianId) {
    return res.status(400).json({ error: 'Nedostaju obavezni podaci' });
  }
  
  const userEquipment = readUserEquipmentFile();
  const allEquipment = readEquipmentFile();
  const technicians = readTechniciansFile();
  
  // Pronađi zapis o opremi korisnika
  const index = userEquipment.findIndex(item => item.id === id && item.status === 'active');
  if (index === -1) {
    return res.status(404).json({ error: 'Oprema kod korisnika nije pronađena ili je već uklonjena' });
  }
  
  // Ažuriraj zapis
  userEquipment[index].status = 'removed';
  userEquipment[index].removedAt = new Date().toISOString();
  userEquipment[index].removalWorkOrderId = workOrderId;
  userEquipment[index].removalTechnicianId = technicianId;
  userEquipment[index].condition = isWorking ? 'working' : 'defective';
  userEquipment[index].removalReason = removalReason || '';
  
  // Ažuriraj lokaciju opreme
  const equipmentId = userEquipment[index].equipmentId;
  const equipmentIndex = allEquipment.findIndex(item => item.id === equipmentId);
  
  if (equipmentIndex !== -1) {
    if (isWorking) {
      // Ako je oprema ispravna, vrati je tehničaru
      allEquipment[equipmentIndex].location = `tehnicar-${technicianId}`;
      allEquipment[equipmentIndex].status = 'available';
      
      // Dodaj opremu u inventar tehničara
      const technicianIndex = technicians.findIndex(tech => tech.id === technicianId);
      if (technicianIndex !== -1) {
        if (!technicians[technicianIndex].equipment) {
          technicians[technicianIndex].equipment = [];
        }
        
        const existingEquipment = technicians[technicianIndex].equipment.find(
          item => item.equipmentId === equipmentId
        );
        
        if (existingEquipment) {
          existingEquipment.quantity += 1;
        } else {
          technicians[technicianIndex].equipment.push({
            equipmentId,
            quantity: 1
          });
        }
        
        saveTechniciansFile(technicians);
      }
    } else {
      // Ako je oprema neispravna, označi je kao takvu
      allEquipment[equipmentIndex].location = 'defective';
      allEquipment[equipmentIndex].status = 'defective';
    }
  }
  
  // Sačuvaj promene
  saveUserEquipmentFile(userEquipment);
  saveEquipmentFile(allEquipment);
  
  res.json(userEquipment[index]);
});

// GET - Dohvati opremu po radnom nalogu
router.get('/workorder/:workOrderId', (req, res) => {
  const { workOrderId } = req.params;
  const userEquipment = readUserEquipmentFile();
  
  const equipment = userEquipment.filter(
    item => item.workOrderId === workOrderId || item.removalWorkOrderId === workOrderId
  );
  
  res.json(equipment);
});

module.exports = router;