// Kompletna zamena za fajl: routes/workorders.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const xlsx = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const { WorkOrder, User, Technician, Equipment, Material } = require('../models');



// Konfiguracija za upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)){
      fs.mkdirSync(uploadsDir);
    }
    
    const workordersUploadsDir = path.join(uploadsDir, 'workorders');
    if (!fs.existsSync(workordersUploadsDir)){
      fs.mkdirSync(workordersUploadsDir);
    }
    
    cb(null, workordersUploadsDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const originalName = file.originalname;
    // Zamena razmaka sa '_'
    const fileName = originalName.replace(/\s+/g, '_');
    cb(null, `${timestamp}-${fileName}`);
  }
});

// Konfiguracija za upload slika
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)){
      fs.mkdirSync(uploadsDir);
    }
    
    const imagesDir = path.join(uploadsDir, 'images');
    if (!fs.existsSync(imagesDir)){
      fs.mkdirSync(imagesDir);
    }
    
    cb(null, imagesDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const originalName = file.originalname;
    // Zamena razmaka sa '_'
    const fileName = originalName.replace(/\s+/g, '_');
    cb(null, `${timestamp}-${fileName}`);
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

const imageUpload = multer({
  storage: imageStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Samo slike su dozvoljene!'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});



// GET - Dohvati sve radne naloge
router.get('/', async (req, res) => {
  try {
    const workOrders = await WorkOrder.find()
      .populate('technicianId', 'name _id')
      .lean()
      .exec();
      
    res.json(workOrders);
  } catch (error) {
    console.error('Greška pri dohvatanju radnih naloga:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju radnih naloga' });
  }
});

// GET - Dohvati radne naloge tehničara
router.get('/technician/:technicianId', async (req, res) => {
  try {
    const { technicianId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(technicianId)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const technicianOrders = await WorkOrder.find({ technicianId });
    res.json(technicianOrders);
  } catch (error) {
    console.error('Greška pri dohvatanju radnih naloga tehničara:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju radnih naloga tehničara' });
  }
});

// GET - Dohvati nedodeljene radne naloge
router.get('/unassigned', async (req, res) => {
  try {
    const unassignedOrders = await WorkOrder.find({
      $or: [
        { technicianId: null },
        { technicianId: { $exists: false } }
      ]
    })
    .lean()
    .exec();
    res.json(unassignedOrders);
  } catch (error) {
    console.error('Greška pri dohvatanju nedodeljenih radnih naloga:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju nedodeljenih radnih naloga' });
  }
});

// GET - Dohvati radne naloge za verifikaciju
router.get('/verification', async (req, res) => {
  try {
    const ordersForVerification = await WorkOrder.find({
      status: 'zavrsen',
      verified: false
    });
    
    res.json(ordersForVerification);
  } catch (error) {
    console.error('Greška pri dohvatanju radnih naloga za verifikaciju:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju radnih naloga za verifikaciju' });
  }
});


router.post('/:id/used-equipment', async (req, res) => {
  try {
    const { id } = req.params;
    const { equipment } = req.body;
    
    if (!Array.isArray(equipment)) {
      return res.status(400).json({ error: 'Potrebno je dostaviti niz korišćene opreme' });
    }
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const workOrder = await WorkOrder.findById(id);
    
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }
    
    // Dodaj ili ažuriraj listu korišćene opreme za radni nalog
    workOrder.usedEquipment = equipment;
    
    const updatedWorkOrder = await workOrder.save();
    
    res.json(updatedWorkOrder);
  } catch (error) {
    console.error('Greška pri ažuriranju korišćene opreme:', error);
    res.status(500).json({ error: 'Greška pri ažuriranju korišćene opreme' });
  }
});

