require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const WorkOrder = require('../models/WorkOrder');

const TEST_TECHNICIAN_ID = '699c2ed2eebc37c6a93ae70e';

const municipalities = ['Novi Beograd', 'Zemun', 'Stari Grad', 'Voždovac', 'Čukarica', 'Palilula', 'Zvezdara', 'Rakovica'];
const types = ['Instalacija', 'Servis', 'Demontaža', 'Zamena opreme', 'Aktivacija', 'Reklamacija'];
const addresses = [
  'Bulevar Mihajla Pupina 10',
  'Cara Dušana 55',
  'Knez Mihailova 22',
  'Vojvode Stepe 120',
  'Požeška 83',
  'Takovska 15',
  'Ustanička 44',
  'Bulevar Kralja Aleksandra 73',
  'Jurija Gagarina 28',
  'Gandijeva 99',
];
const technologies = ['GPON', 'HFC', 'VDSL', 'other', 'GPON'];
const userNames = [
  'Marko Petrović', 'Jovana Nikolić', 'Stefan Jovanović', 'Ana Đorđević',
  'Nikola Stojanović', 'Milica Ilić', 'Lazar Popović', 'Teodora Milošević',
  'Aleksandar Pavlović', 'Jelena Stanković'
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Proveri koliko test tehničar već ima naloga
    const existing = await WorkOrder.countDocuments({ technicianId: TEST_TECHNICIAN_ID });
    console.log(`Test technician currently has ${existing} work orders`);

    const workOrders = [];
    const now = new Date();

    // 5 nezavršenih naloga (danas i sutra)
    for (let i = 0; i < 5; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() + (i < 3 ? 0 : 1));
      workOrders.push({
        date,
        time: `${9 + i}:00`,
        municipality: municipalities[i % municipalities.length],
        address: addresses[i % addresses.length],
        type: types[i % types.length],
        technicianId: TEST_TECHNICIAN_ID,
        status: 'nezavrsen',
        details: `Test radni nalog #${i + 1} - ${types[i % types.length]} za korisnika ${userNames[i]}`,
        comment: `Komentar za test nalog ${i + 1}`,
        technology: technologies[i % technologies.length],
        userName: userNames[i],
        userPhone: `06${Math.floor(10000000 + Math.random() * 90000000)}`,
        tisJobId: `TIS-TEST-${1000 + i}`,
      });
    }

    // 3 odložena naloga
    for (let i = 0; i < 3; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() + 2 + i);
      workOrders.push({
        date,
        time: `${10 + i}:00`,
        municipality: municipalities[(5 + i) % municipalities.length],
        address: addresses[(5 + i) % addresses.length],
        type: types[(3 + i) % types.length],
        technicianId: TEST_TECHNICIAN_ID,
        status: 'odlozen',
        details: `Odložen test nalog #${i + 1}`,
        comment: 'Korisnik nije bio kući',
        technology: technologies[(2 + i) % technologies.length],
        userName: userNames[5 + i],
        userPhone: `06${Math.floor(10000000 + Math.random() * 90000000)}`,
        tisJobId: `TIS-TEST-${2000 + i}`,
        postponedUntil: date,
        postponeHistory: [{
          postponedAt: new Date(),
          fromDate: new Date(now),
          fromTime: '09:00',
          toDate: date,
          toTime: `${10 + i}:00`,
          comment: 'Korisnik traži odlaganje',
        }],
      });
    }

    // 2 završena naloga (pre 2h - unutar 24h, treba da budu vidljivi)
    for (let i = 0; i < 2; i++) {
      const date = new Date(now);
      date.setHours(date.getHours() - 2);
      workOrders.push({
        date,
        time: `${8 + i}:00`,
        municipality: municipalities[i],
        address: addresses[i + 3],
        type: types[i],
        technicianId: TEST_TECHNICIAN_ID,
        status: 'zavrsen',
        details: `Završen test nalog #${i + 1}`,
        technology: technologies[i],
        userName: userNames[8 + i],
        userPhone: `06${Math.floor(10000000 + Math.random() * 90000000)}`,
        tisJobId: `TIS-TEST-${3000 + i}`,
        statusChangedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        completedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      });
    }

    const created = await WorkOrder.insertMany(workOrders);
    console.log(`\n✅ Created ${created.length} test work orders for test technician:`);
    console.log(`   - 5 nezavršen (active)`);
    console.log(`   - 3 odložen (postponed)`);
    console.log(`   - 2 završen (completed 2h ago)`);
    console.log(`\nTotal work orders for test technician: ${existing + created.length}`);

    await mongoose.connection.close();
    console.log('\nDone.');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

seed();
