/**
 * Skripta za prebacivanje viška opreme u virtuelni magacin
 *
 * PRAVILA:
 * - Zadržava se SAMO oprema sa updatedAt datumima: 2025-12-16, 2025-12-17, 2025-12-18
 * - Sva ostala oprema se prebacuje u virtuelni magacin
 * - Čuva se originalna lokacija (tehničar kod koga je bila oprema)
 *
 * FAZE:
 * 1. --list        : Lista svih tehničara i statistika opreme
 * 2. --backup NAME : Pravi backup opreme za tehničara
 * 3. --dry-run NAME: Pokazuje šta bi bilo prebačeno (bez promena)
 * 4. --execute NAME: IZVRŠAVA prenos (OPREZ!)
 */

const mongoose = require('mongoose');
const Equipment = require('../models/Equipment');
const Technician = require('../models/Technician');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Datumi koji se zadržavaju (oprema ažurirana ovih dana ostaje kod tehničara)
const KEEP_DATES = ['2025-12-16', '2025-12-17', '2025-12-18'];

// Putanja do JSON fajla virtuelnog magacina
const VIRTUAL_WAREHOUSE_PATH = path.join(__dirname, '..', '..', 'robotikf', 'src', 'data', 'virtual_warehouse_equipment.json');

// Funkcija za proveru da li je datum u dozvoljenom opsegu
function isDateInKeepRange(date) {
  if (!date) return false;
  const dateStr = new Date(date).toISOString().split('T')[0];
  return KEEP_DATES.includes(dateStr);
}

// Funkcija za proveru da li oprema treba da ostane (instalirana kod korisnika)
function shouldKeepEquipment(equipment) {
  // Ako je instalirana kod korisnika - NE PREBACUJ
  if (equipment.status === 'installed') return true;
  if (equipment.assignedToUser) return true;

  // Ako je ažurirana u dozvoljenom periodu - NE PREBACUJ
  if (isDateInKeepRange(equipment.updatedAt)) return true;

  return false;
}

// Formatiranje datuma za prikaz
function formatDate(date) {
  if (!date) return 'N/A';
  return new Date(date).toISOString().split('T')[0];
}

// 1. LISTA TEHNIČARA
async function listTechnicians() {
  console.log('\n=== LISTA TEHNIČARA I NJIHOVE OPREME ===\n');

  const technicians = await Technician.find({}).select('name _id');

  console.log('Br.  | Ime tehničara                    | Oprema (assignedTo)');
  console.log('-----|----------------------------------|--------------------');

  for (let i = 0; i < technicians.length; i++) {
    const tech = technicians[i];
    // Brojanje opreme preko assignedTo polja u Equipment kolekciji
    const equipmentCount = await Equipment.countDocuments({ assignedTo: tech._id });
    const paddedNum = String(i + 1).padStart(3, ' ');
    const paddedName = tech.name.padEnd(32, ' ');
    console.log(`${paddedNum}  | ${paddedName} | ${equipmentCount}`);
  }

  console.log('\n');
  console.log('Za backup koristite: node moveExcessEquipmentToVirtualWarehouse.js --backup "Ime Tehničara"');
  console.log('Za dry-run koristite: node moveExcessEquipmentToVirtualWarehouse.js --dry-run "Ime Tehničara"');
}

// 2. BACKUP OPREME TEHNIČARA
async function backupTechnicianEquipment(technicianName) {
  console.log(`\n=== BACKUP OPREME ZA TEHNIČARA: ${technicianName} ===\n`);

  const technician = await Technician.findOne({ name: technicianName });
  if (!technician) {
    console.log(`GREŠKA: Tehničar "${technicianName}" nije pronađen!`);
    return null;
  }

  // Dohvatanje sve opreme tehničara
  const equipment = await Equipment.find({
    assignedTo: technician._id
  });

  console.log(`Pronađeno ${equipment.length} komada opreme kod tehničara ${technician.name}`);

  // Kreiranje backup fajla
  const backupData = {
    backupDate: new Date().toISOString(),
    technician: {
      name: technician.name,
      id: technician._id.toString()
    },
    totalEquipment: equipment.length,
    equipment: equipment.map(e => ({
      _id: e._id.toString(),
      category: e.category,
      description: e.description,
      serialNumber: e.serialNumber,
      location: e.location,
      status: e.status,
      assignedTo: e.assignedTo?.toString(),
      assignedToUser: e.assignedToUser,
      updatedAt: e.updatedAt,
      createdAt: e.createdAt
    }))
  };

  const backupFileName = `backup_${technicianName.replace(/\s+/g, '_')}_${Date.now()}.json`;
  const backupPath = path.join(__dirname, backupFileName);

  fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf8');
  console.log(`\n✓ Backup sačuvan: ${backupPath}`);

  return { technician, equipment };
}