// GET endpoint za dohvatanje opreme korisnika za radni nalog
router.get('/:id/user-equipment', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    // Dohvati radni nalog
    const workOrder = await WorkOrder.findById(id)
      .populate({
        path: 'installedEquipment.equipmentId',
        model: 'Equipment'
      })
      .lean();
      
    if (!workOrder) {
      return res.json([]);
    }
    
    // Ako radni nalog ima installedEquipment, vrati te podatke
    if (workOrder.installedEquipment && workOrder.installedEquipment.length > 0) {
      // Izvuci samo podatke o opremi iz installedEquipment
      const installedEquipmentData = workOrder.installedEquipment
        .filter(item => item.equipmentId) // Filtriraj samo validne zapise
        .map(item => ({
          ...item.equipmentId,
          installedAt: item.installedAt,
          notes: item.notes || '',
          id: item._id // Dodaj ID zapisa za eventualno uklanjanje
        }));
      
      return res.json(installedEquipmentData);
    }
    
    // Ako nema installedEquipment, pokušaj naći opremu po tisId korisnika
    if (!workOrder.tisId) {
      return res.json([]);
    }
    
    // Pronađi opremu koja pripada korisniku
    const equipment = await Equipment.find({
      assignedToUser: workOrder.tisId,
      status: 'installed'
    });
    
    res.json(equipment);
  } catch (error) {
    console.error('Greška pri dohvatanju opreme korisnika:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju opreme korisnika' });
  }
});

// GET endpoint za dohvatanje materijala za radni nalog
router.get('/:id/materials', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    // Dohvati radni nalog sa materijalima
    const workOrder = await WorkOrder.findById(id)
      .populate('materials.material', 'type')
      .lean()
      .exec();
    
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }
    
    res.json(workOrder.materials || []);
  } catch (error) {
    console.error('Greška pri dohvatanju materijala za radni nalog:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju materijala za radni nalog' });
  }
});

// GET - Dohvati radni nalog po ID-u
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const workOrder = await WorkOrder.findById(id)
      .populate('technicianId')
      .lean()
      .exec();
    
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }
    
    res.json(workOrder);
  } catch (error) {
    console.error('Greška pri dohvatanju radnog naloga:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju radnog naloga' });
  }
});

// POST - Dodaj nove radne naloge putem Excel fajla
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

    // Dohvatanje svih tehničara iz baze
    const technicians = await Technician.find().lean();
    
    // Mapiranje tehničara po imenu
    const technicianByName = {};
    technicians.forEach(tech => {
      technicianByName[tech.name.toLowerCase()] = tech._id;
    });
    
    const newWorkOrders = [];
    const newUsers = [];
    const existingUsers = [];
    const errors = [];
    
    for (const row of data) {
      try {
        // Izvlačenje podataka iz reda
        const technicianName = row["Tehnicar 1"] || '';
        const area = row["Područje"] || '';
        const installDateTime = row["Početak instalacije"] || '';
        const technology = row["Tehnologija"] || '';
        const tisId = row["TIS ID korisnika"]?.toString() || '';
        const address = row["Adresa korisnika"] || '';
        const userName = row["Ime korisnika"] || '';
        const userPhone = row["Kontakt telefon 1"]?.toString() || '';
        const tisJobId = row["TIS Posao ID"]?.toString() || '';
        const packageName = row["Paket"] || '';
        const additionalJobs = row["Dodatni poslovi"] || '';
        const requestType = row["Tip zahteva"] || '';
        
        // Parsiranje datuma i vremena
        let date = new Date().toISOString().split('T')[0];
        let time = '09:00';
        if (installDateTime) {
          try {
            const parts = installDateTime.split(' ');
            if (parts.length > 0) {
              const dateParts = parts[0].split('/');
              if (dateParts.length === 3) {
                const parsedDate = new Date(
                  parseInt(dateParts[2], 10),
                  parseInt(dateParts[1], 10) - 1,
                  parseInt(dateParts[0], 10)
                );
                if (!isNaN(parsedDate.getTime())) {
                  date = parsedDate.toISOString().split('T')[0];
                }
              }
            }
            if (parts.length > 1) {
              time = parts[1];
            }
          } catch (error) {
            console.error('Greška pri parsiranju datuma:', error);
          }
        }
        
        // Pronalaženje tehničara po imenu
        let technicianId = null;
        if (technicianName) {
          technicianId = technicianByName[technicianName.toLowerCase()];
        }

        // Provera da li radni nalog već postoji
        const existingWorkOrder = await WorkOrder.findOne({
          date,
          time,
          municipality: area,
          address,
          type: packageName,
          tisId,
          tisJobId
        });

        if (existingWorkOrder) {
          console.log('Radni nalog već postoji, preskačem:', { address, tisId, tisJobId });
          continue;
        }
        
        // Provera da li korisnik već postoji
        let user = null;
        if (tisId) {
          user = await User.findOne({ tisId });
          
          if (!user) {
            // Kreiranje novog korisnika
            const newUser = new User({
              tisId,
              name: userName,
              address,
              phone: userPhone,
              workOrders: []
            });
            
            user = await newUser.save();
            newUsers.push(user);
          } else {
            // Ažuriranje postojećeg korisnika
            user.name = userName || user.name;
            user.address = address || user.address;
            user.phone = userPhone || user.phone;
            await user.save();
            existingUsers.push(user);
          }
        }
        
        // Kreiranje novog radnog naloga
        const newWorkOrder = new WorkOrder({
          date,
          time,
          municipality: area,
          address,
          type: packageName,
          technicianId,
          details: requestType,
          comment: '',
          status: 'nezavrsen',
          technology,
          tisId,
          userName,
          userPhone,
          tisJobId,
          additionalJobs,
          images: [],
          verified: false,
          user: user ? user._id : null
        });
        
        const savedWorkOrder = await newWorkOrder.save();
        newWorkOrders.push(savedWorkOrder);
        
        // Dodavanje radnog naloga korisniku
        if (user) {
          await User.findByIdAndUpdate(user._id, {
            $push: { workOrders: savedWorkOrder._id }
          });
        }
        
      } catch (error) {
        console.error('Greška pri obradi reda:', error);
        errors.push(`Greška pri obradi reda: ${JSON.stringify(row)}`);
      }
    }
    
    res.json({
      newWorkOrders,
      newUsers,
      existingUsers,
      errors
    });
    
  } catch (error) {
    console.error('Greška pri upload-u:', error);
    res.status(500).json({ error: 'Greška pri obradi Excel fajla: ' + error.message });
  } finally {
    // Brisanje privremenog fajla
    if (req.file) {
      fs.unlink(req.file.path, err => {
        if (err) console.error('Greška pri brisanju privremenog fajla:', err);
      });
    }
  }
});

