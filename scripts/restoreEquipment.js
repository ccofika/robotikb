/**
 * Skripta za restauraciju pogrešno prebačene opreme
 * Vraća opremu koja je bila instalirana kod korisnika nazad tehničaru
 */

const mongoose = require('mongoose');
const Equipment = require('../models/Equipment');
const Technician = require('../models/Technician');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const VIRTUAL_WAREHOUSE_PATH = path.join(__dirname, '..', '..', 'robotikf', 'src', 'data', 'virtual_warehouse_equipment.json');

async function restoreFromBackup(backupFilePath) {
  try {
    const uri = process.env.MONGODB_URI;
    await mongoose.connect(uri);
    console.log('Povezano sa MongoDB bazom\n');

    // Učitavanje backup fajla
    const backupData = JSON.parse(fs.readFileSync(backupFilePath, 'utf8'));
    const technicianId = backupData.technician.id;
    const technicianName = backupData.technician.name;

    console.log(`=== RESTAURACIJA ZA: ${technicianName} ===\n`);

    // Pronalaženje opreme koja je bila instalirana (i pogrešno prebačena)
    const installedEquipment = backupData.equipment.filter(e =>
      e.status === 'installed' || e.assignedToUser
    );

    console.log(`Oprema za restauraciju (installed/assignedToUser): ${installedEquipment.length}\n`);

    if (installedEquipment.length === 0) {
      console.log('Nema opreme za restauraciju.');
      return;
    }

    // Vraćanje u bazu
    let restoredCount = 0;
    const serialNumbersToRemove = [];

    for (const eq of installedEquipment) {
      // Vraćanje originalnih vrednosti u bazi
      const updateResult = await Equipment.updateOne(
        { _id: eq._id },
        {
          $set: {
            assignedTo: new mongoose.Types.ObjectId(technicianId),
            status: eq.status,
            location: eq.location,
            assignedToUser: eq.assignedToUser
          }
        }
      );

      if (updateResult.modifiedCount > 0) {
        restoredCount++;
        serialNumbersToRemove.push(eq.serialNumber.toLowerCase());
      }
    }

    console.log(`Vraćeno u bazu: ${restoredCount} komada opreme`);

    // Uklanjanje iz virtuelnog magacina JSON
    let virtualWarehouse = [];
    if (fs.existsSync(VIRTUAL_WAREHOUSE_PATH)) {
      virtualWarehouse = JSON.parse(fs.readFileSync(VIRTUAL_WAREHOUSE_PATH, 'utf8'));
    }

    const originalCount = virtualWarehouse.length;

    // Filtriranje - uklanjamo one koje smo upravo vratili
    virtualWarehouse = virtualWarehouse.filter(item => {
      const sn = item.serialNumber.toLowerCase();
      return !serialNumbersToRemove.includes(sn);
    });

    const removedFromJson = originalCount - virtualWarehouse.length;

    // Čuvanje ažuriranog JSON-a
    fs.writeFileSync(VIRTUAL_WAREHOUSE_PATH, JSON.stringify(virtualWarehouse, null, 2), 'utf8');

    console.log(`Uklonjeno iz virtuelnog magacina: ${removedFromJson} komada`);
    console.log(`Virtuelni magacin sada ima: ${virtualWarehouse.length} komada`);

    // Verifikacija
    const techEquipmentCount = await Equipment.countDocuments({
      assignedTo: new mongoose.Types.ObjectId(technicianId)
    });
    console.log(`\nOprema kod tehničara posle restauracije: ${techEquipmentCount}`);

  } catch (error) {
    console.error('Greška:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nKonekcija zatvorena');
  }
}

// Main
const backupFile = process.argv[2];
if (!backupFile) {
  console.log('Korišćenje: node restoreEquipment.js <backup_file.json>');
  process.exit(1);
}

restoreFromBackup(backupFile);
