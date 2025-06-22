const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const techniciansFilePath = path.join(__dirname, '../data/technicians.json');
const equipmentFilePath = path.join(__dirname, '../data/equipment.json');
const materialsFilePath = path.join(__dirname, '../data/materials.json');

// Middleware za čitanje technicians.json fajla
const readTechniciansFile = () => {
  try {
    const data = fs.readFileSync(techniciansFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Greška pri čitanju tehničara:', error);
    return [];
  }
};

// Middleware za čuvanje technicians.json fajla
const saveTechniciansFile = (data) => {
  try {
    fs.writeFileSync(techniciansFilePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Greška pri čuvanju tehničara:', error);
    return false;
  }
};

// Middleware za čitanje equipment.json fajla
const readEquipmentFile = () => {
  try {
    const data = fs.readFileSync(equipmentFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Greška pri čitanju opreme:', error);
    return [];
  }
};

// Middleware za čuvanje equipment.json fajla
const saveEquipmentFile = (data) => {
  try {
    fs.writeFileSync(equipmentFilePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Greška pri čuvanju opreme:', error);
    return false;
  }
};

// Middleware za čitanje materials.json fajla
const readMaterialsFile = () => {
  try {
    const data = fs.readFileSync(materialsFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Greška pri čitanju materijala:', error);
    return [];
  }
};

// Middleware za čuvanje materials.json fajla
const saveMaterialsFile = (data) => {
  try {
    fs.writeFileSync(materialsFilePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Greška pri čuvanju materijala:', error);
    return false;
  }
};

// GET - Dohvati sve tehničare
router.get('/', (req, res) => {
  const technicians = readTechniciansFile();
  
  // Ne vraćamo lozinke
  const techniciansWithoutPasswords = technicians.map(tech => {
    const { password, ...techWithoutPassword } = tech;
    return techWithoutPassword;
  });
  
  res.json(techniciansWithoutPasswords);
});

// GET - Dohvati tehničara po ID
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const technicians = readTechniciansFile();
  const technician = technicians.find(tech => tech.id === id);
  
  if (!technician) {
    return res.status(404).json({ error: 'Tehničar nije pronađen' });
  }
  
  // Ne vraćamo lozinku
  const { password, ...technicianWithoutPassword } = technician;
  
    // Dohvatanje opreme zadužene kod tehničara
  const equipment = readEquipmentFile().filter(
    item => item.location === `tehnicar-${id}`
  );
  
  // Dohvatanje materijala zaduženih kod tehničara
  const allMaterials = readMaterialsFile();
  
  const technicianMaterials = technician.materials || [];
  
  const materialsWithDetails = technicianMaterials.map(materialItem => {
    const materialDetails = allMaterials.find(m => m.id === materialItem.materialId);
    return {
      id: materialItem.materialId,
      type: materialDetails ? materialDetails.type : 'Nepoznato',
      quantity: materialItem.quantity
    };
  });
  
  res.json({
    ...technicianWithoutPassword,
    equipment,
    materials: materialsWithDetails
  });
});

// POST - Kreiraj novog tehničara
router.post('/', async (req, res) => {
  const { name, password } = req.body;
  
  if (!name || !password) {
    return res.status(400).json({ error: 'Ime i lozinka su obavezna polja' });
  }
  
  const technicians = readTechniciansFile();
  
  // Provera da li tehničar sa istim imenom već postoji
  const existingTechnician = technicians.find(
    tech => tech.name.toLowerCase() === name.toLowerCase()
  );
  
  if (existingTechnician) {
    return res.status(400).json({ error: 'Tehničar sa ovim imenom već postoji' });
  }
  
  // Heširanje lozinke
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);
  
  const newTechnician = {
    id: Date.now().toString(),
    name,
    password: hashedPassword,
    materials: [],
    createdAt: new Date().toISOString()
  };
  
  technicians.push(newTechnician);
  saveTechniciansFile(technicians);
  
  // Ne vraćamo lozinku u odgovoru
  const { password: _, ...technicianWithoutPassword } = newTechnician;
  
  res.status(201).json(technicianWithoutPassword);
});

// PUT - Ažuriranje tehničara
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, password } = req.body;
  
  const technicians = readTechniciansFile();
  const index = technicians.findIndex(tech => tech.id === id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Tehničar nije pronađen' });
  }
  
  // Ako se menja ime, proveriti da li već postoji tehničar sa tim imenom
  if (name && name !== technicians[index].name) {
    const existingTechnician = technicians.find(
      tech => tech.id !== id && tech.name.toLowerCase() === name.toLowerCase()
    );
    
    if (existingTechnician) {
      return res.status(400).json({ error: 'Tehničar sa ovim imenom već postoji' });
    }
  }
  
  let hashedPassword = technicians[index].password;
  
  // Ako se menja lozinka, heširati novu
  if (password) {
    const salt = await bcrypt.genSalt(10);
    hashedPassword = await bcrypt.hash(password, salt);
  }
  
  technicians[index] = {
    ...technicians[index],
    name: name || technicians[index].name,
    password: hashedPassword,
    updatedAt: new Date().toISOString()
  };
  
  saveTechniciansFile(technicians);
  
  // Ne vraćamo lozinku u odgovoru
  const { password: _, ...technicianWithoutPassword } = technicians[index];
  
  res.json(technicianWithoutPassword);
});