// GET - Preuzimanje šablona
router.get('/template', (req, res) => {
  const templatePath = path.join(__dirname, '../templates/workorders-template.xlsx');
  
  // Ako šablon ne postoji, kreiramo ga
  if (!fs.existsSync(templatePath)) {
    const workbook = xlsx.utils.book_new();
    const data = [
      {
        "Tehnicar 1": "Ime tehničara",
        "Tehnicar 2": "",
        "Područje": "BORČA",
        "Početak instalacije": "31/05/2023 12:00",
        "Tehnologija": "HFC",
        "TIS ID korisnika": "904317",
        "Adresa korisnika": "Beograd,BORČA,OBROVAČKA 9",
        "Ime korisnika": "PETAR ĐUKIĆ",
        "Kontakt telefon 1": "0642395394",
        "TIS Posao ID": "629841530",
        "Paket": "Dodatni STB/CA - Kabl TV",
        "Dodatni poslovi": "629841530,Dodatni STB/CA - Kabl TV",
        "Tip zahteva": "Zamena uređaja"
      }
    ];
    
    const worksheet = xlsx.utils.json_to_sheet(data);
    xlsx.utils.book_append_sheet(workbook, worksheet, "Radni Nalozi");
    
    // Kreiramo direktorijum ako ne postoji
    const dir = path.dirname(templatePath);
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, { recursive: true });
    }
    
    xlsx.writeFile(workbook, templatePath);
  }
  
  res.download(templatePath, 'radni-nalozi-sablon.xlsx');
});

