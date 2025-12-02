const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { Equipment, Log, Technician } = require('../models');
const emailService = require('../services/emailService');
const { createInventorySummary } = require('../utils/emailTemplates');
const { logActivity } = require('../middleware/activityLogger');
const { auth } = require('../middleware/auth');

// Helper funkcija za case-insensitive pretragu serijskog broja
const findEquipmentBySerialNumber = (serialNumber) => {
  // Escape special regex characters
  const escapedSerial = serialNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Equipment.findOne({
    serialNumber: { $regex: new RegExp(`^${escapedSerial}$`, 'i') }
  });
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

// Lista validnih kategorija
const VALID_CATEGORIES = [
  'STB', 'Cam Modul', 'Hybrid', 'OTT tv po tvom', 'Smart Card',
  'HFC Modem', 'GPON Modem', 'ATV', 'PON',
  'M-Cam Modul', 'M-Smart Card', 'M-HFC Modem', 'M-GPON Modem',
  'M-ATV', 'M-STB', 'M-OTT tv po tvom', 'M-Hybrid', 'M-PON'
];

// Funkcija za normalizaciju kategorija - mapiranje starih naziva na nove standardizovane
const normalizeCategory = (category) => {
  if (!category) return '';

  const lowerCategory = category.toLowerCase().trim();

  // Mapiranje starih kategorija na nove standardizovane
  const categoryMappings = {
    // STB
    'box': 'STB',
    'dtv': 'STB',
    'stb': 'STB',
    'skaymaster': 'STB',
    'sky': 'STB',
    'sky master': 'STB',
    'skymaster': 'STB',

    // Cam Modul
    'c modul': 'Cam Modul',
    'c-modul': 'Cam Modul',
    'cmodul': 'Cam Modul',
    'cam': 'Cam Modul',
    'cam cmodul': 'Cam Modul',
    'can': 'Cam Modul',
    'ci': 'Cam Modul',
    'crypto': 'Cam Modul',
    'crypto gard': 'Cam Modul',
    'kam': 'Cam Modul',
    'cam modul': 'Cam Modul',

    // Hybrid
    'hibrid': 'Hybrid',
    'move': 'Hybrid',
    'move stb': 'Hybrid',
    'hybrid': 'Hybrid',

    // OTT tv po tvom
    'ott': 'OTT tv po tvom',
    'ott media': 'OTT tv po tvom',
    'ott tv po tvom': 'OTT tv po tvom',
    'ip stb': 'OTT tv po tvom',
    'tv po tvom': 'OTT tv po tvom',

    // Smart Card
    'kartica': 'Smart Card',
    'sim': 'Smart Card',
    'smart': 'Smart Card',
    'smart kartica': 'Smart Card',
    'smart card': 'Smart Card',
    'sim kartica': 'Smart Card',
    'sim karticu': 'Smart Card',

    // HFC Modem
    'modem hfc': 'HFC Modem',
    'hfc modem': 'HFC Modem',
    'hfc mode': 'HFC Modem',
    'modem': 'HFC Modem',

    // GPON Modem
    'gpon modem': 'GPON Modem',

    // ATV
    'atv': 'ATV',

    // PON
    'pon': 'PON',

    // M- prefixed categories
    'm cam': 'M-Cam Modul',
    'm-cam': 'M-Cam Modul',
    'm cam modul': 'M-Cam Modul',
    'm-cam modul': 'M-Cam Modul',

    'm sim': 'M-Smart Card',
    'm-sim': 'M-Smart Card',
    'm smart card': 'M-Smart Card',
    'm-smart card': 'M-Smart Card',

    'm hfc modem': 'M-HFC Modem',
    'm-hfc modem': 'M-HFC Modem',
    'm hfc': 'M-HFC Modem',
    'm-hfc': 'M-HFC Modem',

    'm gpon modem': 'M-GPON Modem',
    'm-gpon modem': 'M-GPON Modem',
    'm gpon': 'M-GPON Modem',
    'm-gpon': 'M-GPON Modem',

    'm atv': 'M-ATV',
    'm-atv': 'M-ATV',

    'm stb': 'M-STB',
    'm-stb': 'M-STB',

    'm ott': 'M-OTT tv po tvom',
    'm-ott': 'M-OTT tv po tvom',
    'm ott tv po tvom': 'M-OTT tv po tvom',
    'm-ott tv po tvom': 'M-OTT tv po tvom',

    'm hybrid': 'M-Hybrid',
    'm-hybrid': 'M-Hybrid',
    'm hibrid': 'M-Hybrid',
    'm-hibrid': 'M-Hybrid',

    'm pon': 'M-PON',
    'm-pon': 'M-PON'
  };

  // Direktno mapiranje
  if (categoryMappings[lowerCategory]) {
    return categoryMappings[lowerCategory];
  }

  // Ako kategorija već ima ispravan format, vrati je
  const validCategories = [
    'STB', 'Cam Modul', 'Hybrid', 'OTT tv po tvom', 'Smart Card',
    'HFC Modem', 'GPON Modem', 'ATV', 'PON',
    'M-Cam Modul', 'M-Smart Card', 'M-HFC Modem', 'M-GPON Modem',
    'M-ATV', 'M-STB', 'M-OTT tv po tvom', 'M-Hybrid', 'M-PON'
  ];

  const matchedCategory = validCategories.find(
    vc => vc.toLowerCase() === lowerCategory
  );

  if (matchedCategory) {
    return matchedCategory;
  }

  // Ako nije pronađeno mapiranje, vrati null da označimo da je nevalidna kategorija
  return null;
};

// Funkcija za proveru da li je kategorija validna
const isValidCategory = (category) => {
  if (!category) return false;
  const normalized = normalizeCategory(category);
  return normalized !== null;
};

// GET - Dohvati sve komade opreme (optimized)
router.get('/', async (req, res) => {
  try {
    const { statsOnly } = req.query;

    // Za dashboard, vraćaj samo broj elemenata
    if (statsOnly === 'true') {
      const count = await Equipment.countDocuments();
      return res.json({ total: count });
    }

    // Za punu listu, dodaj index i lean za performance
    const equipment = await Equipment.find()
      .lean() // Vratiti plain JS objekte umesto Mongoose dokumenata
      .sort({ createdAt: -1 }); // Dodaj indeks na createdAt

    res.json(equipment);
  } catch (error) {
    console.error('Greška pri dohvatanju opreme:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju opreme' });
  }
});

