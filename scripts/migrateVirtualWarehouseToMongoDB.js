/**
 * Migracija virtuelnog magacina iz JSON fajla u MongoDB
 *
 * Ova skripta:
 * 1. Čita postojeći JSON fajl sa opremom
 * 2. Za svaku opremu pronalazi zapis u MongoDB po serijskom broju
 * 3. Ažurira location na 'virtuelni_magacin' i čuva previousAssignedTo
 */

const mongoose = require('mongoose');
const Equipment = require('../models/Equipment');
const Technician = require('../models/Technician');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const VIRTUAL_WAREHOUSE_PATH = path.join(__dirname, '..', '..', 'robotikf', 'src', 'data', 'virtual_warehouse_equipment.json');

async function migrateVirtualWarehouse() {
  try {
    const uri = process.env.MONGODB_URI;
    await mongoose.connect(uri);
    console.log('Povezano sa MongoDB bazom\n');

    // Učitaj JSON fajl
    if (!fs.existsSync(VIRTUAL_WAREHOUSE_PATH)) {
      console.log('JSON fajl ne postoji:', VIRTUAL_WAREHOUSE_PATH);
      return;
    }

    const jsonData = JSON.parse(fs.readFileSync(VIRTUAL_WAREHOUSE_PATH, 'utf8'));
    console.log(`Pronađeno ${jsonData.length} komada opreme u JSON fajlu\n`);

    // Dohvati sve tehničare za mapiranje
    const technicians = await Technician.find({}).select('_id name');
    const technicianMap = {};
    technicians.forEach(t => {
      technicianMap[t._id.toString()] = t.name;
    });

    let updated = 0;
    let notFound = 0;
    let alreadyMigrated = 0;
    let errors = [];

    for (const item of jsonData) {
      try {
        // Pronađi opremu po serijskom broju (case-insensitive)
        const serialLower = item.serialNumber.toLowerCase();
        const equipment = await Equipment.findOne({
          serialNumber: { $regex: new RegExp(`^${serialLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
        });

        if (!equipment) {
          // Kreiraj novu opremu ako ne postoji u bazi
          // Izvuci ID tehničara iz lokacije
          let technicianId = null;
          if (item.location && item.location.startsWith('tehnicar-')) {
            const techId = item.location.replace('tehnicar-', '');
            if (mongoose.Types.ObjectId.isValid(techId) && techId !== 'undefined') {
              technicianId = new mongoose.Types.ObjectId(techId);
            }
          }

          const newEquipment = new Equipment({
            category: item.category || 'Nepoznato',
            description: item.description || item.category || 'Nepoznato',
            serialNumber: item.serialNumber.toLowerCase(),
            location: 'virtuelni_magacin',
            status: 'available',
            assignedTo: null,
            previousAssignedTo: technicianId,
            movedToVirtualWarehouseAt: item.movedAt ? new Date(item.movedAt) : new Date()
          });

          await newEquipment.save();
          updated++;
          continue;
        }

        // Proveri da li je već migrirana
        if (equipment.location === 'virtuelni_magacin') {
          alreadyMigrated++;
          continue;
        }

        // Izvuci ID tehničara iz lokacije (format: "tehnicar-ID")
        let technicianId = null;
        if (item.location && item.location.startsWith('tehnicar-')) {
          technicianId = item.location.replace('tehnicar-', '');
          // Validiraj da je to validan ObjectId
          if (mongoose.Types.ObjectId.isValid(technicianId)) {
            technicianId = new mongoose.Types.ObjectId(technicianId);
          } else {
            technicianId = null;
          }
        }

        // Ažuriraj opremu
        equipment.location = 'virtuelni_magacin';
        equipment.status = 'available';
        equipment.assignedTo = null;

        // Sačuvaj prethodnog tehničara
        if (technicianId) {
          equipment.previousAssignedTo = technicianId;
        }

        // Sačuvaj datum prebacivanja ako postoji u JSON-u
        if (item.movedAt) {
          equipment.movedToVirtualWarehouseAt = new Date(item.movedAt);
        } else {
          equipment.movedToVirtualWarehouseAt = new Date();
        }

        await equipment.save();
        updated++;

      } catch (err) {
        errors.push(`Greška za SN ${item.serialNumber}: ${err.message}`);
      }
    }

    console.log('========================================');
    console.log('REZULTAT MIGRACIJE');
    console.log('========================================');
    console.log(`Ukupno u JSON fajlu: ${jsonData.length}`);
    console.log(`Uspešno ažurirano: ${updated}`);
    console.log(`Već migrirano: ${alreadyMigrated}`);
    console.log(`Nije pronađeno u bazi: ${notFound}`);
    console.log(`Greške: ${errors.length}`);

    if (errors.length > 0 && errors.length <= 20) {
      console.log('\nGreške:');
      errors.forEach(e => console.log(`  - ${e}`));
    } else if (errors.length > 20) {
      console.log('\nPrvih 20 grešaka:');
      errors.slice(0, 20).forEach(e => console.log(`  - ${e}`));
      console.log(`  ... i još ${errors.length - 20} grešaka`);
    }

    // Provera koliko opreme sada ima location='virtuelni_magacin'
    const virtualWarehouseCount = await Equipment.countDocuments({ location: 'virtuelni_magacin' });
    console.log(`\nOprema u virtuelnom magacinu (MongoDB): ${virtualWarehouseCount}`);

  } catch (error) {
    console.error('Greška:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nKonekcija zatvorena');
  }
}

migrateVirtualWarehouse();