// DELETE - Brisanje tehničara
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const technicians = readTechniciansFile();
  
  const technician = technicians.find(tech => tech.id === id);
  if (!technician) {
    return res.status(404).json({ error: 'Tehničar nije pronađen' });
  }
  
  // Provera da li tehničar ima zaduženu opremu ili materijal
  const hasEquipment = readEquipmentFile().some(
    item => item.location === `tehnicar-${id}`
  );
  
  if (hasEquipment) {
    return res.status(400).json({ 
      error: 'Nije moguće obrisati tehničara koji ima zaduženu opremu. Prvo razdužite svu opremu.' 
    });
  }
  
  if (technician.materials && technician.materials.length > 0) {
    return res.status(400).json({ 
      error: 'Nije moguće obrisati tehničara koji ima zadužene materijale. Prvo razdužite sve materijale.' 
    });
  }
  
  const updatedTechnicians = technicians.filter(tech => tech.id !== id);
  saveTechniciansFile(updatedTechnicians);
  
  res.json({ message: 'Tehničar uspešno obrisan' });
});

// POST - Zaduži materijal tehničaru
router.post('/:id/materials', (req, res) => {
  const { id } = req.params;
  const { materialId, quantity } = req.body;
  
  if (!materialId || !quantity || parseInt(quantity, 10) <= 0) {
    return res.status(400).json({ error: 'ID materijala i količina su obavezna polja' });
  }
  
  const technicians = readTechniciansFile();
  const technicianIndex = technicians.findIndex(tech => tech.id === id);
  
  if (technicianIndex === -1) {
    return res.status(404).json({ error: 'Tehničar nije pronađen' });
  }
  
  const materials = readMaterialsFile();
  const materialIndex = materials.findIndex(material => material.id === materialId);
  
  if (materialIndex === -1) {
    return res.status(404).json({ error: 'Materijal nije pronađen' });
  }
  
  // Provera da li ima dovoljno materijala
  const requestedQuantity = parseInt(quantity, 10);
  if (materials[materialIndex].quantity < requestedQuantity) {
    return res.status(400).json({ 
      error: `Nema dovoljno materijala. Dostupno: ${materials[materialIndex].quantity}` 
    });
  }
  
  // Ažuriranje materijala kod tehničara
  const technicianMaterials = technicians[technicianIndex].materials || [];
  const existingMaterialIndex = technicianMaterials.findIndex(m => m.materialId === materialId);
  
  if (existingMaterialIndex !== -1) {
    // Dodavanje na postojeću količinu
    technicianMaterials[existingMaterialIndex].quantity += requestedQuantity;
  } else {
    // Dodavanje novog materijala
    technicianMaterials.push({
      materialId,
      quantity: requestedQuantity
    });
  }
  
  technicians[technicianIndex].materials = technicianMaterials;
  
    // Umanjivanje količine u centralnom magacinu
  materials[materialIndex].quantity -= requestedQuantity;
  
  // Sačuvaj promene
  saveTechniciansFile(technicians);
  saveMaterialsFile(materials);
  
  res.json({
    message: `${requestedQuantity} komada materijala ${materials[materialIndex].type} uspešno zaduženo tehničaru`,
    technician: {
      id: technicians[technicianIndex].id,
      name: technicians[technicianIndex].name,
      materials: technicians[technicianIndex].materials
    }
  });
});

