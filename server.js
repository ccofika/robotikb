const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { connectDB, isDBConnected, getConnectionStats } = require('./config/db');
const { startWorkOrderScheduler } = require('./services/workOrderScheduler');
const { startAIAnalysisScheduler } = require('./services/aiAnalysisScheduler');
const { startAITechnicianAnalysisScheduler } = require('./services/aiTechnicianAnalysisScheduler');
const { ensureDBConnection, logSlowQueries, logPerformanceStats } = require('./middleware/dbHealthCheck');
const { performanceLogger, cleanupOldPerformanceLogs } = require('./middleware/performanceLogger');
const { errorLogger } = require('./middleware/errorLogger');
require('dotenv').config();

// Povezivanje sa MongoDB sa optimizovanim pool-om
connectDB();

// Inicijalizacija Express aplikacije
const app = express();
const PORT = process.env.PORT || 5000;

// CORS konfiguracija - ISPRAVKA!
const corsOptions = {
  origin: function (origin, callback) {
    // Dozvoli sve lokalne IP adrese za mobilnu aplikaciju
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:19000',  // Expo dev server
      'http://localhost:19006',  // Expo web
      'http://localhost:8081',   // React Native Metro bundler
      'https://robotik-three.vercel.app',
      'https://robotikb.onrender.com',
      'https://administracija.robotik.rs'
    ];

    // Dozvoli undefined origin (mobilna aplikacija)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    }
    // Dozvoli sve lokalne IP adrese (192.168.x.x, 10.x.x.x, itd.)
    else if (origin && (origin.startsWith('http://192.168.') || origin.startsWith('http://10.') || origin.startsWith('http://172.'))) {
      callback(null, true);
    }
    else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200
};

// Middleware
app.use(cors(corsOptions));
app.use(bodyParser.json());
app.use(morgan('dev'));

// DB connection check middleware for API routes
app.use('/api', ensureDBConnection);

// Slow query detection middleware (log queries > 1000ms)
app.use('/api', logSlowQueries(1000));

// Performance logging middleware - dodato za Backend Logs
app.use('/api', performanceLogger);

// Disable caching completely for instant data updates
app.use((req, res, next) => {
  // Force fresh data on every request
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });
  next();
});

// Health check route with MongoDB connection status
app.get('/', (req, res) => {
  const dbStats = getConnectionStats();
  res.json({
    message: 'TelCo Inventory Management API is running!',
    timestamp: new Date().toISOString(),
    port: PORT,
    cors: 'Dynamic CORS enabled for local IPs',
    database: {
      connected: isDBConnected(),
      ...dbStats
    }
  });
});

// MongoDB connection status endpoint
app.get('/api/health/db', (req, res) => {
  const dbStats = getConnectionStats();
  res.json({
    status: isDBConnected() ? 'connected' : 'disconnected',
    ...dbStats,
    timestamp: new Date().toISOString()
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
const basicEquipmentRoutes = require('./routes/basicEquipment');
const techniciansRoutes = require('./routes/technicians');
const workordersRoutes = require('./routes/workorders');
const exportRoutes = require('./routes/export');
const usersRoutes = require('./routes/users');
const userEquipmentRouter = require('./routes/userEquipment');
const logsRoutes = require('./routes/logs');
const backendLogsRoutes = require('./routes/backendLogs');
const defectiveEquipmentRoutes = require('./routes/defectiveEquipment');
const vehiclesRoutes = require('./routes/vehicles');
const notificationsRoutes = require('./routes/notifications');
const androidNotificationsRoutes = require('./routes/androidNotifications');
const financesRoutes = require('./routes/finances');
const aiAnalysisRoutes = require('./routes/aiAnalysis');
const aiTechnicianAnalysisRoutes = require('./routes/aiTechnicianAnalysis');
const updatesRoutes = require('./routes/updates');
const apkRoutes = require('./routes/apk');
const gpsRoutes = require('./routes/gps');
const reviewsRoutes = require('./routes/reviews');

// Definisanje ruta
app.use('/api/auth', authRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api/materials', materialsRoutes);
app.use('/api/basic-equipment', basicEquipmentRoutes);
app.use('/api/technicians', techniciansRoutes);
app.use('/api/workorders', workordersRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/user-equipment', userEquipmentRouter);
app.use('/api/logs', logsRoutes);
app.use('/api/backend-logs', backendLogsRoutes);
app.use('/api/defective-equipment', defectiveEquipmentRoutes);
app.use('/api/vehicles', vehiclesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/android-notifications', androidNotificationsRoutes);
app.use('/api/finances', financesRoutes);
app.use('/api/ai-analysis', aiAnalysisRoutes);
app.use('/api/ai-technician-analysis', aiTechnicianAnalysisRoutes);
app.use('/api/updates', updatesRoutes);
app.use('/api/apk', apkRoutes);
app.use('/api/gps', gpsRoutes);
app.use('/api/reviews', reviewsRoutes);

// Error logging middleware - dodato za Backend Logs
app.use(errorLogger);

// Rukovanje greškama
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Došlo je do greške na serveru!' });
});

// Pokretanje servera - OPTIMIZOVANO!
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server pokrenut na portu: ${PORT}`);
  console.log(`🌐 CORS omogućen za sve lokalne IP adrese (192.168.x.x, 10.x.x.x)`);

  // Pokretanje scheduler-a za radne naloge
  startWorkOrderScheduler();

  // Pokretanje AI Analysis schedulera (svaki dan u 12:00)
  startAIAnalysisScheduler();

  // Pokretanje AI Technician Analysis schedulera (svaki dan u 13:00)
  startAITechnicianAnalysisScheduler();

  // Log performance stats every 10 minutes
  setInterval(() => {
    logPerformanceStats();
  }, 10 * 60 * 1000);

  // Cleanup starih performance logova jednom dnevno (u 3 AM)
  const scheduleCleanup = () => {
    const now = new Date();
    const next3AM = new Date(now);
    next3AM.setHours(3, 0, 0, 0);

    if (now.getHours() >= 3) {
      next3AM.setDate(next3AM.getDate() + 1);
    }

    const timeUntilCleanup = next3AM.getTime() - now.getTime();

    setTimeout(() => {
      cleanupOldPerformanceLogs();
      // Reschedule za sledeći dan
      setInterval(cleanupOldPerformanceLogs, 24 * 60 * 60 * 1000);
    }, timeUntilCleanup);
  };

  scheduleCleanup();

  console.log(`✅ Server is ready for high-performance operations!`);
  console.log(`📊 Backend logging enabled (Activity, Errors, Performance)`);
});

module.exports = app;