// 3. DRY-RUN - Pokazuje šta bi bilo prebačeno
async function dryRun(technicianName) {
  console.log(`\n=== DRY-RUN ZA TEHNIČARA: ${technicianName} ===\n`);
  console.log('PRAVILA ZA PREBACIVANJE:');
  console.log('  - NE prebacuj opremu sa status "installed" (kod korisnika)');
  console.log('  - NE prebacuj opremu sa assignedToUser (kod korisnika)');
  console.log('  - NE prebacuj opremu ažuriranu: ' + KEEP_DATES.join(', '));
  console.log('  - PREBACI samo "assigned" opremu sa starim datumom');
  console.log('\n');

  const technician = await Technician.findOne({ name: technicianName });
  if (!technician) {
    console.log(`GREŠKA: Tehničar "${technicianName}" nije pronađen!`);
    return;
  }

  // Dohvatanje sve opreme tehničara
  const allEquipment = await Equipment.find({
    assignedTo: technician._id
  });

  console.log(`Ukupno opreme kod tehničara: ${allEquipment.length}\n`);

  // Statistika po statusu
  const statusStats = {};
  allEquipment.forEach(e => {
    statusStats[e.status] = (statusStats[e.status] || 0) + 1;
  });
  console.log('Po statusu:');
  Object.entries(statusStats).forEach(([s, c]) => console.log(`  ${s}: ${c}`));
  console.log('');

  // Razdvajanje na opremu koja ostaje i koja se prebacuje
  const equipmentToKeep = [];
  const equipmentToMove = [];

  allEquipment.forEach(e => {
    if (shouldKeepEquipment(e)) {
      equipmentToKeep.push(e);
    } else {
      equipmentToMove.push(e);
    }
  });

  console.log('========================================');
  console.log(`OPREMA KOJA OSTAJE KOD TEHNIČARA: ${equipmentToKeep.length}`);
  console.log('========================================');

  if (equipmentToKeep.length > 0) {
    console.log('\nSerijski broj          | Kategorija       | UpdatedAt');
    console.log('-----------------------|------------------|------------');
    equipmentToKeep.slice(0, 20).forEach(e => {
      const sn = e.serialNumber.padEnd(21, ' ');
      const cat = (e.category || 'N/A').padEnd(16, ' ');
      console.log(`${sn} | ${cat} | ${formatDate(e.updatedAt)}`);
    });
    if (equipmentToKeep.length > 20) {
      console.log(`... i još ${equipmentToKeep.length - 20} komada`);
    }
  }

  console.log('\n========================================');
  console.log(`OPREMA ZA PREBACIVANJE U VIRTUELNI MAGACIN: ${equipmentToMove.length}`);
  console.log('========================================');

  if (equipmentToMove.length > 0) {
    console.log('\nSerijski broj          | Kategorija       | UpdatedAt');
    console.log('-----------------------|------------------|------------');
    equipmentToMove.slice(0, 30).forEach(e => {
      const sn = e.serialNumber.padEnd(21, ' ');
      const cat = (e.category || 'N/A').padEnd(16, ' ');
      console.log(`${sn} | ${cat} | ${formatDate(e.updatedAt)}`);
    });
    if (equipmentToMove.length > 30) {
      console.log(`... i još ${equipmentToMove.length - 30} komada`);
    }
  }

  // Statistika po kategorijama
  console.log('\n========================================');
  console.log('STATISTIKA PO KATEGORIJAMA ZA PREBACIVANJE');
  console.log('========================================\n');

  const categoryStats = {};
  equipmentToMove.forEach(e => {
    const cat = e.category || 'Nepoznato';
    categoryStats[cat] = (categoryStats[cat] || 0) + 1;
  });

  Object.entries(categoryStats).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
    console.log(`  ${cat}: ${count}`);
  });

  console.log('\n========================================');
  console.log('SAŽETAK');
  console.log('========================================');
  console.log(`Ukupno opreme: ${allEquipment.length}`);
  console.log(`Ostaje kod tehničara: ${equipmentToKeep.length}`);
  console.log(`Za prebacivanje: ${equipmentToMove.length}`);
  console.log('\n');
  console.log('Za izvršenje prebacivanja koristite:');
  console.log(`node moveExcessEquipmentToVirtualWarehouse.js --execute "${technicianName}"`);

  return { equipmentToKeep, equipmentToMove, technician };
}