// POST - Dodaj pojedinačni radni nalog
router.post('/', async (req, res) => {
  try {
    const { 
      date, time, municipality, address, type, technicianId, details, comment,
      technology, tisId, userName, userPhone, tisJobId, additionalJobs 
    } = req.body;
    
    if (!date || !municipality || !address || !type) {
      return res.status(400).json({ error: 'Datum, opština, adresa i tip su obavezna polja' });
    }
    
    // Provera da li tehničar postoji
    if (technicianId && mongoose.Types.ObjectId.isValid(technicianId)) {
      const technician = await Technician.findById(technicianId);
      if (!technician) {
        return res.status(400).json({ error: 'Tehničar nije pronađen' });
      }
    }
    
    // Ako je prosleđen tisId, pronalazimo ili kreiramo korisnika
    let userId = null;
    
    if (tisId) {
      // Proveravamo da li korisnik već postoji
      let user = await User.findOne({ tisId });
      
      // Ako ne postoji, kreiramo novog korisnika
      if (!user) {
        const newUser = new User({
          tisId,
          name: userName || '',
          address: address || '',
          phone: userPhone || '',
          workOrders: []
        });
        
        user = await newUser.save();
      }
      
      userId = user._id;
    }
    
    // Kreiranje novog radnog naloga
    const newWorkOrder = new WorkOrder({
      date,
      time: time || '09:00',
      municipality,
      address,
      type,
      technicianId: technicianId || null,
      details: details || '',
      comment: comment || '',
      status: 'nezavrsen',
      technology: technology || '',
      tisId: tisId || '',
      userName: userName || '',
      userPhone: userPhone || '',
      tisJobId: tisJobId || '',
      additionalJobs: additionalJobs || '',
      images: [],
      verified: false,
      user: userId
    });
    
    const savedWorkOrder = await newWorkOrder.save();
    
    // Ako je korisnik pronađen/kreiran, dodajemo radni nalog korisniku
    if (userId) {
      await User.findByIdAndUpdate(userId, {
        $push: { workOrders: savedWorkOrder._id }
      });
    }
    
    res.status(201).json(savedWorkOrder);
  } catch (error) {
    console.error('Greška pri kreiranju radnog naloga:', error);
    res.status(500).json({ error: 'Greška pri kreiranju radnog naloga' });
  }
});

// PUT - Ažuriraj radni nalog
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    console.log('Received update data:', updateData);
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    // Provera da li radni nalog postoji
    const workOrder = await WorkOrder.findById(id);
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }

    // Provera i konverzija technicianId
    if (updateData.technicianId === '') {
      updateData.technicianId = null;
    } else if (updateData.technicianId && !mongoose.Types.ObjectId.isValid(updateData.technicianId)) {
      return res.status(400).json({ error: 'Neispravan format ID-a tehničara' });
    }

    console.log('Current work order:', workOrder);
    console.log('Processed update data:', updateData);

    // Pojednostavljeno ažuriranje
    const updatedWorkOrder = await WorkOrder.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('technicianId', 'name _id');

    console.log('Updated work order:', updatedWorkOrder);

    if (!updatedWorkOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen nakon ažuriranja' });
    }

    res.json(updatedWorkOrder);
  } catch (error) {
    console.error('Detalji greške:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ 
      error: 'Greška pri ažuriranju radnog naloga',
      details: error.message 
    });
  }
});

// PUT - Ažuriranje radnog naloga (tehničar)
router.put('/:id/technician-update', async (req, res) => {
  try {
    const { id } = req.params;
    const { comment, status, postponeDate, postponeTime } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const workOrder = await WorkOrder.findById(id);
    
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }
    
    // Tehničar može da ažurira samo komentar, status i vreme odlaganja
    if (comment !== undefined) {
      workOrder.comment = comment;
    }
    
    // Ako je status promenjen, ažuriramo i to
    if (status) {
      workOrder.status = status;
      
      // Ako je status promenjen na "zavrsen", dodaj timestamp završetka
      if (status === 'zavrsen' && workOrder.status !== 'zavrsen') {
        workOrder.completedAt = new Date();
        workOrder.verified = false; // Čeka verifikaciju admina
      } 
      // Ako je status promenjen na "odlozen", dodaj novo vreme i datum
      else if (status === 'odlozen' && workOrder.status !== 'odlozen') {
        workOrder.postponedAt = new Date();
        
        // Ako su dostavljeni novi datum i vreme, ažuriramo ih
        if (postponeDate) {
          workOrder.date = postponeDate;
        }
        if (postponeTime) {
          workOrder.time = postponeTime;
        }
      }
      // Ako je status "otkazan", dodaj timestamp otkazivanja
      else if (status === 'otkazan' && workOrder.status !== 'otkazan') {
        workOrder.canceledAt = new Date();
      }
    }
    
    const updatedWorkOrder = await workOrder.save();
    
    res.json(updatedWorkOrder);
  } catch (error) {
    console.error('Greška pri ažuriranju radnog naloga od strane tehničara:', error);
    res.status(500).json({ error: 'Greška pri ažuriranju radnog naloga' });
  }
});