// GET - Dohvati opremu za prikaz (samo magacin i tehničari) with server-side pagination
router.get('/display', async (req, res) => {
  try {
    const startTime = Date.now();

    const {
      statsOnly,
      page = 1,
      limit = 50,
      search = '',
      category = '',
      location = ''
    } = req.query;

    // Za dashboard/stats, vrati samo brojeve
    if (statsOnly === 'true') {
      const filterObj = {
        $or: [
          { location: 'magacin' },
          { location: { $regex: /^tehnicar-/ } }
        ]
      };

      // Add category filter if specified
      if (category && category !== 'all') {
        filterObj.category = category;
      }

      const [totalCount, inWarehouse] = await Promise.all([
        Equipment.countDocuments(filterObj),
        Equipment.countDocuments({
          ...filterObj,
          location: 'magacin'
        })
      ]);

      const assigned = totalCount - inWarehouse;

      return res.json({
        total: totalCount,
        inWarehouse,
        assigned
      });
    }

    // Build filter object
    let filterObj = {
      $or: [
        { location: 'magacin' },
        { location: { $regex: /^tehnicar-/ } }
      ]
    };

    // Add search filter
    if (search) {
      filterObj.$and = filterObj.$and || [];
      filterObj.$and.push({
        $or: [
          { serialNumber: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { category: { $regex: search, $options: 'i' } }
        ]
      });
    }

    // Add category filter
    if (category && category !== 'all') {
      filterObj.category = category;
    }

    // Add location filter
    if (location) {
      filterObj.location = location;
    }

    // Server-side pagination setup
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 50, 100); // Max 100 per page
    const skip = (pageNum - 1) * limitNum;

    // Execute queries in parallel
    const [equipment, totalCount] = await Promise.all([
      Equipment.find(filterObj)
        .skip(skip)
        .limit(limitNum)
        .sort({ createdAt: -1 })
        .lean(),
      Equipment.countDocuments(filterObj)
    ]);

    const endTime = Date.now();
    const queryTime = endTime - startTime;

    res.json({
      data: equipment,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalCount / limitNum),
        totalCount,
        limit: limitNum,
        hasNextPage: pageNum < Math.ceil(totalCount / limitNum),
        hasPreviousPage: pageNum > 1
      },
      performance: {
        queryTime,
        resultsPerPage: equipment.length
      }
    });

  } catch (error) {
    console.error('Greška pri dohvatanju opreme za prikaz:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju opreme za prikaz' });
  }
});

