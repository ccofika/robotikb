const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Importovanje modela
const { User, Technician, Material, Equipment, WorkOrder } = require('../models');

// Putanje do JSON fajlova
const usersFilePath = path.join(__dirname, '../data/users.json');
const techniciansFilePath = path.join(__dirname, '../data/technicians.json');
const materialsFilePath = path.join(__dirname, '../data/materials.json');
const equipmentFilePath = path.join(__dirname, '../data/equipment.json');
const workordersFilePath = path.join(__dirname, '../data/workorders.json');

// Funkcija za čitanje JSON fajla
const readJsonFile = (filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Greška pri čitanju fajla ${filePath}:`, error);
    return [];
  }
};

// Funkcija za povezivanje sa MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB konekcija uspešna');
  } catch (error) {
    console.error('Greška pri povezivanju sa MongoDB:', error.message);
    process.exit(1);
  }
};

// Funkcija za migraciju tehničara
const migrateTechnicians = async () => {
  try {
    const technicians = readJsonFile(techniciansFilePath);
    console.log(`Migracija ${technicians.length} tehničara...`);
    
    // Mapa za čuvanje starih i novih ID-jeva
    const technicianIdMap = new Map();
    
    // Brisanje svih postojećih tehničara
    await Technician.deleteMany({});
    
    // Kreiranje novih tehničara
    for (const tech of technicians) {
      const newTechnician = new Technician({
        name: tech.name,
        password: tech.password,
        materials: [], // Popunićemo kasnije
        isAdmin: tech.name.toLowerCase() === 'admin'
      });
      
      if (tech.createdAt) {
        newTechnician.createdAt = new Date(tech.createdAt);
      }
      
      if (tech.updatedAt) {
        newTechnician.updatedAt = new Date(tech.updatedAt);
      }
      
      const savedTechnician = await newTechnician.save();
      technicianIdMap.set(tech.id, savedTechnician._id);
    }
    
    console.log('Tehničari uspešno migrirani');
    return technicianIdMap;
  } catch (error) {
    console.error('Greška pri migraciji tehničara:', error);
    throw error;
  }
};

// Funkcija za migraciju korisnika
const migrateUsers = async () => {
  try {
    const users = readJsonFile(usersFilePath);
    console.log(`Migracija ${users.length} korisnika...`);
    
    // Mapa za čuvanje starih i novih ID-jeva
    const userIdMap = new Map();
    
    // Brisanje svih postojećih korisnika
    await User.deleteMany({});
    
    // Kreiranje novih korisnika
    for (const user of users) {
      const newUser = new User({
        tisId: user.tisId,
        name: user.name,
        address: user.address,
        phone: user.phone,
        workOrders: [] // Popunićemo kasnije
      });
      
      const savedUser = await newUser.save();
      userIdMap.set(user.id, savedUser._id);
    }
    
    console.log('Korisnici uspešno migrirani');
    return userIdMap;
  } catch (error) {
    console.error('Greška pri migraciji korisnika:', error);
    throw error;
  }
};

// Funkcija za migraciju materijala
const migrateMaterials = async () => {
  try {
    const materials = readJsonFile(materialsFilePath);
    console.log(`Migracija ${materials.length} materijala...`);
    
    // Mapa za čuvanje starih i novih ID-jeva
    const materialIdMap = new Map();
    
    // Brisanje svih postojećih materijala
    await Material.deleteMany({});
    
    // Kreiranje novih materijala
    for (const material of materials) {
      const newMaterial = new Material({
        type: material.type,
        quantity: material.quantity
      });
      
      const savedMaterial = await newMaterial.save();
      materialIdMap.set(material.id, savedMaterial._id);
    }
    
    console.log('Materijali uspešno migrirani');
    return materialIdMap;
  } catch (error) {
    console.error('Greška pri migraciji materijala:', error);
    throw error;
  }
};

// Funkcija za migraciju opreme
const migrateEquipment = async (technicianIdMap) => {
  try {
    const equipment = readJsonFile(equipmentFilePath);
    console.log(`Migracija ${equipment.length} opreme...`);
    
    // Mapa za čuvanje starih i novih ID-jeva
    const equipmentIdMap = new Map();
    
    // Brisanje sve postojeće opreme
    await Equipment.deleteMany({});
    
    // Kreiranje nove opreme
    for (const item of equipment) {
      const newEquipment = new Equipment({
        category: item.category,
        description: item.description,
        serialNumber: item.serialNumber,
        location: item.location,
        status: item.status
      });
      
      // Ako je oprema dodeljena tehničaru
      if (item.location && item.location.startsWith('tehnicar-')) {
        const techId = item.location.replace('tehnicar-', '');
        if (technicianIdMap.has(techId)) {
          newEquipment.assignedTo = technicianIdMap.get(techId);
        }
      }
      
      const savedEquipment = await newEquipment.save();
      equipmentIdMap.set(item.id, savedEquipment._id);
    }
    
    console.log('Oprema uspešno migrirana');
    return equipmentIdMap;
  } catch (error) {
    console.error('Greška pri migraciji opreme:', error);
    throw error;
  }
};

// Funkcija za migraciju radnih naloga
const migrateWorkOrders = async (userIdMap, technicianIdMap) => {
  try {
    const workOrders = readJsonFile(workordersFilePath);
    console.log(`Migracija ${workOrders.length} radnih naloga...`);
    
    // Mapa za čuvanje starih i novih ID-jeva
    const workOrderIdMap = new Map();
    
    // Brisanje svih postojećih radnih naloga
    await WorkOrder.deleteMany({});
    
    // Kreiranje novih radnih naloga
    for (const order of workOrders) {
      // Pronalaženje korisnika prema tisId
      const user = await User.findOne({ tisId: order.tisId });
      
      if (!user) {
        console.warn(`Korisnik sa tisId ${order.tisId} nije pronađen za radni nalog ${order.id}`);
        continue;
      }
      
      const newWorkOrder = new WorkOrder({
        date: new Date(order.date),
        time: order.time,
        municipality: order.municipality,
        address: order.address,
        type: order.type,
        details: order.details,
        comment: order.comment,
        status: order.status,
        technology: order.technology,
        tisId: order.tisId,
        userName: order.userName,
        userPhone: order.userPhone,
        tisJobId: order.tisJobId,
        additionalJobs: order.additionalJobs,
        images: order.images,
        verified: order.verified,
        user: user._id,
        equipment: [],
        materials: []
      });
      
      // Povezivanje sa tehničarom ako postoji
      if (order.technicianId && technicianIdMap.has(order.technicianId)) {
        newWorkOrder.technicianId = technicianIdMap.get(order.technicianId);
      }
      
      if (order.createdAt) {
        newWorkOrder.createdAt = new Date(order.createdAt);
      }
      
      const savedWorkOrder = await newWorkOrder.save();
      workOrderIdMap.set(order.id, savedWorkOrder._id);
      
      // Dodajemo radni nalog korisniku
      user.workOrders.push(savedWorkOrder._id);
      await user.save();
    }
    
    console.log('Radni nalozi uspešno migrirani');
    return workOrderIdMap;
  } catch (error) {
    console.error('Greška pri migraciji radnih naloga:', error);
    throw error;
  }
};

// Glavna funkcija za migraciju svih podataka
const migrateAllData = async () => {
  try {
    await connectDB();
    
    console.log('Započinjem migraciju podataka...');
    
    // Migracija tehničara
    const technicianIdMap = await migrateTechnicians();
    
    // Migracija korisnika
    const userIdMap = await migrateUsers();
    
    // Migracija materijala
    const materialIdMap = await migrateMaterials();
    
    // Migracija opreme
    const equipmentIdMap = await migrateEquipment(technicianIdMap);
    
    // Migracija radnih naloga
    const workOrderIdMap = await migrateWorkOrders(userIdMap, technicianIdMap);
    
    console.log('Migracija podataka uspešno završena!');
    
    // Zatvaranje konekcije
    await mongoose.connection.close();
    console.log('MongoDB konekcija zatvorena');
    
    process.exit(0);
  } catch (error) {
    console.error('Greška pri migraciji podataka:', error);
    process.exit(1);
  }
};

// Pokretanje migracije
migrateAllData(); 