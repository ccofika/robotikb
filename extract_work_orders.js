const mongoose = require('mongoose');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// WorkOrder model definicija
const WorkOrderSchema = new mongoose.Schema({
  date: Date,
  time: String,
  municipality: String,
  address: String,
  type: String,
  technicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'Technician' },
  technician2Id: { type: mongoose.Schema.Types.ObjectId, ref: 'Technician' },
  details: String,
  comment: String,
  status: {
    type: String,
    enum: ['zavrsen', 'nezavrsen', 'otkazan', 'odlozen'],
    default: 'nezavrsen'
  },
  statusChangedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Technician' },
  statusChangedAt: Date,
  postponeDateTime: Date,
  postponeComment: String,
  tisId: String,
  tisJobId: String,
  userName: String,
  userPhone: String,
  userEmail: String,
  description: String,
  notes: String,
  verified: { type: Boolean, default: false },
  verifiedAt: Date,
  adminComment: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

const WorkOrder = mongoose.model('WorkOrder', WorkOrderSchema);

async function extractWorkOrders() {
  try {
    console.log('🔗 Povezujem se na MongoDB bazu...');

    // Povezivanje na bazu
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Povezano na MongoDB bazu!');

    // Datum od kada tražimo naloge (1. oktobar 2025)
    const startDate = new Date('2025-10-01T00:00:00.000Z');
    console.log(`📅 Tražim radne naloge kreirane od: ${startDate.toISOString()}`);

    // Izvlačenje radnih naloga
    console.log('📊 Izvlačim radne naloge...');

    const workOrders = await WorkOrder.find({
      createdAt: { $gte: startDate }
    }).sort({ createdAt: -1 });

    console.log(`📦 Pronađeno ${workOrders.length} radnih naloga kreiranih od 1. oktobra 2025.`);

    if (workOrders.length === 0) {
      console.log('ℹ️  Nema radnih naloga za izvoz.');
      await mongoose.disconnect();
      return;
    }

    // Kreiranje sadržaja za fajl - POJEDNOSTAVLJENO
    let fileContent = `RADNI NALOZI KREIRANI OD 1. OKTOBRA 2025.\n`;
    fileContent += `Datum izvoza: ${new Date().toLocaleString('sr-RS')}\n`;
    fileContent += `Ukupno naloga: ${workOrders.length}\n`;
    fileContent += `=====================================\n\n`;

    workOrders.forEach((order, index) => {
      fileContent += `${index + 1}. ID: ${order._id} | TIS: ${order.tisJobId || 'N/A'} | Tehničar 1: ${order.technicianId || 'N/A'} | Tehničar 2: ${order.technician2Id || 'N/A'}\n`;
    });

    // Statistike po statusu
    const statusStats = workOrders.reduce((acc, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1;
      return acc;
    }, {});

    fileContent += `STATISTIKE PO STATUSU:\n`;
    Object.entries(statusStats).forEach(([status, count]) => {
      fileContent += `   ${status}: ${count} naloga\n`;
    });
    fileContent += `\n`;

    // Statistike po verifikaciji
    const verifiedCount = workOrders.filter(order => order.verified).length;
    const unverifiedCount = workOrders.length - verifiedCount;

    fileContent += `STATISTIKE PO VERIFIKACIJI:\n`;
    fileContent += `   Verifikovan: ${verifiedCount} naloga\n`;
    fileContent += `   Neverifikovan: ${unverifiedCount} naloga\n`;
    fileContent += `\n`;

    // Čuvanje u fajl
    const fileName = 'radni_nalozi_od_1_oktobra_2024.txt';
    const filePath = path.join(__dirname, fileName);

    fs.writeFileSync(filePath, fileContent, 'utf8');

    console.log(`💾 Lista sačuvana u fajl: ${fileName}`);
    console.log(`📍 Lokacija: ${filePath}`);

    // Ispisivanje statistika u konzoli
    console.log('\n📊 STATISTIKE:');
    console.log(`   Ukupno naloga: ${workOrders.length}`);
    console.log(`   Verifikovano: ${verifiedCount}`);
    console.log(`   Neverifikovano: ${unverifiedCount}`);
    console.log('\n   Po statusu:');
    Object.entries(statusStats).forEach(([status, count]) => {
      console.log(`     ${status}: ${count}`);
    });

    await mongoose.disconnect();
    console.log('🔚 Konekcija zatvorena. Proces završen!');

  } catch (error) {
    console.error('❌ Greška:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Pokretanje skripte
extractWorkOrders();