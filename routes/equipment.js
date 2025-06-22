const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const xlsx = require('xlsx');

const equipmentFilePath = path.join(__dirname, '../data/equipment.json');

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
router.get('/', (req, res) => {
  const equipment = readEquipmentFile();
  res.json(equipment);
});

// GET - Dohvati opremu za prikaz (samo magacin i tehničari)
router.get('/display', (req, res) => {
  const equipment = readEquipmentFile();
  // Filtriraj opremu da prikaže samo onu iz magacina i kod tehničara
  const displayEquipment = equipment.filter(item => 
    item.location === 'magacin' || item.location.startsWith('tehnicar-')
  );
  res.json(displayEquipment);
});

// GET - Dohvati sve kategorije opreme
router.get('/categories', (req, res) => {
  const equipment = readEquipmentFile();
  const categories = [...new Set(equipment.map(item => item.category))];
  res.json(categories);
});

// GET - Dohvati opremu po kategoriji
router.get('/category/:category', (req, res) => {
  const { category } = req.params;
  const equipment = readEquipmentFile();
  const filteredEquipment = equipment.filter(item => item.category === category);
  res.json(filteredEquipment);
});

// GET - Dohvati jedan komad opreme po ID-u
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const equipment = readEquipmentFile();
  const item = equipment.find(item => item.id === id);
  
  if (!item) {
    return res.status(404).json({ error: 'Oprema nije pronađena' });
  }
  
  res.json(item);
});

// POST - Dodaj novu opremu putem Excel fajla
router.post('/upload', upload.single('file'), (req, res) => {
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

    const newEquipment = data.map(item => ({
      id: String(Date.now() + Math.random()),
      category: normalizeCategory(item.Kategorija || item.kategorija || ''),
      description: item.MODEL || item.Opis || '',
      serialNumber: String(item.SN || item["Fabrički broj"] || ''),
      location: 'magacin',
      status: 'available'
    }));

    const existingEquipment = readEquipmentFile();
    
    // Provera da li oprema sa istim serijskim brojevima već postoji
    const filteredNewEquipment = newEquipment.filter(newItem => {
      const isDuplicate = existingEquipment.some(existingItem => 
        existingItem.serialNumber === newItem.serialNumber
      );
      return !isDuplicate;
    });

    const updatedEquipment = [...existingEquipment, ...filteredNewEquipment];
    saveEquipmentFile(updatedEquipment);

    // Brisanje privremenog fajla
    fs.unlinkSync(req.file.path);
    
    res.status(201).json({
      message: `Uspešno dodato ${filteredNewEquipment.length} komada opreme`,
      ignoredItems: newEquipment.length - filteredNewEquipment.length
    });
  } catch (error) {
    console.error('Error processing Excel:', error);
    res.status(500).json({ error: 'Greška pri učitavanju Excel fajla' });
  }
});

// POST - Dodaj pojedinačnu opremu
router.post('/', (req, res) => {
  try {
    const equipmentData = req.body;
    const equipment = readEquipmentFile();
    
    // Validacija podataka
    if (!equipmentData.category || !equipmentData.description || !equipmentData.serialNumber) {
      return res.status(400).json({ error: 'Nedostaju obavezni podaci' });
    }
    
    // Provera da li već postoji oprema sa istim serijskim brojem
    if (equipment.some(item => item.serialNumber === equipmentData.serialNumber)) {
      return res.status(400).json({ error: 'Oprema sa istim serijskim brojem već postoji' });
    }
    
    const newEquipment = {
      id: String(Date.now() + Math.random()),
      category: equipmentData.category,
      description: equipmentData.description,
      serialNumber: equipmentData.serialNumber,
      location: 'magacin',
      status: 'available'
    };
    
        equipment.push(newEquipment);
    saveEquipmentFile(equipment);
    
    res.status(201).json(newEquipment);
  } catch (error) {
    console.error('Greška pri dodavanju opreme:', error);
    res.status(500).json({ error: 'Greška pri dodavanju opreme' });
  }
});

// PUT - Ažuriranje opreme po ID-u
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const equipmentData = req.body;
  const equipment = readEquipmentFile();
  
  const index = equipment.findIndex(item => item.id === id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Oprema nije pronađena' });
  }
  
  equipment[index] = { ...equipment[index], ...equipmentData };
  saveEquipmentFile(equipment);
  
  res.json(equipment[index]);
});

// DELETE - Brisanje opreme po ID-u
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const equipment = readEquipmentFile();
  
  const filteredEquipment = equipment.filter(item => item.id !== id);
  
  if (filteredEquipment.length === equipment.length) {
    return res.status(404).json({ error: 'Oprema nije pronađena' });
  }
  
  saveEquipmentFile(filteredEquipment);
  
  res.json({ message: 'Oprema uspešno obrisana' });
});

module.exports = router;