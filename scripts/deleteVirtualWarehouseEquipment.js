const mongoose = require('mongoose');
const { Equipment } = require('../models');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

/**
 * Skripta za brisanje opreme iz virtuelnog magacina (location: 'virtuelni_magacin') iz MongoDB baze.
 *
 * NAPOMENA: Ova skripta NE utiče na JSON fajl virtuelnog magacina na frontendu
 * (robotikf/src/data/virtual_warehouse_equipment.json).
 * Briše samo iz MongoDB baze podataka.
 *
 * Korišćenje:
 *   node deleteVirtualWarehouseEquipment.js           - Prikazuje opremu koja bi bila obrisana (dry-run)
 *   node deleteVirtualWarehouseEquipment.js --execute - Izvršava brisanje opreme
 */

async function deleteVirtualWarehouseEquipment() {
  const isExecuteMode = process.argv.includes('--execute');

  try {
    // Povezivanje sa bazom koristeći konfiguraciju iz .env fajla
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI nije definisan u .env fajlu');
    }

    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Povezano sa MongoDB bazom\n');

    // Pronalaženje sve opreme u virtuelnom magacinu
    const virtualWarehouseEquipment = await Equipment.find({ location: 'virtuelni_magacin' });

    console.log('=' .repeat(80));
    console.log('OPREMA U VIRTUELNOM MAGACINU (location: "virtuelni_magacin")');
    console.log('=' .repeat(80));
    console.log(`\nUkupno pronađeno: ${virtualWarehouseEquipment.length} komada opreme\n`);

    if (virtualWarehouseEquipment.length === 0) {
      console.log('Nema opreme za brisanje.');
      return;
    }

    // Prikaz opreme po kategorijama
    const byCategory = {};
    virtualWarehouseEquipment.forEach(eq => {
      if (!byCategory[eq.category]) {
        byCategory[eq.category] = [];
      }
      byCategory[eq.category].push(eq);
    });

    console.log('Oprema po kategorijama:');
    console.log('-'.repeat(40));
    for (const [category, items] of Object.entries(byCategory)) {
      console.log(`  ${category}: ${items.length} komada`);
    }
    console.log('-'.repeat(40));
    console.log('');

    // Prikaz detaljne liste
    console.log('Detaljna lista opreme:');
    console.log('-'.repeat(80));
    virtualWarehouseEquipment.forEach((eq, index) => {
      console.log(`${index + 1}. [${eq.category}] ${eq.serialNumber}`);
      console.log(`   Opis: ${eq.description}`);
      console.log(`   Status: ${eq.status}`);
      if (eq.movedToVirtualWarehouseAt) {
        console.log(`   Prebačeno u VM: ${eq.movedToVirtualWarehouseAt.toISOString()}`);
      }
      console.log('');
    });

    if (!isExecuteMode) {
      console.log('=' .repeat(80));
      console.log('DRY-RUN MODE - Oprema NIJE obrisana');
      console.log('Za izvršenje brisanja pokrenite: node deleteVirtualWarehouseEquipment.js --execute');
      console.log('=' .repeat(80));
    } else {
      // Izvršenje brisanja
      console.log('=' .repeat(80));
      console.log('IZVRŠAVANJE BRISANJA...');
      console.log('=' .repeat(80));

      const result = await Equipment.deleteMany({ location: 'virtuelni_magacin' });

      console.log(`\n✅ Uspešno obrisano ${result.deletedCount} komada opreme iz baze podataka.`);
      console.log('\nNAPOMENA: JSON fajl virtuelnog magacina na frontendu NIJE promenjen.');
      console.log('         (robotikf/src/data/virtual_warehouse_equipment.json)');
    }

  } catch (error) {
    console.error('Greška:', error);
  } finally {
    // Zatvaranje konekcije
    await mongoose.connection.close();
    console.log('\nKonekcija zatvorena');
  }
}

// Pokretanje skripta
deleteVirtualWarehouseEquipment();