// POST - Razduži materijal tehničaru
router.post('/:id/materials/return', (req, res) => {
  const { id } = req.params;
  const { materialId, quantity } = req.body;
  
  if (!materialId || !quantity || parseInt(quantity, 10) <= 0) {
    return res.status(400).json({ error: 'ID materijala i količina su obavezna polja' });
  }
  
  const technicians = readTechniciansFile();
  const technicianIndex = technicians.findIndex(tech => tech.id === id);
  
  if (technicianIndex === -1) {
    return res.status(404).json({ error: 'Tehničar nije pronađen' });
  }
  
  const materials = readMaterialsFile();
  const materialIndex = materials.findIndex(material => material.id === materialId);
  
  if (materialIndex === -1) {
    return res.status(404).json({ error: 'Materijal nije pronađen' });
  }
  
  // Provera da li tehničar ima zadužen taj materijal
  const technicianMaterials = technicians[technicianIndex].materials || [];
  const techMaterialIndex = technicianMaterials.findIndex(m => m.materialId === materialId);
  
  if (techMaterialIndex === -1) {
    return res.status(400).json({ error: 'Tehničar nema zadužen ovaj materijal' });
  }
  
  const returnQuantity = parseInt(quantity, 10);
  
  // Provera da li tehničar ima dovoljno materijala za razduženje
  if (technicianMaterials[techMaterialIndex].quantity < returnQuantity) {
    return res.status(400).json({ 
      error: `Tehničar nema dovoljno materijala. Zaduženo: ${technicianMaterials[techMaterialIndex].quantity}` 
    });
  }
  
  // Umanjivanje količine kod tehničara
  technicianMaterials[techMaterialIndex].quantity -= returnQuantity;
  
  // Ako je količina 0, ukloni materijal iz liste
  if (technicianMaterials[techMaterialIndex].quantity === 0) {
    technicians[technicianIndex].materials = technicianMaterials.filter(m => m.materialId !== materialId);
  } else {
    technicians[technicianIndex].materials = technicianMaterials;
  }
  
  // Uvećavanje količine u centralnom magacinu
  materials[materialIndex].quantity += returnQuantity;
  
  // Sačuvaj promene
  saveTechniciansFile(technicians);
  saveMaterialsFile(materials);
  
  res.json({
    message: `${returnQuantity} komada materijala ${materials[materialIndex].type} uspešno razduženo`,
    technician: {
      id: technicians[technicianIndex].id,
      name: technicians[technicianIndex].name,
      materials: technicians[technicianIndex].materials
    }
  });
});

// POST - Zaduži opremu tehničaru
router.post('/:id/equipment', (req, res) => {
  const { id } = req.params;
  const { serialNumbers } = req.body;
  
  if (!serialNumbers || !Array.isArray(serialNumbers) || serialNumbers.length === 0) {
    return res.status(400).json({ error: 'Lista serijskih brojeva opreme je obavezna' });
  }
  
  const technicians = readTechniciansFile();
  const technicianIndex = technicians.findIndex(tech => tech.id === id);
  
  if (technicianIndex === -1) {
    return res.status(404).json({ error: 'Tehničar nije pronađen' });
  }
  
  const equipment = readEquipmentFile();
  const invalidSerials = [];
  const successfulSerials = [];
  
  // Ažuriranje lokacije za svaki komad opreme
  serialNumbers.forEach(serialNumber => {
    const equipmentIndex = equipment.findIndex(item => item.serialNumber === serialNumber);
    
    if (equipmentIndex === -1) {
      invalidSerials.push({
        serialNumber,
        error: 'Oprema nije pronađena'
      });
      return;
    }
    
    if (equipment[equipmentIndex].location !== 'magacin') {
      invalidSerials.push({
        serialNumber,
        error: `Oprema nije u magacinu, trenutna lokacija: ${equipment[equipmentIndex].location}`
      });
      return;
    }
    
    // Ažuriranje lokacije opreme
    equipment[equipmentIndex].location = `tehnicar-${id}`;
    equipment[equipmentIndex].assignedAt = new Date().toISOString();
    successfulSerials.push(serialNumber);
  });
  
  if (successfulSerials.length > 0) {
    // Sačuvaj promene samo ako je bar jedan komad opreme uspešno zadužen
    saveEquipmentFile(equipment);
  }
  
  res.json({
    successful: successfulSerials.length,
    failed: invalidSerials.length,
    failedItems: invalidSerials,
    message: successfulSerials.length > 0 
      ? `${successfulSerials.length} komada opreme uspešno zaduženo tehničaru`
      : 'Nijedan komad opreme nije zadužen'
  });
});