// GET - Dohvati sve kategorije opreme sa brojem elemenata
router.get('/categories', async (req, res) => {
  try {
    const { withCounts } = req.query;

    if (withCounts === 'true') {
      // Aggregation pipeline za dobijanje kategorija sa brojem elemenata
      const categoriesWithCounts = await Equipment.aggregate([
        {
          $match: {
            $or: [
              { location: 'magacin' },
              { location: { $regex: /^tehnicar-/ } }
            ]
          }
        },
        {
          $group: {
            _id: '$category',
            count: { $sum: 1 }
          }
        },
        {
          $sort: { _id: 1 }
        }
      ]);

      // Dodaj ukupan broj za "all" kategoriju
      const totalCount = await Equipment.countDocuments({
        $or: [
          { location: 'magacin' },
          { location: { $regex: /^tehnicar-/ } }
        ]
      });

      const result = {
        all: totalCount,
        ...categoriesWithCounts.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
      };

      return res.json(result);
    }

    // Default behavior - samo lista kategorija
    const categories = await Equipment.distinct('category');
    res.json(categories);
  } catch (error) {
    console.error('Greška pri dohvatanju kategorija opreme:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju kategorija opreme' });
  }
});

// GET - Dohvati sve moguće lokacije (magacin + svi tehničari)
router.get('/locations', async (req, res) => {
  try {
    // Dobij sve tehničare
    const technicians = await require('../models').Technician.find().select('_id name').lean();

    // Kreiraj lokacije array sa magacinom i svim tehničarima
    const locations = [
      { value: 'magacin', label: 'Magacin' }
    ];

    // Dodaj sve tehničare
    technicians.forEach(tech => {
      locations.push({
        value: `tehnicar-${tech._id}`,
        label: `Tehničar: ${tech.name}`
      });
    });

    res.json(locations);
  } catch (error) {
    console.error('Greška pri dohvatanju lokacija:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju lokacija' });
  }
});

