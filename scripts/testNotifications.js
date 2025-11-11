/**
 * Test skripta za slanje Android push notifikacija
 *
 * Koristi se za testiranje notifikacija bez potrebe za kreiranje radnih naloga ili opreme
 *
 * Upotreba:
 *   node scripts/testNotifications.js <technicianId> <notificationType>
 *
 * Primeri:
 *   node scripts/testNotifications.js 64f7a8b3c2d1e45f6a7b8c9d work_order
 *   node scripts/testNotifications.js 64f7a8b3c2d1e45f6a7b8c9d equipment_add
 *   node scripts/testNotifications.js 64f7a8b3c2d1e45f6a7b8c9d equipment_remove
 */

require('dotenv').config();
const mongoose = require('mongoose');
const androidNotificationService = require('../services/androidNotificationService');

// Primeri test podataka
const TEST_DATA = {
  work_order: {
    address: 'Test adresa 123',
    municipality: 'Beograd',
    date: new Date().toISOString().split('T')[0],
    time: '10:00',
    orderId: 'TEST-' + Date.now()
  },
  equipment_add: [
    { name: 'Test oprema 1', serialNumber: 'TEST-SN-001', type: 'Router' },
    { name: 'Test oprema 2', serialNumber: 'TEST-SN-002', type: 'Modem' }
  ],
  equipment_remove: [
    { name: 'Test oprema 3', serialNumber: 'TEST-SN-003', type: 'ONT' }
  ]
};

async function testNotification() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    if (args.length < 2) {
      console.log('❌ Nedostaju argumenti!');
      console.log('');
      console.log('Upotreba:');
      console.log('  node scripts/testNotifications.js <technicianId> <notificationType>');
      console.log('');
      console.log('Tipovi notifikacija:');
      console.log('  - work_order         Test notifikacija za radni nalog');
      console.log('  - equipment_add      Test notifikacija za dodatu opremu');
      console.log('  - equipment_remove   Test notifikacija za uklonjenu opremu');
      console.log('  - all                Pošalji sve tri tipa notifikacija');
      console.log('');
      console.log('Primer:');
      console.log('  node scripts/testNotifications.js 64f7a8b3c2d1e45f6a7b8c9d work_order');
      process.exit(1);
    }

    const [technicianId, notificationType] = args;

    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/management_system');
    console.log('✅ Connected to MongoDB');

    // Verify technician exists
    const Technician = require('../models/Technician');
    const technician = await Technician.findById(technicianId);

    if (!technician) {
      console.log(`❌ Tehničar sa ID ${technicianId} nije pronađen`);
      process.exit(1);
    }

    if (!technician.pushNotificationToken) {
      console.log(`⚠️ Tehničar ${technician.name} nema registrovan push token`);
      console.log('   Mora prvo da se uloguje u Android app i registruje notifikacije');
      process.exit(1);
    }

    console.log(`\n📱 Tehničar: ${technician.name} (${technician.phoneNumber})`);
    console.log(`🔑 Push Token: ${technician.pushNotificationToken}`);
    console.log('');

    // Send notification based on type
    if (notificationType === 'all') {
      console.log('📬 Šaljem sve tipove notifikacija...\n');

      // 1. Work Order
      console.log('1️⃣ Šaljem WORK ORDER notifikaciju...');
      const result1 = await androidNotificationService.createWorkOrderNotification(
        technicianId,
        TEST_DATA.work_order
      );
      console.log(result1.success ? '✅ Work Order notifikacija poslata' : '❌ Greška:', result1.error);

      // Wait 2 seconds
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 2. Equipment Add
      console.log('\n2️⃣ Šaljem EQUIPMENT ADD notifikaciju...');
      const result2 = await androidNotificationService.createEquipmentAddNotification(
        technicianId,
        TEST_DATA.equipment_add
      );
      console.log(result2.success ? '✅ Equipment Add notifikacija poslata' : '❌ Greška:', result2.error);

      // Wait 2 seconds
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 3. Equipment Remove
      console.log('\n3️⃣ Šaljem EQUIPMENT REMOVE notifikaciju...');
      const result3 = await androidNotificationService.createEquipmentRemoveNotification(
        technicianId,
        TEST_DATA.equipment_remove
      );
      console.log(result3.success ? '✅ Equipment Remove notifikacija poslata' : '❌ Greška:', result3.error);

    } else {
      // Send single notification type
      console.log(`📬 Šaljem ${notificationType} notifikaciju...\n`);

      let result;
      switch (notificationType) {
        case 'work_order':
          result = await androidNotificationService.createWorkOrderNotification(
            technicianId,
            TEST_DATA.work_order
          );
          break;

        case 'equipment_add':
          result = await androidNotificationService.createEquipmentAddNotification(
            technicianId,
            TEST_DATA.equipment_add
          );
          break;

        case 'equipment_remove':
          result = await androidNotificationService.createEquipmentRemoveNotification(
            technicianId,
            TEST_DATA.equipment_remove
          );
          break;

        default:
          console.log(`❌ Nepoznat tip notifikacije: ${notificationType}`);
          console.log('   Dozvoljeni tipovi: work_order, equipment_add, equipment_remove, all');
          process.exit(1);
      }

      if (result.success) {
        console.log('✅ Notifikacija uspešno kreirana i poslata!');
        console.log(`📋 Notification ID: ${result.notification._id}`);
        console.log(`📝 Title: ${result.notification.title}`);
        console.log(`💬 Message: ${result.notification.message}`);
        console.log(`🏷️ Type: ${result.notification.type}`);
        console.log(`📱 Channel: ${androidNotificationService.getChannelId(result.notification.type)}`);
      } else {
        console.log('❌ Greška pri kreiranju notifikacije:', result.error);
      }
    }

    console.log('\n🎉 Test završen!');
    console.log('\n💡 Proveri Android uređaj da vidiš notifikaciju');
    console.log('   - Ako app nije otvoren, notifikacija bi trebalo da se pojavi u notification tray-u');
    console.log('   - Ako app jeste otvoren, notifikacija bi trebalo da se pojavi kao popup');

  } catch (error) {
    console.error('❌ Greška:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n📡 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the test
testNotification();
