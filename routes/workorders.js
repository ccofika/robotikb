// Kompletna zamena za fajl: routes/workorders.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const xlsx = require('xlsx');
const uuid = require('uuid');

const workordersFilePath = path.join(__dirname, '../data/workorders.json');
const techniciansFilePath = path.join(__dirname, '../data/technicians.json');
const usersFilePath = path.join(__dirname, '../data/users.json');
const userEquipmentFilePath = path.join(__dirname, '../data/userEquipment.json');

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

// Middleware za čitanje workorders.json fajla
const readWorkordersFile = () => {
  try {
    if (!fs.existsSync(workordersFilePath)) {
      console.log('Fajl workorders.json ne postoji, kreiram prazan fajl.');
      fs.writeFileSync(workordersFilePath, '[]', 'utf8');
      return [];
    }
    
    const data = fs.readFileSync(workordersFilePath, 'utf8');
    if (!data || data.trim() === '') {
      console.log('Fajl workorders.json je prazan, kreiram prazan niz.');
      fs.writeFileSync(workordersFilePath, '[]', 'utf8');
      return [];
    }
    
    return JSON.parse(data);
  } catch (error) {
    console.error('Greška pri čitanju radnih naloga:', error);
    // Ako je greška u parsiranju, resetujemo fajl
    fs.writeFileSync(workordersFilePath, '[]', 'utf8');
    return [];
  }
};

