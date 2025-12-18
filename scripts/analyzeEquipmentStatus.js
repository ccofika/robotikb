/**
 * Skripta za analizu statusa opreme - provera da li je oprema kod korisnika
 */

const mongoose = require('mongoose');
const Equipment = require('../models/Equipment');
const Technician = require('../models/Technician');
const WorkOrder = require('../models/WorkOrder');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function analyzeEquipment(technicianName) {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI nije definisan u .env fajlu');
    }

    await mongoose.connect(uri);
    console.log('Povezano sa MongoDB bazom\n');

    const technician = await Technician.findOne({ name: technicianName });
    if (!technician) {
      console.log(`Tehničar "${technicianName}" nije pronađen!`);
      return;
    }

    console.log(`=== ANALIZA OPREME ZA: ${technician.name} ===\n`);

    // Dohvatanje sve opreme tehničara
    const allEquipment = await Equipment.find({
      assignedTo: technician._id
    });

    console.log(`Ukupno opreme: ${allEquipment.length}\n`);

    // Analiza po statusu
    const statusStats = {};
    allEquipment.forEach(e => {
      const status = e.status || 'unknown';
      statusStats[status] = (statusStats[status] || 0) + 1;
    });

    console.log('=== RASPODELA PO STATUSU ===');
    Object.entries(statusStats).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });

    // Oprema koja ima assignedToUser
    const withUser = allEquipment.filter(e => e.assignedToUser);
    console.log(`\n=== OPREMA SA assignedToUser: ${withUser.length} ===`);
    if (withUser.length > 0) {
      withUser.slice(0, 10).forEach(e => {
        console.log(`  - ${e.serialNumber} | status: ${e.status} | user: ${e.assignedToUser}`);
      });
      if (withUser.length > 10) console.log(`  ... i još ${withUser.length - 10}`);
    }

    // Oprema sa statusom 'installed'
    const installed = allEquipment.filter(e => e.status === 'installed');
    console.log(`\n=== OPREMA SA STATUS 'installed': ${installed.length} ===`);
    if (installed.length > 0) {
      installed.slice(0, 10).forEach(e => {
        console.log(`  - ${e.serialNumber} | installedAt: ${e.installedAt ? e.installedAt.toISOString().split('T')[0] : 'N/A'}`);
      });
      if (installed.length > 10) console.log(`  ... i još ${installed.length - 10}`);
    }

    // Provera opreme u radnim nalozima (installedEquipment)
    const equipmentIds = allEquipment.map(e => e._id);

    const workOrdersWithEquipment = await WorkOrder.find({
      'installedEquipment.equipmentId': { $in: equipmentIds }
    }).select('tisJobId address installedEquipment status');

    console.log(`\n=== OPREMA U RADNIM NALOZIMA (installedEquipment): ===`);

    let equipmentInWorkOrders = new Set();
    workOrdersWithEquipment.forEach(wo => {
      wo.installedEquipment.forEach(ie => {
        if (equipmentIds.some(id => id.equals(ie.equipmentId))) {
          equipmentInWorkOrders.add(ie.equipmentId.toString());
        }
      });
    });

    console.log(`Broj komada opreme u radnim nalozima: ${equipmentInWorkOrders.size}`);

    if (equipmentInWorkOrders.size > 0) {
      console.log('\nPrimeri:');
      let count = 0;
      for (const eqId of equipmentInWorkOrders) {
        if (count >= 10) break;
        const eq = allEquipment.find(e => e._id.toString() === eqId);
        if (eq) {
          console.log(`  - ${eq.serialNumber} | status: ${eq.status}`);
          count++;
        }
      }
      if (equipmentInWorkOrders.size > 10) {
        console.log(`  ... i još ${equipmentInWorkOrders.size - 10}`);
      }
    }

    // SAŽETAK - oprema koja NE TREBA da se prebaci
    console.log('\n========================================');
    console.log('SAŽETAK - OPREMA KOJA NE TREBA DA SE PREBACI');
    console.log('========================================');

    const doNotMove = new Set();

    // 1. Oprema sa assignedToUser
    withUser.forEach(e => doNotMove.add(e._id.toString()));

    // 2. Oprema sa status 'installed'
    installed.forEach(e => doNotMove.add(e._id.toString()));

    // 3. Oprema u radnim nalozima
    equipmentInWorkOrders.forEach(id => doNotMove.add(id));

    console.log(`\nUkupno opreme koja NE TREBA da se prebaci: ${doNotMove.size}`);
    console.log(`  - Sa assignedToUser: ${withUser.length}`);
    console.log(`  - Sa status 'installed': ${installed.length}`);
    console.log(`  - U radnim nalozima: ${equipmentInWorkOrders.size}`);
    console.log(`  (Neki se mogu preklapati)`);

    // Oprema koju je OK prebaciti
    const okToMove = allEquipment.filter(e => !doNotMove.has(e._id.toString()));
    console.log(`\nOprema koju je SIGURNO prebaciti: ${okToMove.length}`);

  } catch (error) {
    console.error('Greška:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nKonekcija zatvorena');
  }
}

// Provera svih tehničara
async function analyzeAllTechnicians() {
  try {
    const uri = process.env.MONGODB_URI;
    await mongoose.connect(uri);
    console.log('Povezano sa MongoDB bazom\n');

    const technicians = await Technician.find({});

    console.log('=== ANALIZA SVIH TEHNIČARA ===\n');
    console.log('Ime                              | Ukupno | assigned | installed | sa User');
    console.log('---------------------------------|--------|----------|-----------|--------');

    for (const tech of technicians) {
      const equipment = await Equipment.find({ assignedTo: tech._id });
      if (equipment.length === 0) continue;

      const assigned = equipment.filter(e => e.status === 'assigned').length;
      const installed = equipment.filter(e => e.status === 'installed').length;
      const withUser = equipment.filter(e => e.assignedToUser).length;

      const name = tech.name.padEnd(32);
      console.log(`${name} | ${String(equipment.length).padStart(6)} | ${String(assigned).padStart(8)} | ${String(installed).padStart(9)} | ${String(withUser).padStart(6)}`);
    }

  } catch (error) {
    console.error('Greška:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nKonekcija zatvorena');
  }
}

// Main
const args = process.argv.slice(2);
if (args[0] === '--all') {
  analyzeAllTechnicians();
} else if (args[0]) {
  analyzeEquipment(args[0]);
} else {
  console.log('Korišćenje:');
  console.log('  node analyzeEquipmentStatus.js "Ime Tehničara"  - Analiza jednog tehničara');
  console.log('  node analyzeEquipmentStatus.js --all            - Pregled svih tehničara');
}
