const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Inicijalizacija Express aplikacije
const app = express();
const PORT = process.env.PORT || 5000;


// CORS konfiguracija - DODAJ OVO!
const corsOptions = {
  origin: [
    'http://localhost:3000',           // za lokalni development
    'http://localhost:5173',           // za Vite development
    'https://your-frontend.vercel.app', // zameni sa svojim Vercel URL-om kada ga dobiješ
    'https://robotikb.onrender.com'    // za testiranje backend-a
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Middleware
app.use(cors(corsOptions));
app.use(bodyParser.json());
app.use(morgan('dev'));

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
  limits: { fileSize: 10 * 1024 * 1024 } // Limit na 10MB
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

// Kreiranje početnih JSON fajlova
createEmptyJsonFile('equipment.json');
createEmptyJsonFile('materials.json');
createEmptyJsonFile('technicians.json');
createEmptyJsonFile('workorders.json');
createEmptyJsonFile('users.json');

// Dodaj sledeći kod u server.js, pre definisanja ruta:

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


// Definisanje ruta
app.use('/api/auth', authRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api/materials', materialsRoutes);
app.use('/api/technicians', techniciansRoutes);
app.use('/api/workorders', workordersRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/user-equipment', userEquipmentRouter);

// Osnovna ruta
app.get('/', (req, res) => {
  res.json({ message: 'Dobrodošli na TelCo Inventory Management API' });
});

// Rukovanje greškama
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Došlo je do greške na serveru!' });
});

// Pokretanje servera
app.listen(PORT, () => {
  console.log(`Server pokrenut na portu: ${PORT}`);
});

module.exports = app;