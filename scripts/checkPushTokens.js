/**
 * Script za proveru push tokena svih tehničara
 * Pokreni sa: node scripts/checkPushTokens.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Technician = require('../models/Technician');

async function checkPushTokens() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    // Dohvati SVE tehničare
    const allTechnicians = await Technician.find({})
      .select('name phoneNumber pushNotificationToken pushNotificationsEnabled role')
      .lean();

    console.log(`=== UKUPNO TEHNIČARA: ${allTechnicians.length} ===\n`);

    // Podeli po statusu push tokena
    const withValidToken = [];
    const withNullToken = [];
    const withEmptyToken = [];
    const withoutTokenField = [];

    for (const tech of allTechnicians) {
      const token = tech.pushNotificationToken;

      if (token === undefined) {
        withoutTokenField.push(tech);
      } else if (token === null) {
        withNullToken.push(tech);
      } else if (token === '') {
        withEmptyToken.push(tech);
      } else if (typeof token === 'string' && token.length > 0) {
        withValidToken.push(tech);
      } else {
        withNullToken.push(tech);
      }
    }

    console.log('=== TEHNIČARI SA VALIDNIM PUSH TOKENOM ===');
    if (withValidToken.length === 0) {
      console.log('  (nema nijednog)\n');
    } else {
      withValidToken.forEach(t => {
        console.log(`  ✅ ${t.name} (${t.role})`);
        console.log(`     Phone: ${t.phoneNumber || 'N/A'}`);
        console.log(`     Token: ${t.pushNotificationToken.substring(0, 40)}...`);
        console.log(`     Notifications enabled: ${t.pushNotificationsEnabled}`);
        console.log('');
      });
    }

    console.log('=== TEHNIČARI SA NULL TOKENOM ===');
    if (withNullToken.length === 0) {
      console.log('  (nema nijednog)\n');
    } else {
      withNullToken.forEach(t => {
        console.log(`  ❌ ${t.name} (${t.role}) - phone: ${t.phoneNumber || 'N/A'}`);
      });
      console.log('');
    }

    console.log('=== TEHNIČARI SA PRAZNIM TOKENOM ===');
    if (withEmptyToken.length === 0) {
      console.log('  (nema nijednog)\n');
    } else {
      withEmptyToken.forEach(t => {
        console.log(`  ⚠️  ${t.name} (${t.role}) - phone: ${t.phoneNumber || 'N/A'}`);
      });
      console.log('');
    }

    console.log('=== TEHNIČARI BEZ POLJA pushNotificationToken ===');
    if (withoutTokenField.length === 0) {
      console.log('  (nema nijednog)\n');
    } else {
      withoutTokenField.forEach(t => {
        console.log(`  ⚪ ${t.name} (${t.role}) - phone: ${t.phoneNumber || 'N/A'}`);
      });
      console.log('');
    }

    console.log('=== SUMMARY ===');
    console.log(`Total tehničara:        ${allTechnicians.length}`);
    console.log(`Sa validnim tokenom:    ${withValidToken.length} ✅`);
    console.log(`Sa null tokenom:        ${withNullToken.length} ❌`);
    console.log(`Sa praznim tokenom:     ${withEmptyToken.length} ⚠️`);
    console.log(`Bez polja token:        ${withoutTokenField.length} ⚪`);

    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkPushTokens();
