const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { Equipment } = require('../models');

// Konfiguracija za multer (upload fajlova)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
        file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new Error('Samo Excel fajlovi su dozvoljeni!'), false);
    }
  }
});

// Kreiranje uploads direktorijuma ako ne postoji
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Funkcija za normalizaciju kategorija
const normalizeCategory = (category) => {
  if (!category) return '';
  
  const categoryMappings = {
    'CAM': 'cam',
    'modem': 'modem',
    'STB': 'stb',
    'fiksi telefon': 'fiksni telefon',
    'mini nod': 'mini nod',
    'hybrid': 'hybrid'
  };
  
  // Potraži direktno mapiranje
  if (categoryMappings[category]) {
    return categoryMappings[category];
  }
  
  // Potraži case-insensitive mapiranje
  const lowerCategory = category.toLowerCase();
  for (let [key, value] of Object.entries(categoryMappings)) {
    if (key.toLowerCase() === lowerCategory) {
      return value;
    }
  }
  
  // Ako nema mapiranja, vrati originalni naziv u malom slovu
  return category.toLowerCase();
};

// GET - Dohvati sve komade opreme
router.get('/', async (req, res) => {
  try {
    const equipment = await Equipment.find();
    res.json(equipment);
  } catch (error) {
    console.error('Greška pri dohvatanju opreme:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju opreme' });
  }
});

// GET - Dohvati opremu za prikaz (samo magacin i tehničari)
router.get('/display', async (req, res) => {
  try {
    // Filtriraj opremu da prikaže samo onu iz magacina i kod tehničara
    const displayEquipment = await Equipment.find({
      $or: [
        { location: 'magacin' },
        { assignedTo: { $ne: null } }
      ]
    });
    res.json(displayEquipment);
  } catch (error) {
    console.error('Greška pri dohvatanju opreme za prikaz:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju opreme za prikaz' });
  }
});

// GET - Dohvati sve kategorije opreme
router.get('/categories', async (req, res) => {
  try {
    const categories = await Equipment.distinct('category');
    res.json(categories);
  } catch (error) {
    console.error('Greška pri dohvatanju kategorija opreme:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju kategorija opreme' });
  }
});

// GET - Dohvati opremu po kategoriji
router.get('/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const filteredEquipment = await Equipment.find({ category });
    res.json(filteredEquipment);
  } catch (error) {
    console.error('Greška pri dohvatanju opreme po kategoriji:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju opreme po kategoriji' });
  }
});

// GET - Dohvati opremu po serijskom broju
router.get('/serial/:serialNumber', async (req, res) => {
  try {
    const { serialNumber } = req.params;
    
    // Traži po serijskom broju
    const item = await Equipment.findOne({ serialNumber });
    
    if (!item) {
      return res.status(404).json({ error: 'Oprema nije pronađena' });
    }
    
    res.json(item);
  } catch (error) {
    console.error('Greška pri dohvatanju opreme:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju opreme' });
  }
});

// GET - Dohvati jedan komad opreme po ID-u
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const item = await Equipment.findById(id);
    
    if (!item) {
      return res.status(404).json({ error: 'Oprema nije pronađena' });
    }
    
    res.json(item);
  } catch (error) {
    console.error('Greška pri dohvatanju opreme:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju opreme' });
  }
});

// POST - Dodaj novu opremu putem Excel fajla
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Niste priložili fajl' });
    }

    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    if (data.length === 0) {
      return res.status(400).json({ error: 'Excel fajl ne sadrži podatke' });
    }

    const newEquipmentItems = data.map(item => ({
      category: normalizeCategory(item.Kategorija || item.kategorija || ''),
      description: item.MODEL || item.Opis || '',
      serialNumber: String(item.SN || item["Fabrički broj"] || ''),
      location: 'magacin',
      status: 'available'
    }));

    // Provera da li oprema sa istim serijskim brojevima već postoji
    const filteredNewEquipment = [];
    
    for (const newItem of newEquipmentItems) {
      const existingItem = await Equipment.findOne({ serialNumber: newItem.serialNumber });
      if (!existingItem && newItem.serialNumber) {
        filteredNewEquipment.push(newItem);
      }
    }

    // Dodavanje nove opreme u bazu
    if (filteredNewEquipment.length > 0) {
      await Equipment.insertMany(filteredNewEquipment);
    }

    // Brisanje privremenog fajla
    fs.unlinkSync(req.file.path);
    
    res.status(201).json({
      message: `Uspešno dodato ${filteredNewEquipment.length} komada opreme`,
      ignoredItems: newEquipmentItems.length - filteredNewEquipment.length
    });
  } catch (error) {
    console.error('Greška pri učitavanju Excel fajla:', error);
    res.status(500).json({ error: 'Greška pri učitavanju Excel fajla' });
  }
});

// POST - Dodaj pojedinačnu opremu
router.post('/', async (req, res) => {
  try {
    const equipmentData = req.body;
    
    // Validacija podataka
    if (!equipmentData.category || !equipmentData.description || !equipmentData.serialNumber) {
      return res.status(400).json({ error: 'Nedostaju obavezni podaci' });
    }
    
    // Provera da li već postoji oprema sa istim serijskim brojem
    const existingEquipment = await Equipment.findOne({ serialNumber: equipmentData.serialNumber });
    if (existingEquipment) {
      return res.status(400).json({ error: 'Oprema sa istim serijskim brojem već postoji' });
    }
    
    const newEquipment = new Equipment({
      category: equipmentData.category,
      description: equipmentData.description,
      serialNumber: equipmentData.serialNumber,
      location: equipmentData.location || 'magacin',
      status: equipmentData.status || 'available'
    });
    
    const savedEquipment = await newEquipment.save();
    res.status(201).json(savedEquipment);
  } catch (error) {
    console.error('Greška pri dodavanju opreme:', error);
    res.status(500).json({ error: 'Greška pri dodavanju opreme' });
  }
});

