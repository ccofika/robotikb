const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function fixTypo() {
  console.log('Povezivanje na MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);

  const Equipment = mongoose.model('Equipment', new mongoose.Schema({
    category: String
  }, { strict: false }));

  const result = await Equipment.updateMany(
    { category: 'Smsrt kartica' },
    { $set: { category: 'Smart Card' } }
  );

  console.log('✅ Ažurirano:', result.modifiedCount, 'stavki (Smsrt kartica → Smart Card)');

  await mongoose.disconnect();
  console.log('Veza zatvorena.');
}

fixTypo().catch(console.error);