// GET - Dohvati opremu grupisanu po OPIS-u (description)
router.get('/grouped', async (req, res) => {
  try {
    const { location, groupBy = 'description' } = req.query;

    if (!location) {
      return res.status(400).json({ error: 'Lokacija je obavezna' });
    }

    // Build aggregation pipeline
    const pipeline = [
      {
        $match: { location }
      },
      {
        $group: {
          _id: `$${groupBy}`,
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          description: '$_id',
          count: 1
        }
      },
      {
        $sort: { description: 1 }
      }
    ];

    const groupedEquipment = await Equipment.aggregate(pipeline);
    res.json(groupedEquipment);
  } catch (error) {
    console.error('Greška pri dohvatanju grupisane opreme:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju grupisane opreme' });
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

// GET - Preuzimanje šablona za opremu (mora biti pre /:id rute)
router.get('/template', (req, res) => {
  const templatePath = path.join(__dirname, '../templates/equipment-template.xlsx');

  // Ako šablon ne postoji, kreiramo ga
  if (!fs.existsSync(templatePath)) {
    const workbook = xlsx.utils.book_new();
    const data = [
      {
        "Kategorija": "CAM",
        "MODEL": "DGM3212 GM3212C",
        "SN": "GM32120000001"
      },
      {
        "Kategorija": "modem",
        "MODEL": "DGM3212",
        "SN": "DGM32120000001"
      },
      {
        "Kategorija": "STB",
        "MODEL": "9820T2",
        "SN": "STB98200000001"
      }
    ];

    const worksheet = xlsx.utils.json_to_sheet(data);
    xlsx.utils.book_append_sheet(workbook, worksheet, "Oprema");

    // Kreiramo direktorijum ako ne postoji
    const dir = path.dirname(templatePath);
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, { recursive: true });
    }

    xlsx.writeFile(workbook, templatePath);
  }

  res.download(templatePath, 'oprema-sablon.xlsx');
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
router.post('/upload', auth, logActivity('equipment', 'equipment_bulk_add', {
  getEntityName: (req, responseData) => `${responseData?.addedCount || 0} komada opreme`,
  getDetails: async (req, responseData) => {
    return {
      action: 'bulk_created',
      summary: {
        totalProcessed: responseData?.addedCount + responseData?.duplicates?.length + responseData?.errors?.length || 0,
        addedCount: responseData?.addedCount || 0,
        duplicatesCount: responseData?.duplicates?.length || 0,
        errorsCount: responseData?.errors?.length || 0
      },
      addedItems: responseData?.addedItems || [],
      duplicates: responseData?.duplicates || [],
      errors: responseData?.errors || []
    };
  }
}), upload.single('file'), async (req, res) => {
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

    // Prvo proveri sve kategorije da li su validne
    const invalidCategories = [];
    const rowsWithInvalidCategories = [];

    data.forEach((item, index) => {
      const rawCategory = item.Kategorija || item.kategorija || '';
      const normalizedCategory = normalizeCategory(rawCategory);

      if (rawCategory && normalizedCategory === null) {
        if (!invalidCategories.includes(rawCategory)) {
          invalidCategories.push(rawCategory);
        }
        rowsWithInvalidCategories.push({
          row: index + 2, // Excel rows start from 1, plus header row
          category: rawCategory,
          serialNumber: item.SN || item["Fabrički broj"] || 'N/A'
        });
      }
    });

    // Ako postoje nevalidne kategorije, vrati grešku
    if (invalidCategories.length > 0) {
      fs.unlinkSync(req.file.path); // Obriši privremeni fajl

      return res.status(400).json({
        error: `Pronađene nevalidne kategorije: ${invalidCategories.join(', ')}`,
        invalidCategories: invalidCategories,
        invalidRows: rowsWithInvalidCategories,
        validCategories: VALID_CATEGORIES,
        message: `Upload nije uspeo. Sledeće kategorije nisu validne: ${invalidCategories.join(', ')}. Molimo koristite samo validne kategorije.`
      });
    }

    const newEquipmentItems = data.map(item => ({
      category: normalizeCategory(item.Kategorija || item.kategorija || ''),
      description: item.MODEL || item.Opis || '',
      serialNumber: String(item.SN || item["Fabrički broj"] || '').toLowerCase(),
      location: 'magacin',
      status: 'available'
    }));

    // Provera duplikata i kreiranje liste za dodavanje
    const filteredNewEquipment = [];
    const duplicates = [];
    const errors = [];
    const seenSerialNumbers = new Set(); // Tracking internal duplicates (case-insensitive)

    for (const newItem of newEquipmentItems) {
      try {
        if (!newItem.serialNumber || !newItem.category || !newItem.description) {
          errors.push(`Nedostaju obavezni podaci: ${JSON.stringify(newItem)}`);
          continue;
        }

        // Normalizuj serijski broj u lowercase za case-insensitive proveru
        const normalizedSerial = newItem.serialNumber.toLowerCase();

        // Provera internih duplikata unutar Excel fajla (case-insensitive)
        if (seenSerialNumbers.has(normalizedSerial)) {
          duplicates.push({
            category: newItem.category,
            model: newItem.description,
            serialNumber: newItem.serialNumber,
            status: 'N/A',
            location: 'N/A',
            assignedTo: null,
            assignedToUser: null,
            reason: `Duplikat unutar Excel fajla - serijski broj ${newItem.serialNumber} se pojavljuje više puta`
          });
          continue;
        }

        // Provera postojećih duplikata u bazi (case-insensitive)
        const existingItem = await findEquipmentBySerialNumber(newItem.serialNumber);
        if (existingItem) {
          duplicates.push({
            category: existingItem.category,
            model: existingItem.description,
            serialNumber: existingItem.serialNumber,
            status: existingItem.status,
            location: existingItem.location,
            assignedTo: existingItem.assignedTo,
            assignedToUser: existingItem.assignedToUser,
            reason: `Oprema sa serijskim brojem ${newItem.serialNumber} već postoji u sistemu`
          });
        } else {
          // Dodaj u set za tracking (lowercase) i u listu za insert (original)
          seenSerialNumbers.add(normalizedSerial);
          filteredNewEquipment.push(newItem);
        }
      } catch (error) {
        errors.push(`Greška pri obradi: ${error.message}`);
      }
    }

    // Dodavanje nove opreme u bazu sa ordered: false za bolje rukovanje greškama
    let insertedEquipment = [];
    if (filteredNewEquipment.length > 0) {
      try {
        insertedEquipment = await Equipment.insertMany(filteredNewEquipment, { ordered: false });
      } catch (error) {
        // Ako je bulk write error, neki items su možda uspešno insertovani
        if (error.name === 'MongoBulkWriteError' || error.code === 11000) {
          // Uzmi uspešno insertovane items
          if (error.insertedDocs) {
            insertedEquipment = error.insertedDocs;
          }
          // Dodaj greške u errors array
          if (error.writeErrors) {
            error.writeErrors.forEach(writeError => {
              const failedItem = filteredNewEquipment[writeError.index];
              errors.push(`Greška pri dodavanju ${failedItem?.serialNumber}: ${writeError.errmsg || writeError.err?.errmsg || 'Nepoznata greška'}`);
            });
          }
        } else {
          throw error; // Re-throw ako nije bulk write error
        }
      }
    }

    // Brisanje privremenog fajla
    fs.unlinkSync(req.file.path);

    res.status(201).json({
      message: `Uspešno dodato ${filteredNewEquipment.length} komada opreme`,
      addedCount: filteredNewEquipment.length,
      addedItems: insertedEquipment.map(item => ({
        category: item.category,
        description: item.description,
        serialNumber: item.serialNumber,
        location: item.location,
        status: item.status
      })),
      duplicates,
      errors
    });
  } catch (error) {
    console.error('Greška pri učitavanju Excel fajla:', error);
    res.status(500).json({ error: 'Greška pri učitavanju Excel fajla' });
  }
});

// POST - Dodaj pojedinačnu opremu
router.post('/', auth, logActivity('equipment', 'equipment_add', {
  getEntityName: (req, responseData) => `${responseData?.category} - ${responseData?.serialNumber}`
}), async (req, res) => {
  try {
    const equipmentData = req.body;

    // Validacija podataka
    if (!equipmentData.category || !equipmentData.description || !equipmentData.serialNumber) {
      return res.status(400).json({ error: 'Nedostaju obavezni podaci' });
    }

    // Provera da li već postoji oprema sa istim serijskim brojem (case-insensitive)
    const existingEquipment = await findEquipmentBySerialNumber(equipmentData.serialNumber);
    if (existingEquipment) {
      return res.status(400).json({ error: 'Oprema sa istim serijskim brojem već postoji' });
    }

    const newEquipment = new Equipment({
      category: equipmentData.category,
      description: equipmentData.description,
      serialNumber: equipmentData.serialNumber.toLowerCase(),
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
router.put('/:id', auth, logActivity('equipment', 'equipment_edit', {
  getEntityId: (req) => req.params.id,
  getEntityName: (req, responseData) => `${responseData?.category} - ${responseData?.serialNumber}`
}), async (req, res) => {
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
    
    // Sačuvaj stari status da možemo proveriti da li se menja
    const oldStatus = equipment.status;
    
    // Provera da li drugi komad opreme već koristi ovaj serijski broj (case-insensitive)
    if (updateData.serialNumber && updateData.serialNumber.toLowerCase() !== equipment.serialNumber.toLowerCase()) {
      const escapedSerial = updateData.serialNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const duplicateSerial = await Equipment.findOne({
        _id: { $ne: id },
        serialNumber: { $regex: new RegExp(`^${escapedSerial}$`, 'i') }
      });

      if (duplicateSerial) {
        return res.status(400).json({ error: 'Oprema sa ovim serijskim brojem već postoji' });
      }
    }
    
    // Ažuriranje polja
    if (updateData.category) equipment.category = updateData.category;
    if (updateData.description) equipment.description = updateData.description;
    if (updateData.serialNumber) equipment.serialNumber = updateData.serialNumber.toLowerCase();
    if (updateData.location) equipment.location = updateData.location;
    if (updateData.status) equipment.status = updateData.status;
    if (updateData.assignedTo !== undefined) equipment.assignedTo = updateData.assignedTo;
    
    // Specijalna logika za defektnu opremu
    if (updateData.status === 'defective' && oldStatus !== 'defective') {
      console.log('🔧 Equipment status changed to defective - applying automatic transition');
      
      // Automatski postavi potrebne vrednosti za defektnu opremu
      equipment.location = 'defective';
      equipment.removedAt = updateData.removedAt || new Date();
      equipment.assignedTo = null;
      equipment.assignedToUser = null;
      
      console.log('📅 Equipment marked as defective:', {
        id: equipment._id,
        serialNumber: equipment.serialNumber,
        category: equipment.category,
        removedAt: equipment.removedAt
      });
      
      // Kreiraj log entry za označavanje kao defektno
      try {
        await new Log({
          action: 'equipment_marked_defective',
          equipmentDetails: {
            equipmentId: equipment._id,
            serialNumber: equipment.serialNumber,
            category: equipment.category,
            description: equipment.description,
            reason: 'Manually marked as defective',
            isWorking: false
          },
          performedByName: 'System (Equipment Edit)',
          timestamp: new Date()
        }).save();
        
        console.log('📝 Log entry created for defective equipment');
      } catch (logError) {
        console.error('⚠️ Failed to create log entry:', logError);
        // Ne prekidamo proces ako log ne uspe
      }
    }
    
    // Send email notification if equipment is assigned to technician
    try {
      // Check if location changed to a technician
      if (updateData.location && updateData.location.startsWith('tehnicar-')) {
        const technicianId = updateData.location.replace('tehnicar-', '');
        const technician = await Technician.findById(technicianId);
        
        if (technician && technician.gmail) {
          // Get technician's current inventory (all equipment assigned to them, excluding installed equipment)
          const currentInventory = await Equipment.find({
            assignedTo: technicianId,
            status: { $ne: 'installed' }
          });

          // Kreiranje sumirane tabele inventara
          const inventorySummaryData = createInventorySummary(currentInventory);

          // Send email asynchronously (non-blocking)
          setImmediate(async () => {
            try {
              const emailResult = await emailService.sendEmailToTechnician(
                technicianId,
                'equipmentAssignment',
                {
                  technicianName: technician.name,
                  assignmentType: 'edit',
                  equipment: [{
                    category: equipment.category,
                    description: equipment.description,
                    serialNumber: equipment.serialNumber,
                    status: equipment.status
                  }],
                  ...inventorySummaryData
                }
              );

              if (emailResult.success) {
                console.log(`✅ Email sent to technician ${technician.name} about equipment location change`);
              } else {
                console.error('❌ Failed to send email notification:', emailResult.error);
              }

              // DODATO: Kreiranje Android notifikacije za dodjeljivanje opreme (pojedinačno)
              const androidNotificationService = require('../services/androidNotificationService');
              try {
                // Pripremi detalje pojedinačne opreme
                const equipmentDetails = [{
                  _id: equipment._id,
                  name: equipment.description || equipment.category || 'Nepoznato',
                  serialNumber: equipment.serialNumber,
                  serial: equipment.serialNumber,
                  category: equipment.category,
                  equipmentName: equipment.description,
                  equipmentCategory: equipment.category
                }];

                await androidNotificationService.createEquipmentAddNotification(technicianId, equipmentDetails);
              } catch (notifError) {
                console.error(`❌ Error creating Android notification for equipment assignment:`, notifError.message);
              }
            } catch (emailError) {
              console.error('❌ Error sending equipment assignment email:', emailError.message);
            }
          });
        }
      }
    } catch (emailError) {
      console.error('Error sending equipment assignment email:', emailError);
      // Ne prekidamo proces ako email ne uspe
    }

    const updatedEquipment = await equipment.save();
    
    console.log('✅ Equipment updated successfully:', {
      id: updatedEquipment._id,
      status: updatedEquipment.status,
      location: updatedEquipment.location
    });
    
    res.json(updatedEquipment);
  } catch (error) {
    console.error('❌ Greška pri ažuriranju opreme:', error);
    res.status(500).json({ error: 'Greška pri ažuriranju opreme' });
  }
});

// DELETE - Brisanje opreme
router.delete('/:id', auth, logActivity('equipment', 'equipment_delete', {
  getEntityId: (req) => req.params.id,
  getEntityName: (req, responseData) => `${responseData?.deletedData?.category} - ${responseData?.deletedData?.serialNumber}` || 'Equipment'
}), async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    const deletedEquipment = await Equipment.findByIdAndDelete(id);

    if (!deletedEquipment) {
      return res.status(404).json({ error: 'Oprema nije pronađena' });
    }

    // Vrati podatke o obrisanoj opremi za logovanje
    res.json({
      message: 'Oprema uspešno obrisana',
      deletedData: {
        category: deletedEquipment.category,
        description: deletedEquipment.description,
        serialNumber: deletedEquipment.serialNumber,
        location: deletedEquipment.location,
        status: deletedEquipment.status,
        _id: deletedEquipment._id
      }
    });
  } catch (error) {
    console.error('Greška pri brisanju opreme:', error);
    res.status(500).json({ error: 'Greška pri brisanju opreme' });
  }
});

// POST - Dodeli opremu tehničaru
router.post('/assign-to-technician/:technicianId', auth, logActivity('equipment', 'equipment_assign_to_tech'), async (req, res) => {
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