// 4. EXECUTE - Izvršava prenos
async function executeMove(technicianName) {
  console.log(`\n=== IZVRŠAVANJE PRENOSA ZA TEHNIČARA: ${technicianName} ===\n`);
  console.log('⚠️  UPOZORENJE: Ovo će TRAJNO prebaciti opremu u virtuelni magacin!');
  console.log('Prvo pravim backup...\n');

  // Prvo backup
  const backupResult = await backupTechnicianEquipment(technicianName);
  if (!backupResult) return;

  const { technician, equipment: allEquipment } = backupResult;

  // Razdvajanje opreme - koristi novu logiku koja isključuje instaliranu opremu
  const equipmentToMove = allEquipment.filter(e => !shouldKeepEquipment(e));

  console.log(`\nStatistika pre prebacivanja:`);
  console.log(`  - Ukupno: ${allEquipment.length}`);
  console.log(`  - Installed (ostaje): ${allEquipment.filter(e => e.status === 'installed').length}`);
  console.log(`  - Sa assignedToUser (ostaje): ${allEquipment.filter(e => e.assignedToUser).length}`);
  console.log(`  - Za prebacivanje: ${equipmentToMove.length}`);

  if (equipmentToMove.length === 0) {
    console.log('\n✓ Nema opreme za prebacivanje. Sva oprema je ažurirana u dozvoljenom periodu.');
    return;
  }

  console.log(`\nPrebacujem ${equipmentToMove.length} komada opreme...\n`);

  // Učitavanje postojećeg virtuelnog magacina
  let virtualWarehouse = [];
  if (fs.existsSync(VIRTUAL_WAREHOUSE_PATH)) {
    try {
      virtualWarehouse = JSON.parse(fs.readFileSync(VIRTUAL_WAREHOUSE_PATH, 'utf8'));
    } catch (e) {
      console.log('Upozorenje: Nije moguće učitati postojeći virtuelni magacin, kreiram novi.');
      virtualWarehouse = [];
    }
  }

  // Pronalaženje najvećeg _id
  let maxId = 0;
  virtualWarehouse.forEach(item => {
    const id = parseInt(item._id);
    if (!isNaN(id) && id > maxId) maxId = id;
  });

  // Dodavanje opreme u virtuelni magacin
  const newEntries = [];
  for (const eq of equipmentToMove) {
    maxId++;
    newEntries.push({
      _id: String(maxId),
      category: eq.category,
      description: eq.description,
      serialNumber: eq.serialNumber,
      location: technician.name,  // Čuvamo ime tehničara
      originalUpdatedAt: eq.updatedAt?.toISOString(),
      movedAt: new Date().toISOString()
    });
  }

  // Spajanje sa postojećim
  virtualWarehouse = [...virtualWarehouse, ...newEntries];

  // Čuvanje u fajl
  fs.writeFileSync(VIRTUAL_WAREHOUSE_PATH, JSON.stringify(virtualWarehouse, null, 2), 'utf8');
  console.log(`✓ Dodato ${newEntries.length} komada opreme u virtuelni magacin`);

  // Uklanjanje iz baze - unassign opremu
  const equipmentIds = equipmentToMove.map(e => e._id);

  // 1. Postavljanje assignedTo na null, čuvanje previousAssignedTo i location na 'virtuelni_magacin'
  const updateResult = await Equipment.updateMany(
    { _id: { $in: equipmentIds } },
    {
      $set: {
        previousAssignedTo: technician._id,
        assignedTo: null,
        status: 'available',
        location: 'virtuelni_magacin',
        movedToVirtualWarehouseAt: new Date()
      }
    }
  );
  console.log(`✓ Ažurirano ${updateResult.modifiedCount} komada opreme u bazi (previousAssignedTo: ${technician.name})`);

  // 2. Uklanjanje iz equipment niza tehničara
  const techUpdateResult = await Technician.updateOne(
    { _id: technician._id },
    { $pull: { equipment: { $in: equipmentIds } } }
  );
  console.log(`✓ Uklonjeno iz equipment niza tehničara`);

  console.log('\n========================================');
  console.log('PRENOS ZAVRŠEN');
  console.log('========================================');
  console.log(`Prebačeno: ${equipmentToMove.length} komada opreme`);
  console.log(`Virtuelni magacin sada ima: ${virtualWarehouse.length} komada opreme`);

  // Provera preostale opreme kod tehničara
  const remainingEquipment = await Equipment.find({
    assignedTo: technician._id
  });
  console.log(`Preostalo kod tehničara: ${remainingEquipment.length} komada opreme`);
}

// MAIN
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('\nKorišćenje:');
    console.log('  --list                 : Lista svih tehničara');
    console.log('  --backup "Ime"         : Pravi backup opreme tehničara');
    console.log('  --dry-run "Ime"        : Pokazuje šta bi bilo prebačeno');
    console.log('  --execute "Ime"        : IZVRŠAVA prenos (OPREZ!)');
    console.log('\n');
    process.exit(0);
  }

  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI nije definisan u .env fajlu');
    }

    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Povezano sa MongoDB bazom');

    const command = args[0];
    const technicianName = args[1];

    switch (command) {
      case '--list':
        await listTechnicians();
        break;

      case '--backup':
        if (!technicianName) {
          console.log('GREŠKA: Morate navesti ime tehničara');
          break;
        }
        await backupTechnicianEquipment(technicianName);
        break;

      case '--dry-run':
        if (!technicianName) {
          console.log('GREŠKA: Morate navesti ime tehničara');
          break;
        }
        await dryRun(technicianName);
        break;

      case '--execute':
        if (!technicianName) {
          console.log('GREŠKA: Morate navesti ime tehničara');
          break;
        }
        await executeMove(technicianName);
        break;

      default:
        console.log(`Nepoznata komanda: ${command}`);
    }

  } catch (error) {
    console.error('Greška:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nKonekcija zatvorena');
  }
}

main();