// POST - Dodavanje slike radnom nalogu
router.post('/:id/images', imageUpload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!req.file) {
      return res.status(400).json({ error: 'Slika nije priložena' });
    }
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      // Brisanje uploadvane slike ako ID nije ispravan
      fs.unlink(req.file.path, err => {
        if (err) console.error('Greška pri brisanju slike:', err);
      });
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const workOrder = await WorkOrder.findById(id);
    
    if (!workOrder) {
      // Brisanje uploadvane slike ako radni nalog ne postoji
      fs.unlink(req.file.path, err => {
        if (err) console.error('Greška pri brisanju slike:', err);
      });
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }
    
    // URL do slike relativno u odnosu na server
    const imageUrl = `/uploads/images/${path.basename(req.file.path)}`;
    
    if (!workOrder.images) {
      workOrder.images = [];
    }
    
    workOrder.images.push(imageUrl);
    
    const updatedWorkOrder = await workOrder.save();
    
    res.json({
      message: 'Slika uspešno dodata',
      workOrder: updatedWorkOrder
    });
  } catch (error) {
    console.error('Greška pri dodavanju slike radnom nalogu:', error);
    res.status(500).json({ error: 'Greška pri dodavanju slike radnom nalogu' });
    
    // Brisanje uploadvane slike u slučaju greške
    if (req.file) {
      fs.unlink(req.file.path, err => {
        if (err) console.error('Greška pri brisanju slike:', err);
      });
    }
  }
});

// PUT - Verifikacija radnog naloga od strane admina
router.put('/:id/verify', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const workOrder = await WorkOrder.findById(id);
    
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }
    
    if (workOrder.status !== 'zavrsen') {
      return res.status(400).json({ error: 'Samo završeni radni nalozi mogu biti verifikovani' });
    }
    
    workOrder.verified = true;
    workOrder.verifiedAt = new Date();
    
    const updatedWorkOrder = await workOrder.save();
    
    res.json({
      message: 'Radni nalog je uspešno verifikovan',
      workOrder: updatedWorkOrder
    });
  } catch (error) {
    console.error('Greška pri verifikaciji radnog naloga:', error);
    res.status(500).json({ error: 'Greška pri verifikaciji radnog naloga' });
  }
});

// POST - Ažuriranje utrošenog materijala za radni nalog
router.post('/:id/used-materials', async (req, res) => {
  try {
    const { id } = req.params;
    const { materials } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    if (!Array.isArray(materials)) {
      return res.status(400).json({ error: 'Potrebno je dostaviti niz materijala' });
    }
    
    // Validacija materijala
    for (const material of materials) {
      if (!material.material || !mongoose.Types.ObjectId.isValid(material.material)) {
        return res.status(400).json({ error: 'Neispravan ID materijala' });
      }
      if (!material.quantity || material.quantity <= 0) {
        return res.status(400).json({ error: 'Količina mora biti veća od 0' });
      }
    }
    
    const workOrder = await WorkOrder.findById(id);
    
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }
    
    // Ažuriranje utrošenih materijala
    workOrder.materials = materials;
    
    const updatedWorkOrder = await workOrder.save();
    
    res.json({
      message: 'Uspešno ažurirani utrošeni materijali',
      workOrder: updatedWorkOrder
    });
  } catch (error) {
    console.error('Greška pri ažuriranju materijala:', error);
    res.status(500).json({ error: 'Greška pri ažuriranju materijala' });
  }
});

// POST - Ažuriranje utrošene opreme za radni nalog
router.post('/:id/used-equipment', (req, res) => {
  const { id } = req.params;
  const { equipmentSerialNumbers } = req.body;
  
  if (!Array.isArray(equipmentSerialNumbers)) {
    return res.status(400).json({ error: 'Potrebno je dostaviti niz serijskih brojeva opreme' });
  }
  
  const workOrders = readWorkordersFile();
  const workOrderIndex = workOrders.findIndex(order => order.id === id);
  
  if (workOrderIndex === -1) {
    return res.status(404).json({ error: 'Radni nalog nije pronađen' });
  }
  
  // Dodaj ili ažuriraj listu utrošene opreme
  workOrders[workOrderIndex].usedEquipment = equipmentSerialNumbers;
  workOrders[workOrderIndex].equipmentUpdatedAt = new Date().toISOString();
  
  saveWorkordersFile(workOrders);
  
  res.json({
    message: 'Uspešno ažurirana utrošena oprema',
    workOrder: workOrders[workOrderIndex]
  });
});