// Middleware za čuvanje workorders.json fajla
const saveWorkordersFile = (data) => {
  try {
    fs.writeFileSync(workordersFilePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Greška pri čuvanju radnih naloga:', error);
    return false;
  }
};

// Middleware za čitanje technicians.json fajla
const readTechniciansFile = () => {
  try {
    if (fs.existsSync(techniciansFilePath)) {
      const data = fs.readFileSync(techniciansFilePath, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('Greška pri čitanju tehničara:', error);
    return [];
  }
};

// Middleware za čitanje users.json fajla
const readUsersFile = () => {
  try {
    if (!fs.existsSync(usersFilePath)) {
      console.log('Fajl users.json ne postoji, kreiram prazan fajl.');
      fs.writeFileSync(usersFilePath, '[]', 'utf8');
      return [];
    }
    
    const data = fs.readFileSync(usersFilePath, 'utf8');
    if (!data || data.trim() === '') {
      console.log('Fajl users.json je prazan, kreiram prazan niz.');
      fs.writeFileSync(usersFilePath, '[]', 'utf8');
      return [];
    }
    
    return JSON.parse(data);
  } catch (error) {
    console.error('Greška pri čitanju korisnika:', error);
    // Ako je greška u parsiranju, resetujemo fajl
    fs.writeFileSync(usersFilePath, '[]', 'utf8');
    return [];
  }
};

// Middleware za čuvanje users.json fajla
const saveUsersFile = (data) => {
  try {
    fs.writeFileSync(usersFilePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Greška pri čuvanju korisnika:', error);
    return false;
  }
};

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

// GET - Dohvati sve radne naloge
router.get('/', (req, res) => {
  const workOrders = readWorkordersFile();
  res.json(workOrders);
});

// GET - Dohvati radne naloge tehničara
router.get('/technician/:technicianId', (req, res) => {
  const { technicianId } = req.params;
  const workOrders = readWorkordersFile();
  
  const technicianOrders = workOrders.filter(order => order.technicianId === technicianId);
  
  res.json(technicianOrders);
});

// GET - Dohvati nedodeljene radne naloge
router.get('/unassigned', (req, res) => {
  const workOrders = readWorkordersFile();
  
  const unassignedOrders = workOrders.filter(order => !order.technicianId || order.technicianId === '');
  
  res.json(unassignedOrders);
});

// GET - Dohvati radne naloge za verifikaciju
router.get('/verification', (req, res) => {
  const workOrders = readWorkordersFile();
  
  const ordersForVerification = workOrders.filter(
    order => order.status === 'zavrsen' && order.verified === false
  );
  
  res.json(ordersForVerification);
});


router.post('/:id/used-equipment', (req, res) => {
  const { id } = req.params;
  const { equipment } = req.body;
  
  if (!Array.isArray(equipment)) {
    return res.status(400).json({ error: 'Potrebno je dostaviti niz korišćene opreme' });
  }
  
  const workOrders = readWorkordersFile();
  const index = workOrders.findIndex(order => order.id === id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Radni nalog nije pronađen' });
  }
  
  // Dodaj ili ažuriraj listu korišćene opreme za radni nalog
  workOrders[index].usedEquipment = equipment;
  workOrders[index].updatedAt = new Date().toISOString();
  
  saveWorkordersFile(workOrders);
  
  res.json(workOrders[index]);
});

// Dodati GET endpoint za dohvatanje opreme korisnika za radni nalog
router.get('/:id/user-equipment', (req, res) => {
  const { id } = req.params;
  const workOrders = readWorkordersFile();
  const userEquipment = readUserEquipmentFile();
  
  const workOrder = workOrders.find(order => order.id === id);
  if (!workOrder || !workOrder.userName) {
    return res.json([]);
  }
  
  // Pronađi TIS ID korisnika
  const tisId = workOrder.tisId;
  if (!tisId) {
    return res.json([]);
  }
  
  // Pronađi opremu koja pripada korisniku
  const equipment = userEquipment.filter(
    item => item.userId === tisId && item.status === 'active'
  );
  
  res.json(equipment);
});

// GET - Dohvati radni nalog po ID-u
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const workOrders = readWorkordersFile();
  
  const workOrder = workOrders.find(order => order.id === id);
  
  if (!workOrder) {
    return res.status(404).json({ error: 'Radni nalog nije pronađen' });
  }
  
  res.json(workOrder);
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

    const workOrders = readWorkordersFile();
    const technicians = readTechniciansFile();
    const users = readUsersFile();
    
    // Mapiranje tehničara po imenu
    const technicianByName = {};
    technicians.forEach(tech => {
      technicianByName[tech.name.toLowerCase()] = tech.id;
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
        let date = '';
        let time = '';
        if (installDateTime) {
          try {
            // Pokušavamo da parsiramo string kao datum
            const parts = installDateTime.split(' ');
            if (parts.length > 0) {
              const dateParts = parts[0].split('/');
              if (dateParts.length === 3) {
                date = new Date(
                  parseInt(dateParts[2], 10),
                  parseInt(dateParts[1], 10) - 1,
                  parseInt(dateParts[0], 10)
                );
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
        let technicianId = '';
        if (technicianName) {
          const techId = technicianByName[technicianName.toLowerCase()];
          if (techId) {
            technicianId = techId;
          }
        }

        // Provera da li radni nalog već postoji
        const duplicateOrder = workOrders.find(order =>
          order.date === (date || new Date().toISOString().split('T')[0]) &&
          order.time === (time || '09:00') &&
          order.municipality === area &&
          order.address === address &&
          order.type === packageName &&
          order.tisId === tisId &&
          order.tisJobId === tisJobId
        );

        if (duplicateOrder) {
          console.log('Radni nalog već postoji, preskačem:', { address, tisId, tisJobId });
          continue; // Preskačemo kreiranje ovog radnog naloga
        }
        
        // Provera da li korisnik već postoji
        let user = users.find(u => u.tisId === tisId);
        
        if (!user && tisId) {
          // Kreiranje novog korisnika
          user = {
            id: uuid.v4(),
            tisId,
            name: userName,
            address,
            phone: userPhone,
            workOrders: []
          };
          users.push(user);
          newUsers.push(user);
        } else if (user) {
          // Ažuriranje postojećeg korisnika
          user.name = userName || user.name;
          user.address = address || user.address;
          user.phone = userPhone || user.phone;
          existingUsers.push(user);
        }
        
        // Kreiranje novog radnog naloga
        const newWorkOrder = {
          id: uuid.v4(),
          date: date || new Date().toISOString().split('T')[0],
          time: time || '09:00',
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
          createdAt: new Date().toISOString()
        };
        
        workOrders.push(newWorkOrder);
        newWorkOrders.push(newWorkOrder);
        
        // Dodavanje radnog naloga korisniku
        if (user) {
          user.workOrders.push(newWorkOrder.id);
        }
        
      } catch (error) {
        console.error('Greška pri obradi reda:', error);
        errors.push(`Greška pri obradi reda: ${JSON.stringify(row)}`);
      }
    }
    
    // Čuvanje ažuriranih podataka
    saveWorkordersFile(workOrders);
    saveUsersFile(users);
    
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
router.post('/', (req, res) => {
  const { 
    date, time, municipality, address, type, technicianId, details, comment,
    technology, tisId, userName, userPhone, tisJobId, additionalJobs 
  } = req.body;
  
  if (!date || !municipality || !address || !type) {
    return res.status(400).json({ error: 'Datum, opština, adresa i tip su obavezna polja' });
  }
  
  // Provera da li tehničar postoji
  if (technicianId) {
    const technicians = readTechniciansFile();
    const technician = technicians.find(tech => tech.id === technicianId);
    
    if (!technician) {
      return res.status(400).json({ error: 'Tehničar nije pronađen' });
    }
  }
  
  const workOrders = readWorkordersFile();
  const users = readUsersFile();
  
  const newWorkOrder = {
    id: uuidv4(),
    date,
    time: time || '09:00',
    municipality,
    address,
    type,
    technicianId,
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
    createdAt: new Date().toISOString()
  };
  
  workOrders.push(newWorkOrder);
  
  // Ako je prosleđen tisId, dodajemo radni nalog korisniku
  if (tisId) {
    // Proveravamo da li korisnik već postoji
    let user = users.find(u => u.tisId === tisId);
    
    // Ako ne postoji, kreiramo novog korisnika
    if (!user) {
      user = {
        id: uuidv4(),
        tisId,
        name: userName || '',
        address: address || '',
        phone: userPhone || '',
        workOrders: [newWorkOrder.id]
      };
      users.push(user);
    } else {
      // Dodajemo radni nalog postojećem korisniku
      user.workOrders.push(newWorkOrder.id);
    }
    
    saveUsersFile(users);
  }
  
  saveWorkordersFile(workOrders);
  
  res.status(201).json(newWorkOrder);
});

// PUT - Ažuriranje radnog naloga (admin)
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const updateData = req.body;
  
  const workOrders = readWorkordersFile();
  const index = workOrders.findIndex(order => order.id === id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Radni nalog nije pronađen' });
  }
  
  // Provera da li tehničar postoji
  if (updateData.technicianId) {
    const technicians = readTechniciansFile();
    const technician = technicians.find(tech => tech.id === updateData.technicianId);
    
    if (!technician && updateData.technicianId !== '') {
      return res.status(400).json({ error: 'Tehničar nije pronađen' });
    }
  }
  
  workOrders[index] = {
    ...workOrders[index],
    ...updateData,
    updatedAt: new Date().toISOString()
  };
  
  saveWorkordersFile(workOrders);
  
  res.json(workOrders[index]);
});

// PUT - Ažuriranje radnog naloga (tehničar)
router.put('/:id/technician-update', (req, res) => {
  const { id } = req.params;
  const { comment, status, postponeDate, postponeTime } = req.body;
  
  const workOrders = readWorkordersFile();
  const index = workOrders.findIndex(order => order.id === id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Radni nalog nije pronađen' });
  }
  
  // Tehničar može da ažurira samo komentar, status i vreme odlaganja
  const updatedWorkOrder = {
    ...workOrders[index],
    comment: comment !== undefined ? comment : workOrders[index].comment,
    updatedAt: new Date().toISOString()
  };
  
  // Ako je status promenjen, ažuriramo i to
  if (status) {
    updatedWorkOrder.status = status;
    
    // Ako je status promenjen na "zavrsen", dodaj timestamp završetka
    if (status === 'zavrsen' && workOrders[index].status !== 'zavrsen') {
      updatedWorkOrder.completedAt = new Date().toISOString();
      updatedWorkOrder.verified = false; // Čeka verifikaciju admina
    } 
    // Ako je status promenjen na "odlozen", dodaj novo vreme i datum
    else if (status === 'odlozen' && workOrders[index].status !== 'odlozen') {
      updatedWorkOrder.postponedAt = new Date().toISOString();
      
            // Ako su dostavljeni novi datum i vreme, ažuriramo ih
      if (postponeDate) {
        updatedWorkOrder.date = postponeDate;
      }
      if (postponeTime) {
        updatedWorkOrder.time = postponeTime;
      }
    }
    // Ako je status "otkazan", dodaj timestamp otkazivanja
    else if (status === 'otkazan' && workOrders[index].status !== 'otkazan') {
      updatedWorkOrder.canceledAt = new Date().toISOString();
    }
  }
  
  workOrders[index] = updatedWorkOrder;
  saveWorkordersFile(workOrders);
  
  res.json(updatedWorkOrder);
});

// POST - Dodavanje slike radnom nalogu
router.post('/:id/images', imageUpload.single('image'), (req, res) => {
  const { id } = req.params;
  
  if (!req.file) {
    return res.status(400).json({ error: 'Slika nije priložena' });
  }
  
  const workOrders = readWorkordersFile();
  const index = workOrders.findIndex(order => order.id === id);
  
  if (index === -1) {
    // Brisanje uploadvane slike ako radni nalog ne postoji
    fs.unlink(req.file.path, err => {
      if (err) console.error('Greška pri brisanju slike:', err);
    });
    return res.status(404).json({ error: 'Radni nalog nije pronađen' });
  }
  
  // URL do slike relativno u odnosu na server
  const imageUrl = `/uploads/images/${path.basename(req.file.path)}`;
  
  if (!workOrders[index].images) {
    workOrders[index].images = [];
  }
  
  workOrders[index].images.push(imageUrl);
  workOrders[index].updatedAt = new Date().toISOString();
  
  saveWorkordersFile(workOrders);
  
  res.json({
    message: 'Slika uspešno dodata',
    workOrder: workOrders[index]
  });
});

// PUT - Verifikacija radnog naloga od strane admina
router.put('/:id/verify', (req, res) => {
  const { id } = req.params;
  
  const workOrders = readWorkordersFile();
  const index = workOrders.findIndex(order => order.id === id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Radni nalog nije pronađen' });
  }
  
  if (workOrders[index].status !== 'zavrsen') {
    return res.status(400).json({ error: 'Samo završeni radni nalozi mogu biti verifikovani' });
  }
  
  workOrders[index].verified = true;
  workOrders[index].verifiedAt = new Date().toISOString();
  
  saveWorkordersFile(workOrders);
  
  res.json({
    message: 'Radni nalog je uspešno verifikovan',
    workOrder: workOrders[index]
  });
});

// POST - Ažuriranje utrošenog materijala za radni nalog
router.post('/:id/used-materials', (req, res) => {
  const { id } = req.params;
  const { materials } = req.body;
  
  if (!Array.isArray(materials)) {
    return res.status(400).json({ error: 'Potrebno je dostaviti niz utrošenih materijala' });
  }
  
  const workOrders = readWorkordersFile();
  const workOrderIndex = workOrders.findIndex(order => order.id === id);
  
  if (workOrderIndex === -1) {
    return res.status(404).json({ error: 'Radni nalog nije pronađen' });
  }
  
  // Dodaj ili ažuriraj listu utrošenih materijala
  workOrders[workOrderIndex].usedMaterials = materials;
  workOrders[workOrderIndex].materialsUpdatedAt = new Date().toISOString();
  
  saveWorkordersFile(workOrders);
  
  res.json({
    message: 'Uspešno ažurirani utrošeni materijali',
    workOrder: workOrders[workOrderIndex]
  });
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
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const workOrders = readWorkordersFile();
  const users = readUsersFile();
  
  const initialLength = workOrders.length;
  const workOrder = workOrders.find(order => order.id === id);
  
  if (!workOrder) {
    return res.status(404).json({ error: 'Radni nalog nije pronađen' });
  }
  
  const filteredWorkOrders = workOrders.filter(order => order.id !== id);
  
  // Uklanjanje referenci na radni nalog iz korisnika
  if (workOrder.tisId) {
    const user = users.find(u => u.tisId === workOrder.tisId);
    if (user) {
      user.workOrders = user.workOrders.filter(orderId => orderId !== id);
      saveUsersFile(users);
    }
  }
  
  saveWorkordersFile(filteredWorkOrders);
  
  res.json({ message: 'Radni nalog uspešno obrisan' });
});

// GET - Dohvati statistiku radnih naloga
router.get('/statistics/summary', (req, res) => {
  const workOrders = readWorkordersFile();
  const technicians = readTechniciansFile();
  
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
      if (!byTechnician[order.technicianId]) {
        byTechnician[order.technicianId] = {
          total: 0,
          completed: 0,
          pending: 0,
          postponed: 0,
          canceled: 0,
          verified: 0
        };
      }
      byTechnician[order.technicianId].total++;
      
      if (order.status === 'zavrsen') {
        byTechnician[order.technicianId].completed++;
        if (order.verified) {
          byTechnician[order.technicianId].verified++;
        }
      } else if (order.status === 'nezavrsen') {
        byTechnician[order.technicianId].pending++;
      } else if (order.status === 'odlozen') {
        byTechnician[order.technicianId].postponed++;
      } else if (order.status === 'otkazan') {
        byTechnician[order.technicianId].canceled++;
      }
    }
  });
  
  // Dodajemo imena tehničara u statistiku
  const technicianDetails = {};
  technicians.forEach(tech => {
    technicianDetails[tech.id] = {
      name: tech.name,
      phone: tech.phone || null,
      email: tech.email || null
    };
  });
  
  // Nedodeljeni radni nalozi
  const unassigned = workOrders.filter(order => !order.technicianId || order.technicianId === '').length;
  
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
});

module.exports = router;