const mongoose = require('mongoose');
const WorkOrder = require('../models/WorkOrder');

// Konekcija sa bazom podataka
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/telco_inventory', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB Connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}

// Test funkcija za kreiranje test radnog naloga
async function createTestWorkOrder() {
  const testWorkOrder = new WorkOrder({
    date: new Date(),
    time: '09:00',
    municipality: 'Test Municipality',
    address: 'Test Address 123',
    type: 'Test Installation',
    tisId: 'TEST123',
    userName: 'Test User',
    userPhone: '+381600000000',
    images: [
      {
        url: 'https://res.cloudinary.com/test/image/upload/workorder_test123.jpg',
        originalName: 'test_image.jpg',
        uploadedAt: new Date(),
        uploadedBy: null
      },
      {
        url: 'https://res.cloudinary.com/test/image/upload/workorder_test456.jpg',
        originalName: 'another_image.png',
        uploadedAt: new Date(),
        uploadedBy: null
      }
    ]
  });

  await testWorkOrder.save();
  console.log('✅ Test radni nalog kreiran sa ID:', testWorkOrder._id);
  return testWorkOrder._id;
}

// Test funkcija za proveru duplikata
function testDuplicateLogic(existingImages, newFileName) {
  // Izvlačimo originalne nazive postojećih slika
  const existingFilenames = existingImages.map(imageItem => {
    if (typeof imageItem === 'object' && imageItem.originalName) {
      return imageItem.originalName.toLowerCase();
    }
    
    if (typeof imageItem === 'string') {
      // Fallback za stari format
      if (imageItem.includes('cloudinary.com')) {
        const urlParts = imageItem.split('/');
        const lastPart = urlParts[urlParts.length - 1];
        const filename = lastPart.split('.')[0];
        const cleanFilename = filename.replace(/^\d+-/, '');
        return cleanFilename.toLowerCase();
      }
      
      const urlParts = imageItem.split('/');
      const filename = urlParts[urlParts.length - 1];
      const cleanFilename = filename.replace(/^\d+-/, '').split('.')[0];
      return cleanFilename.toLowerCase();
    }
    
    return '';
  });

  console.log('📋 Postojeći nazivi fajlova:', existingFilenames);

  // Provera duplikata
  const filename = newFileName.toLowerCase();
  const filenameWithoutExtension = filename.split('.')[0];
  
  console.log('🔍 Proverava se fajl:', filename);
  console.log('📝 Naziv bez ekstenzije:', filenameWithoutExtension);

  const isDuplicate = existingFilenames.some(existingName => 
    existingName === filenameWithoutExtension || 
    existingName === filename ||
    existingName.includes(filenameWithoutExtension)
  );

  return { isDuplicate, existingFilenames, filename, filenameWithoutExtension };
}

// Glavna test funkcija
async function runTests() {
  try {
    console.log('🧪 Pokretanje testova za duplikate slika...\n');
    
    // Test 1: Kreiranje test radnog naloga
    console.log('📝 Test 1: Kreiranje test radnog naloga');
    const testWorkOrderId = await createTestWorkOrder();
    
    // Test 2: Učitavanje test radnog naloga
    console.log('\n📝 Test 2: Učitavanje test radnog naloga');
    const workOrder = await WorkOrder.findById(testWorkOrderId);
    console.log('✅ Radni nalog učitan, broj slika:', workOrder.images.length);
    
    // Test 3: Testiranje logike duplikata - pozitivni slučajevi
    console.log('\n📝 Test 3: Testiranje duplikata - trebaju biti odbačeni');
    
    const testCases = [
      'test_image.jpg',      // Tačan duplikat
      'TEST_IMAGE.JPG',      // Case insensitive duplikat
      'another_image.png',   // Drugi duplikat
      'test_image.png',      // Isti naziv, druga ekstenzija
      'another_image.jpg'    // Isti naziv, druga ekstenzija
    ];
    
    testCases.forEach((testCase, index) => {
      console.log(`\n   Test 3.${index + 1}: "${testCase}"`);
      const result = testDuplicateLogic(workOrder.images, testCase);
      if (result.isDuplicate) {
        console.log('   ✅ PRIHVAĆEN - Duplikat je uspešno detektovan');
      } else {
        console.log('   ❌ ODBAČEN - Duplikat NIJE detektovan (problem!)');
      }
    });
    
    // Test 4: Testiranje logike duplikata - negativni slučajevi
    console.log('\n📝 Test 4: Testiranje neduplikata - trebaju biti prihvaćeni');
    
    const nonDuplicateCases = [
      'new_image.jpg',
      'completely_different.png',
      'work_photo.jpg',
      'evidence_1.png',
      'final_result.jpg'
    ];
    
    nonDuplicateCases.forEach((testCase, index) => {
      console.log(`\n   Test 4.${index + 1}: "${testCase}"`);
      const result = testDuplicateLogic(workOrder.images, testCase);
      if (!result.isDuplicate) {
        console.log('   ✅ PRIHVAĆEN - Nije duplikat, može se uploadovati');
      } else {
        console.log('   ❌ ODBAČEN - Netačno detektovan kao duplikat (problem!)');
      }
    });
    
    // Test 5: Testiranje sa starim formatom (string URLs)
    console.log('\n📝 Test 5: Testiranje sa starim formatom slika');
    
    const oldFormatImages = [
      'https://res.cloudinary.com/test/image/upload/workorder_1234567890-old_photo.jpg',
      'https://res.cloudinary.com/test/image/upload/workorder_0987654321-evidence.png'
    ];
    
    const oldFormatTests = [
      'old_photo.jpg',    // Duplikat
      'evidence.png',     // Duplikat
      'new_file.jpg'      // Nije duplikat
    ];
    
    oldFormatTests.forEach((testCase, index) => {
      console.log(`\n   Test 5.${index + 1}: "${testCase}" vs stari format`);
      const result = testDuplicateLogic(oldFormatImages, testCase);
      console.log(`   Rezultat: ${result.isDuplicate ? 'DUPLIKAT' : 'NIJE DUPLIKAT'}`);
    });
    
    // Čišćenje test podataka
    console.log('\n🧹 Brisanje test podataka...');
    await WorkOrder.findByIdAndDelete(testWorkOrderId);
    console.log('✅ Test podaci obrisani');
    
    console.log('\n🎉 Svi testovi završeni!');
    
  } catch (error) {
    console.error('❌ Greška tokom testiranja:', error);
  }
}

// Pokreni testove
async function runTestSuite() {
  await connectDB();
  await runTests();
  await mongoose.disconnect();
  console.log('🔌 Konekcija sa bazom zatvorena');
  process.exit(0);
}

// Pokreni ako je pozvan direktno
if (require.main === module) {
  runTestSuite().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

module.exports = { runTests, testDuplicateLogic }; 