const mongoose = require('mongoose');
require('dotenv').config();

// Configure Mongoose settings FIRST
mongoose.set('bufferCommands', false);  // Disable command buffering
mongoose.set('strictQuery', false);     // Disable strict query warnings

// Connection state tracking
let isConnected = false;
let connectionAttempts = 0;
const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 seconds

// Optimized connection configuration (compatible with all Mongoose versions)
const connectionOptions = {
  // Connection Pool Configuration
  maxPoolSize: 20,        // Reduced for stability
  minPoolSize: 2,         // Minimum connections
  maxIdleTimeMS: 30000,   // Close idle connections
  serverSelectionTimeoutMS: 10000, // Increased timeout

  // Connection timeouts
  connectTimeoutMS: 15000, // Longer initial connection timeout
  socketTimeoutMS: 0,     // No socket timeout (let MongoDB handle)

  // Required options
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

const connectDB = async () => {
  if (isConnected) {
    console.log('MongoDB već povezan - koristi postojeću konekciju');
    return mongoose.connection;
  }

  try {
    connectionAttempts++;
    console.log(`MongoDB konekcija pokušaj ${connectionAttempts}/${MAX_RETRIES}`);

    const conn = await mongoose.connect(process.env.MONGODB_URI, connectionOptions);

    isConnected = true;
    connectionAttempts = 0; // Reset counter on successful connection

    console.log(`MongoDB uspešno povezan: ${conn.connection.host}`);
    console.log(`✅ Connection pool konfiguracija:`);
    console.log(`   📊 maxPoolSize: ${connectionOptions.maxPoolSize}`);
    console.log(`   📈 minPoolSize: ${connectionOptions.minPoolSize}`);
    console.log(`   ⏱️  maxIdleTimeMS: ${connectionOptions.maxIdleTimeMS}ms`);
    console.log(`   🚫 Command buffering disabled`);
    console.log(`   🔗 Connection reuse enabled`);
    console.log(`   ⚙️  Mongoose version: ${mongoose.version}`);

    // Monitor connection events
    setupConnectionMonitoring();

    return conn.connection;

  } catch (error) {
    console.error(`MongoDB konekcija neuspešna (pokušaj ${connectionAttempts}):`, error.message);
    isConnected = false;

    if (connectionAttempts < MAX_RETRIES) {
      console.log(`Ponovni pokušaj za ${RETRY_DELAY / 1000} sekundi...`);
      setTimeout(() => {
        connectDB();
      }, RETRY_DELAY);
    } else {
      console.error('Maksimalan broj pokušaja dostignut. Prekidam aplikaciju.');
      process.exit(1);
    }
  }
};

// Connection monitoring and event handling
const setupConnectionMonitoring = () => {
  const db = mongoose.connection;

  // Connection events
  db.on('connected', () => {
    console.log('MongoDB: Konekcija uspostavljena');
    isConnected = true;
  });

  db.on('disconnected', () => {
    console.log('MongoDB: Konekcija prekinuta');
    isConnected = false;
  });

  db.on('reconnected', () => {
    console.log('MongoDB: Konekcija obnovljena');
    isConnected = true;
  });

  db.on('error', (error) => {
    console.error('MongoDB greška:', error.message);
    isConnected = false;
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    try {
      await mongoose.connection.close();
      console.log('MongoDB konekcija zatvorena zbog prekida aplikacije');
      process.exit(0);
    } catch (error) {
      console.error('Greška pri zatvaranju MongoDB konekcije:', error.message);
      process.exit(1);
    }
  });

  // Log connection pool status every 5 minutes
  setInterval(() => {
    if (isConnected) {
      const poolStatus = {
        readyState: db.readyState,
        name: db.name,
        host: db.host,
        port: db.port
      };
      console.log('MongoDB Pool Status:', poolStatus);
    }
  }, 5 * 60 * 1000); // 5 minutes
};

// Utility function to check connection status
const isDBConnected = () => {
  return isConnected && mongoose.connection.readyState === 1;
};

// Utility function to get connection stats
const getConnectionStats = () => {
  const db = mongoose.connection;
  return {
    isConnected: isConnected,
    readyState: db.readyState,
    name: db.name,
    host: db.host,
    port: db.port,
    poolSize: connectionOptions.maxPoolSize,
    minPoolSize: connectionOptions.minPoolSize
  };
};

module.exports = {
  connectDB,
  isDBConnected,
  getConnectionStats
}; 