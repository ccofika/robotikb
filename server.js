const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const connectDB = require('./config/db');
const { startWorkOrderScheduler } = require('./services/workOrderScheduler');
require('dotenv').config();

// Povezivanje sa MongoDB
connectDB();

// Inicijalizacija Express aplikacije
const app = express();
const PORT = process.env.PORT || 5000;

// CORS konfiguracija - ISPRAVKA!
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://robotik-three.vercel.app',  // UKLONJENO "/" na kraju!
    'https://robotikb.onrender.com'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200 // Za starije browsere
};

// Middleware
app.use(cors(corsOptions));
app.use(bodyParser.json());
app.use(morgan('dev'));

// Test route - dodaj na vrh da testiraš
app.get('/', (req, res) => {
  res.json({ 
    message: 'TelCo Inventory Management API is running!',
    timestamp: new Date().toISOString(),
    port: PORT,
    cors: corsOptions.origin
  });
});

app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  
  // Lista dozvoljenih fajlova (bezbednost)
  const allowedFiles = [
    'equipment.json',
    'materials.json', 
    'technicians.json',
    'userequipment.json',
    'users.json',
    'workorders.json'
  ];
  
  // Proveri da li je fajl dozvoljen
  if (!allowedFiles.includes(filename)) {
    return res.status(400).send('Invalid file requested');
  }
  
  const filePath = path.join(__dirname, 'data', filename);
  
  // Proveri da li fajl postoji
  if (fs.existsSync(filePath)) {
    res.download(filePath, filename);
  } else {
    res.status(404).send('File not found');
  }
});

// Endpoint da vrati listu dostupnih fajlova
app.get('/files', (req, res) => {
  const allowedFiles = [
    'equipment.json',
    'materials.json', 
    'technicians.json',
    'userequipment.json',
    'users.json',
    'workorders.json'
  ];
  res.json({ availableFiles: allowedFiles });
});

// Konfiguracija za upload fajlova
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)){
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Kreiranje direktorijuma za podatke ako ne postoji
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// Inicijalizacija JSON fajlova ako ne postoje
const createEmptyJsonFile = (filename, initialData = []) => {
  const filePath = path.join(dataDir, filename);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(initialData, null, 2));
    console.log(`Created empty JSON file: ${filename}`);
  }
};


// Osiguraj da svi potrebni direktorijumi postoje
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const imagesDir = path.join(uploadsDir, 'images');
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir);
}

const workordersUploadsDir = path.join(uploadsDir, 'workorders');
if (!fs.existsSync(workordersUploadsDir)) {
  fs.mkdirSync(workordersUploadsDir);
}

const templatesDir = path.join(__dirname, 'templates');
if (!fs.existsSync(templatesDir)) {
  fs.mkdirSync(templatesDir);
}

// Import ruta
const authRoutes = require('./routes/auth');
const equipmentRoutes = require('./routes/equipment');
const materialsRoutes = require('./routes/materials');
const techniciansRoutes = require('./routes/technicians');
const workordersRoutes = require('./routes/workorders');
const exportRoutes = require('./routes/export');
const usersRoutes = require('./routes/users');
const userEquipmentRouter = require('./routes/userEquipment');
const logsRoutes = require('./routes/logs');
const defectiveEquipmentRoutes = require('./routes/defectiveEquipment');
const vehiclesRoutes = require('./routes/vehicles');

// Definisanje ruta
app.use('/api/auth', authRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api/materials', materialsRoutes);
app.use('/api/technicians', techniciansRoutes);
app.use('/api/workorders', workordersRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/user-equipment', userEquipmentRouter);
app.use('/api/logs', logsRoutes);
app.use('/api/defective-equipment', defectiveEquipmentRoutes);
app.use('/api/vehicles', vehiclesRoutes);

// Rukovanje greškama
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Došlo je do greške na serveru!' });
});

// Pokretanje servera - ISPRAVKA!
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server pokrenut na portu: ${PORT}`);
  console.log(`CORS omogućen za: ${corsOptions.origin.join(', ')}`);
  
  // Pokretanje scheduler-a za radne naloge
  startWorkOrderScheduler();
});

module.exports = app;