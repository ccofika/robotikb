const fs = require('fs');
const path = require('path');

const backupFile = process.argv[2];
if (!backupFile) {
  console.log('Usage: node checkBackup.js <backup_file.json>');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
const equipment = data.equipment;

console.log('=== BACKUP ANALIZA ===\n');
console.log('Tehničar:', data.technician.name);
console.log('Ukupno opreme:', equipment.length);

// Po statusu
const byStatus = {};
equipment.forEach(e => {
  const status = e.status || 'unknown';
  byStatus[status] = (byStatus[status] || 0) + 1;
});

console.log('\nPo statusu:');
Object.entries(byStatus).forEach(([s, c]) => console.log('  ' + s + ': ' + c));

// Sa assignedToUser
const withUser = equipment.filter(e => e.assignedToUser);
console.log('\nSa assignedToUser:', withUser.length);

// Installed
const installed = equipment.filter(e => e.status === 'installed');
console.log('Sa status installed:', installed.length);

if (installed.length > 0) {
  console.log('\n=== INSTALIRANA OPREMA (TREBALA DA OSTANE!) ===');
  installed.forEach(e => {
    console.log('  - ' + e.serialNumber + ' | user: ' + (e.assignedToUser || 'N/A') + ' | updatedAt: ' + (e.updatedAt ? e.updatedAt.split('T')[0] : 'N/A'));
  });
}

// Provera šta je trebalo da se prebaci (assigned i updatedAt nije u dozvoljenim datumima)
const KEEP_DATES = ['2025-12-16', '2025-12-17', '2025-12-18'];
const shouldMove = equipment.filter(e => {
  if (e.status !== 'assigned') return false; // Samo assigned
  if (e.assignedToUser) return false; // Ne sa korisnikom
  const dateStr = e.updatedAt ? e.updatedAt.split('T')[0] : '';
  return !KEEP_DATES.includes(dateStr);
});

console.log('\n=== OPREMA KOJA JE TREBALA DA SE PREBACI ===');
console.log('(status=assigned, bez korisnika, star updatedAt)');
console.log('Broj:', shouldMove.length);

const shouldKeep = equipment.filter(e => {
  if (e.status === 'installed') return true; // Instalirana - ostaje
  if (e.assignedToUser) return true; // Kod korisnika - ostaje
  const dateStr = e.updatedAt ? e.updatedAt.split('T')[0] : '';
  return KEEP_DATES.includes(dateStr); // Nov datum - ostaje
});

console.log('\n=== OPREMA KOJA JE TREBALA DA OSTANE ===');
console.log('Broj:', shouldKeep.length);