// DELETE - Brisanje radnog naloga
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const workOrder = await WorkOrder.findById(id);
    
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }
    
    // Uklanjanje referenci na radni nalog iz korisnika
    if (workOrder.user) {
      await User.findByIdAndUpdate(workOrder.user, {
        $pull: { workOrders: id }
      });
    } else if (workOrder.tisId) {
      // Alternativni način ako koristimo tisId
      const user = await User.findOne({ tisId: workOrder.tisId });
      if (user) {
        await User.findByIdAndUpdate(user._id, {
          $pull: { workOrders: id }
        });
      }
    }
    
    // Brisanje radnog naloga
    await WorkOrder.findByIdAndDelete(id);
    
    res.json({ message: 'Radni nalog uspešno obrisan' });
  } catch (error) {
    console.error('Greška pri brisanju radnog naloga:', error);
    res.status(500).json({ error: 'Greška pri brisanju radnog naloga' });
  }
});

// GET - Dohvati statistiku radnih naloga
router.get('/statistics/summary', async (req, res) => {
  try {
    // Dohvatanje svih radnih naloga i tehničara
    const workOrders = await WorkOrder.find();
    const technicians = await Technician.find().select('name phone email');
    
    // Ukupan broj radnih naloga
    const total = workOrders.length;
    
    // Broj po statusima
    const completed = workOrders.filter(order => order.status === 'zavrsen').length;
    const pending = workOrders.filter(order => order.status === 'nezavrsen').length;
    const postponed = workOrders.filter(order => order.status === 'odlozen').length;
    const canceled = workOrders.filter(order => order.status === 'otkazan').length;
    
    // Broj verifikovanih
    const verified = workOrders.filter(order => order.verified).length;
    
    // Po tipovima
    const byType = {};
    workOrders.forEach(order => {
      if (!byType[order.type]) {
        byType[order.type] = 0;
      }
      byType[order.type]++;
    });
    
    // Po opštinama
    const byMunicipality = {};
    workOrders.forEach(order => {
      if (!byMunicipality[order.municipality]) {
        byMunicipality[order.municipality] = 0;
      }
      byMunicipality[order.municipality]++;
    });
    
    // Po tehnologiji
    const byTechnology = {};
    workOrders.forEach(order => {
      if (order.technology) {
        if (!byTechnology[order.technology]) {
          byTechnology[order.technology] = 0;
        }
        byTechnology[order.technology]++;
      }
    });
    
    // Po tehničarima
    const byTechnician = {};
    workOrders.forEach(order => {
      if (order.technicianId) {
        const techId = order.technicianId.toString();
        if (!byTechnician[techId]) {
          byTechnician[techId] = {
            total: 0,
            completed: 0,
            pending: 0,
            postponed: 0,
            canceled: 0,
            verified: 0
          };
        }
        byTechnician[techId].total++;
        
        if (order.status === 'zavrsen') {
          byTechnician[techId].completed++;
          if (order.verified) {
            byTechnician[techId].verified++;
          }
        } else if (order.status === 'nezavrsen') {
          byTechnician[techId].pending++;
        } else if (order.status === 'odlozen') {
          byTechnician[techId].postponed++;
        } else if (order.status === 'otkazan') {
          byTechnician[techId].canceled++;
        }
      }
    });
    
    // Dodajemo imena tehničara u statistiku
    const technicianDetails = {};
    technicians.forEach(tech => {
      technicianDetails[tech._id.toString()] = {
        name: tech.name,
        phone: tech.phone || null,
        email: tech.email || null
      };
    });
    
    // Nedodeljeni radni nalozi
    const unassigned = workOrders.filter(order => !order.technicianId).length;
    
    res.json({
      total,
      completed,
      pending,
      postponed,
      canceled,
      verified,
      unassigned,
      byType,
      byMunicipality,
      byTechnology,
      byTechnician,
      technicianDetails
    });
  } catch (error) {
    console.error('Greška pri dohvatanju statistike radnih naloga:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju statistike radnih naloga' });
  }
});

module.exports = router;