// POST - Razduži opremu tehničaru
router.post('/:id/equipment/return', (req, res) => {
  const { id } = req.params;
  const { serialNumbers } = req.body;
  
  if (!serialNumbers || !Array.isArray(serialNumbers) || serialNumbers.length === 0) {
    return res.status(400).json({ error: 'Lista serijskih brojeva opreme je obavezna' });
  }
  
  const technicians = readTechniciansFile();
  const technicianIndex = technicians.findIndex(tech => tech.id === id);
  
  if (technicianIndex === -1) {
    return res.status(404).json({ error: 'Tehničar nije pronađen' });
  }
  
  const equipment = readEquipmentFile();
  const invalidSerials = [];
  const successfulSerials = [];
  
  // Ažuriranje lokacije za svaki komad opreme
  serialNumbers.forEach(serialNumber => {
    const equipmentIndex = equipment.findIndex(item => item.serialNumber === serialNumber);
    
    if (equipmentIndex === -1) {
      invalidSerials.push({
        serialNumber,
        error: 'Oprema nije pronađena'
      });
      return;
    }
    
    if (equipment[equipmentIndex].location !== `tehnicar-${id}`) {
      invalidSerials.push({
        serialNumber,
        error: `Oprema nije zadužena kod ovog tehničara, trenutna lokacija: ${equipment[equipmentIndex].location}`
      });
      return;
    }
    
        // Ažuriranje lokacije opreme
    equipment[equipmentIndex].location = 'magacin';
    equipment[equipmentIndex].returnedAt = new Date().toISOString();
    successfulSerials.push(serialNumber);
  });
  
  if (successfulSerials.length > 0) {
    // Sačuvaj promene samo ako je bar jedan komad opreme uspešno razdužen
    saveEquipmentFile(equipment);
  }
  
  res.json({
    successful: successfulSerials.length,
    failed: invalidSerials.length,
    failedItems: invalidSerials,
    message: successfulSerials.length > 0 
      ? `${successfulSerials.length} komada opreme uspešno razduženo`
      : 'Nijedan komad opreme nije razdužen'
  });
});

// GET - Dohvati opremu tehničara
router.get('/:id/equipment', (req, res) => {
  const { id } = req.params;
  const technicians = readTechniciansFile();
  const allEquipment = readEquipmentFile();
  
  const technician = technicians.find(tech => tech.id === id);
  
  if (!technician) {
    return res.status(404).json({ error: 'Tehničar nije pronađen' });
  }
  
  // Naći svu opremu koja pripada tehničaru (lokacija = tehnicar-{id})
  const technicianEquipment = allEquipment.filter(item => 
    item.location === `tehnicar-${id}` && item.status === 'available'
  );
  
  res.json(technicianEquipment);
});

// GET - Pregled zaduženih materijala tehničara
router.get('/:id/materials', (req, res) => {
  const { id } = req.params;
  
  const technicians = readTechniciansFile();
  const technician = technicians.find(tech => tech.id === id);
  
  if (!technician) {
    return res.status(404).json({ error: 'Tehničar nije pronađen' });
  }
  
  const allMaterials = readMaterialsFile();
  const technicianMaterials = technician.materials || [];
  
  const materialsWithDetails = technicianMaterials.map(materialItem => {
    const materialDetails = allMaterials.find(m => m.id === materialItem.materialId);
    return {
      id: materialItem.materialId,
      type: materialDetails ? materialDetails.type : 'Nepoznato',
      quantity: materialItem.quantity
    };
  });
  
  res.json(materialsWithDetails);
});

router.put('/:id/change-password', async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  
  if (!password) {
    return res.status(400).json({ error: 'Lozinka je obavezna!' });
  }
  
  const technicians = readTechniciansFile();
  const index = technicians.findIndex(tech => tech.id === id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Tehničar nije pronađen' });
  }
  
  // Heshiranje nove lozinke
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);
  
  // Ažuriranje lozinke tehničara
  technicians[index] = {
    ...technicians[index],
    password: hashedPassword,
    updatedAt: new Date().toISOString()
  };
  
  saveTechniciansFile(technicians);
  
  // Ne vraćamo lozinku u odgovoru
  const { password: _, ...technicianWithoutPassword } = technicians[index];
  
  res.json({
    message: 'Lozinka je uspešno promenjena',
    technician: technicianWithoutPassword
  });
});

// POST - Login za tehničara
router.post('/login', async (req, res) => {
  const { name, password } = req.body;
  
  if (!name || !password) {
    return res.status(400).json({ error: 'Korisničko ime i lozinka su obavezni' });
  }
  
  const technicians = readTechniciansFile();
  const technician = technicians.find(tech => tech.name.toLowerCase() === name.toLowerCase());
  
  if (!technician) {
    return res.status(401).json({ error: 'Neispravno korisničko ime ili lozinka' });
  }
  
  // Provera lozinke
  const validPassword = await bcrypt.compare(password, technician.password);
  if (!validPassword) {
    return res.status(401).json({ error: 'Neispravno korisničko ime ili lozinka' });
  }
  
  // Ne vraćamo lozinku
  const { password: _, ...technicianWithoutPassword } = technician;
  
  res.json({
    message: 'Uspešno prijavljivanje',
    technician: technicianWithoutPassword
  });
});

module.exports = router;