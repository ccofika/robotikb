const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const fs = require('fs');

// Učitaj WorkOrder model
const WorkOrder = require('../models/WorkOrder');

// MongoDB konekcija
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/management-app';

async function findWorkOrders() {
  try {
    // Poveži se sa MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('Povezan sa MongoDB');

    // Učitaj tisJobId vrednosti iz txt fajla
    const tisJobIdsPath = path.join(__dirname, '../../zavrseni_radni_nalozi_tisjobid.txt');
    const tisJobIdsContent = fs.readFileSync(tisJobIdsPath, 'utf8');
    const tisJobIds = tisJobIdsContent.split('\n')
      .map(id => id.trim())
      .filter(id => id !== '');

    console.log(`\nUčitano ${tisJobIds.length} tisJobId vrednosti iz fajla`);

    // Pronađi radne naloge u bazi
    const workOrders = await WorkOrder.find({
      tisJobId: { $in: tisJobIds }
    }).select('_id tisJobId createdAt').sort({ createdAt: 1 });

    console.log(`\nPronađeno ${workOrders.length} radnih naloga u bazi`);

    // Formatiraj rezultate
    const results = workOrders.map(wo => {
      const createdDate = wo.createdAt ? new Date(wo.createdAt).toLocaleString('sr-RS') : 'N/A';
      return `_id: ${wo._id} | tisJobId: ${wo.tisJobId} | Kreiran: ${createdDate}`;
    });

    // Sačuvaj rezultate u txt fajl
    const outputPath = path.join(__dirname, '../../workorders_info.txt');
    fs.writeFileSync(outputPath, results.join('\n'), 'utf8');

    console.log(`\nRezultati sačuvani u: ${outputPath}`);
    console.log('\nPrvih 5 rezultata:');
    console.log(results.slice(0, 5).join('\n'));

    // Pronađi koje tisJobId vrednosti nisu pronađene u bazi
    const foundTisJobIds = workOrders.map(wo => wo.tisJobId);
    const notFound = tisJobIds.filter(id => !foundTisJobIds.includes(id));

    if (notFound.length > 0) {
      console.log(`\n\nUPOZORENJE: ${notFound.length} tisJobId vrednosti nije pronađeno u bazi:`);
      console.log(notFound.slice(0, 10).join(', '));
      if (notFound.length > 10) {
        console.log(`... i još ${notFound.length - 10}`);
      }

      // Sačuvaj nepronađene u poseban fajl
      const notFoundPath = path.join(__dirname, '../../tisjobid_not_found.txt');
      fs.writeFileSync(notFoundPath, notFound.join('\n'), 'utf8');
      console.log(`\nNepronađene tisJobId vrednosti sačuvane u: ${notFoundPath}`);
    }

  } catch (error) {
    console.error('Greška:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nOdpojen od MongoDB');
  }
}

findWorkOrders();
