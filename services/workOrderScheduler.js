const cron = require('node-cron');
const { WorkOrder } = require('../models');

// Funkcija za proveru i ažuriranje odloženih radnih naloga
async function checkPostponedWorkOrders() {
  try {
    const currentTime = new Date();
    console.log(`[${currentTime.toISOString()}] Checking for postponed work orders...`);
    
    // Prvo pronađi sve odložene radne naloge da vidimo šta imamo
    const allPostponedWorkOrders = await WorkOrder.find({
      status: 'odlozen'
    }).select('_id address postponedUntil');
    
    console.log(`Ukupno odloženih radnih naloga: ${allPostponedWorkOrders.length}`);
    
    if (allPostponedWorkOrders.length > 0) {
      allPostponedWorkOrders.forEach(wo => {
        console.log(`- ID: ${wo._id}, Address: ${wo.address}, PostponedUntil: ${wo.postponedUntil ? wo.postponedUntil.toISOString() : 'NIJE POSTAVLJENO'}, Current time: ${currentTime.toISOString()}`);
      });
    }
    
    // Pronađi sve odložene radne naloge čije je vreme za obradu stiglo
    const workOrdersToUpdate = await WorkOrder.find({
      status: 'odlozen',
      postponedUntil: { $lte: currentTime }
    });
    
    console.log(`Radnih naloga koji treba da se ažuriraju: ${workOrdersToUpdate.length}`);
    
    if (workOrdersToUpdate.length > 0) {
      console.log(`Pronađeno ${workOrdersToUpdate.length} odloženih radnih naloga koji treba da se promene u nezavršene`);
      
      // Ažuriraj status svih pronađenih radnih naloga
      const updateResult = await WorkOrder.updateMany(
        {
          status: 'odlozen',
          postponedUntil: { $lte: currentTime }
        },
        {
          $set: {
            status: 'nezavrsen',
            statusChangedAt: currentTime
          },
          $unset: {
            postponedUntil: 1
          }
        }
      );
      
      console.log(`Uspešno ažurirano ${updateResult.modifiedCount} radnih naloga sa statusa 'odlozen' na 'nezavrsen'`);
      
      // Log pojedinačno za svaki radni nalog
      workOrdersToUpdate.forEach(workOrder => {
        console.log(`Radni nalog ${workOrder._id} (${workOrder.address}) promenjen sa 'odlozen' na 'nezavrsen'`);
      });
    }
  } catch (error) {
    console.error('Greška pri proveri odloženih radnih naloga:', error);
  }
}

// Pokretanje scheduler-a
function startWorkOrderScheduler() {
  console.log('Pokretanje Work Order Scheduler-a...');
  
  // Pokreni svake minute za testiranje, u produkciji možda svakih 5-10 minuta
  cron.schedule('* * * * *', async () => {
    await checkPostponedWorkOrders();
  });
  
  console.log('Work Order Scheduler je pokrenut - proverava odložene radne naloge svaki minut');
}

// Ručno testiranje scheduler-a
async function testScheduler() {
  console.log('=== MANUAL SCHEDULER TEST ===');
  await checkPostponedWorkOrders();
  console.log('=== TEST COMPLETED ===');
}

module.exports = {
  startWorkOrderScheduler,
  checkPostponedWorkOrders,
  testScheduler
};