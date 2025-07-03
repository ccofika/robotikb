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

// Funkcija za izvlačenje naziva fajla iz Cloudinary URL-a
function extractFilenameFromUrl(url) {
  try {
    if (typeof url !== 'string') return 'unknown_file.jpg';
    
    // Ako je Cloudinary URL, izdvojimo poslednji deo
    if (url.includes('cloudinary.com')) {
      const urlParts = url.split('/');
      const lastPart = urlParts[urlParts.length - 1];
      // Uklanjamo sve do poslednje tačke za ekstenziju
      const filename = lastPart.split('.')[0];
      // Uklanjamo timestamp ako postoji (format: timestamp-originalname)
      let cleanFilename = filename.replace(/^\d+-/, '');
      
      // Ako je i dalje u formatu workorder_hash, probaj da izvučeš originalni naziv
      if (cleanFilename.startsWith('workorder_')) {
        // Pokušaj da pronađeš originalni naziv na osnovu hash-a
        cleanFilename = cleanFilename.replace(/^workorder_[a-f0-9]+_\d+/, 'image');
      }
      
      return cleanFilename + '.jpg'; // Pretpostavljamo JPG ekstenziju
    }
    
    // Za obične URL-ove
    const urlParts = url.split('/');
    let filename = urlParts[urlParts.length - 1];
    
    // Ako nema ekstenzije, dodaj .jpg
    if (!filename.includes('.')) {
      filename += '.jpg';
    }
    
    return filename;
  } catch (error) {
    console.error('Error extracting filename from URL:', url, error);
    return 'unknown_file.jpg';
  }
}

// Glavna migracija funkcija
async function migrateImageData() {
  try {
    console.log('🚀 Pokretanje migracije slika...');
    
    // Pronađi sve radne naloge koji imaju slike u starom formatu (string array)
    const workOrders = await WorkOrder.find({
      images: { $exists: true, $not: { $size: 0 } }
    });
    
    console.log(`📋 Pronađeno ${workOrders.length} radnih naloga sa slikama`);
    
    let migratedCount = 0;
    let alreadyMigratedCount = 0;
    let errorCount = 0;
    
    for (const workOrder of workOrders) {
      try {
        // Proveri da li je već migriran (prvi element je objekat)
        if (workOrder.images.length > 0 && typeof workOrder.images[0] === 'object' && workOrder.images[0].url) {
          alreadyMigratedCount++;
          console.log(`⏭️  Radni nalog ${workOrder._id} je već migriran`);
          continue;
        }
        
        // Migriraj slike iz string formata u objekat format
        const migratedImages = workOrder.images.map(imageUrl => {
          if (typeof imageUrl === 'string') {
            const originalName = extractFilenameFromUrl(imageUrl);
            return {
              url: imageUrl,
              originalName: originalName,
              uploadedAt: workOrder.createdAt || new Date(),
              uploadedBy: workOrder.technicianId || null
            };
          }
          
          // Ako je već objekat, vrati kao što jeste
          return imageUrl;
        });
        
        // Ažuriraj radni nalog
        workOrder.images = migratedImages;
        await workOrder.save();
        
        migratedCount++;
        console.log(`✅ Migriran radni nalog ${workOrder._id} sa ${migratedImages.length} slika`);
        
      } catch (error) {
        errorCount++;
        console.error(`❌ Greška pri migraciji radnog naloga ${workOrder._id}:`, error);
      }
    }
    
    console.log('\n🎉 Migracija završena!');
    console.log(`📊 Rezultati:`);
    console.log(`   ✅ Migrirano: ${migratedCount}`);
    console.log(`   ⏭️  Već migrirano: ${alreadyMigratedCount}`);
    console.log(`   ❌ Greške: ${errorCount}`);
    console.log(`   📋 Ukupno: ${workOrders.length}`);
    
  } catch (error) {
    console.error('❌ Greška pri migraciji:', error);
  }
}

// Pokreni migraciju
async function runMigration() {
  await connectDB();
  await migrateImageData();
  await mongoose.disconnect();
  console.log('🔌 Konekcija sa bazom zatvorena');
  process.exit(0);
}

// Pokreni ako je pozvan direktno
if (require.main === module) {
  runMigration().catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
}

module.exports = { migrateImageData }; 