// PUT - Ažuriranje opreme
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const equipment = await Equipment.findById(id);
    
    if (!equipment) {
      return res.status(404).json({ error: 'Oprema nije pronađena' });
    }
    
    // Provera da li drugi komad opreme već koristi ovaj serijski broj
    if (updateData.serialNumber && updateData.serialNumber !== equipment.serialNumber) {
      const duplicateSerial = await Equipment.findOne({ 
        _id: { $ne: id },
        serialNumber: updateData.serialNumber
      });
      
      if (duplicateSerial) {
        return res.status(400).json({ error: 'Oprema sa ovim serijskim brojem već postoji' });
      }
    }
    
    // Ažuriranje polja
    if (updateData.category) equipment.category = updateData.category;
    if (updateData.description) equipment.description = updateData.description;
    if (updateData.serialNumber) equipment.serialNumber = updateData.serialNumber;
    if (updateData.location) equipment.location = updateData.location;
    if (updateData.status) equipment.status = updateData.status;
    
    const updatedEquipment = await equipment.save();
    res.json(updatedEquipment);
  } catch (error) {
    console.error('Greška pri ažuriranju opreme:', error);
    res.status(500).json({ error: 'Greška pri ažuriranju opreme' });
  }
});

// DELETE - Brisanje opreme
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const deletedEquipment = await Equipment.findByIdAndDelete(id);
    
    if (!deletedEquipment) {
      return res.status(404).json({ error: 'Oprema nije pronađena' });
    }
    
    res.json({ message: 'Oprema uspešno obrisana' });
  } catch (error) {
    console.error('Greška pri brisanju opreme:', error);
    res.status(500).json({ error: 'Greška pri brisanju opreme' });
  }
});

// POST - Dodeli opremu tehničaru
router.post('/assign-to-technician/:technicianId', async (req, res) => {
  try {
    const { technicianId } = req.params;
    const { equipmentIds } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(technicianId)) {
      return res.status(400).json({ error: 'Neispravan ID tehničara' });
    }
    
    if (!equipmentIds || !Array.isArray(equipmentIds) || equipmentIds.length === 0) {
      return res.status(400).json({ error: 'Lista ID-jeva opreme je obavezna' });
    }
    
    const results = {
      successful: 0,
      failed: 0,
      failedItems: []
    };
    
    // Ažuriranje svakog komada opreme
    for (const equipmentId of equipmentIds) {
      if (!mongoose.Types.ObjectId.isValid(equipmentId)) {
        results.failed++;
        results.failedItems.push({
          id: equipmentId,
          error: 'Neispravan ID opreme'
        });
        continue;
      }
      
      const equipment = await Equipment.findById(equipmentId);
      
      if (!equipment) {
        results.failed++;
        results.failedItems.push({
          id: equipmentId,
          error: 'Oprema nije pronađena'
        });
        continue;
      }
      
      if (equipment.location !== 'magacin' || equipment.status !== 'available') {
        results.failed++;
        results.failedItems.push({
          id: equipmentId,
          error: `Oprema nije dostupna, trenutni status: ${equipment.status}, lokacija: ${equipment.location}`
        });
        continue;
      }
      
      // Ažuriranje opreme
      equipment.assignedTo = technicianId;
      equipment.location = 'tehnicar';
      equipment.status = 'assigned';
      
      await equipment.save();
      results.successful++;
    }
    
    res.json({
      message: `${results.successful} komada opreme uspešno dodeljeno tehničaru`,
      ...results
    });
  } catch (error) {
    console.error('Greška pri dodeljivanju opreme tehničaru:', error);
    res.status(500).json({ error: 'Greška pri dodeljivanju opreme tehničaru' });
  }
});

// POST - Vrati opremu u magacin
router.post('/return-to-warehouse', async (req, res) => {
  try {
    const { equipmentIds } = req.body;
    
    if (!equipmentIds || !Array.isArray(equipmentIds) || equipmentIds.length === 0) {
      return res.status(400).json({ error: 'Lista ID-jeva opreme je obavezna' });
    }
    
    const results = {
      successful: 0,
      failed: 0,
      failedItems: []
    };
    
    // Ažuriranje svakog komada opreme
    for (const equipmentId of equipmentIds) {
      if (!mongoose.Types.ObjectId.isValid(equipmentId)) {
        results.failed++;
        results.failedItems.push({
          id: equipmentId,
          error: 'Neispravan ID opreme'
        });
        continue;
      }
      
      const equipment = await Equipment.findById(equipmentId);
      
      if (!equipment) {
        results.failed++;
        results.failedItems.push({
          id: equipmentId,
          error: 'Oprema nije pronađena'
        });
        continue;
      }
      
      // Ažuriranje opreme
      equipment.assignedTo = null;
      equipment.assignedToUser = null;
      equipment.location = 'magacin';
      equipment.status = 'available';
      
      await equipment.save();
      results.successful++;
    }
    
    res.json({
      message: `${results.successful} komada opreme uspešno vraćeno u magacin`,
      ...results
    });
  } catch (error) {
    console.error('Greška pri vraćanju opreme u magacin:', error);
    res.status(500).json({ error: 'Greška pri vraćanju opreme u magacin' });
  }
});

module.exports = router;