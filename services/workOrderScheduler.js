const cron = require('node-cron');
const { WorkOrder, Technician } = require('../models');
const Vehicle = require('../models/Vehicle');
const notificationsRouter = require('../routes/notifications');
const createNotification = notificationsRouter.createNotification;

// Funkcija za proveru i ažuriranje odloženih radnih naloga
async function checkPostponedWorkOrders() {
  try {
    const currentTime = new Date();
    // console.log(`[${currentTime.toISOString()}] Checking for postponed work orders...`);
    
    // Prvo pronađi sve odložene radne naloge da vidimo šta imamo
    const allPostponedWorkOrders = await WorkOrder.find({
      status: 'odlozen'
    }).select('_id address postponedUntil');
    
    // console.log(`Ukupno odloženih radnih naloga: ${allPostponedWorkOrders.length}`);
    
    // if (allPostponedWorkOrders.length > 0) {
    //   allPostponedWorkOrders.forEach(wo => {
    //     console.log(`- ID: ${wo._id}, Address: ${wo.address}, PostponedUntil: ${wo.postponedUntil ? wo.postponedUntil.toISOString() : 'NIJE POSTAVLJENO'}, Current time: ${currentTime.toISOString()}`);
    //   });
    // }
    
    // Pronađi sve odložene radne naloge čije je vreme za obradu stiglo
    const workOrdersToUpdate = await WorkOrder.find({
      status: 'odlozen',
      postponedUntil: { $lte: currentTime }
    });
    
    // console.log(`Radnih naloga koji treba da se ažuriraju: ${workOrdersToUpdate.length}`);
    
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

// Funkcija za proveru radnih naloga koji su duže od 24 sata nezavršeni
async function checkOverdueWorkOrders() {
  try {
    const currentTime = new Date();
    const oneDayAgo = new Date(currentTime.getTime() - (24 * 60 * 60 * 1000)); // 24 sata u millisekunde
    
    // First, ensure all work orders have appointmentDateTime set
    await ensureAppointmentDateTimeSet();
    
    // Pronađi sve radne naloge sa statusom 'nezavrsen' koji su stariji od sat vremena
    // Koristimo appointmentDateTime za vreme kada treba da se odradi zadatak
    const overdueWorkOrders = await WorkOrder.find({
      status: 'nezavrsen',
      appointmentDateTime: { $lte: oneDayAgo }
    }).populate('technicianId', 'name email');
    
    if (overdueWorkOrders.length > 0) {
      console.log(`Pronađeno ${overdueWorkOrders.length} radnih naloga koji su duži od 24 sata nezavršeni`);
      
      // Dodaj overdue flag na svaki radni nalog
      const updateResult = await WorkOrder.updateMany(
        {
          status: 'nezavrsen',
          appointmentDateTime: { $lte: oneDayAgo },
          isOverdue: { $ne: true } // Samo ako već nije označen kao overdue
        },
        {
          $set: {
            isOverdue: true,
            overdueMarkedAt: currentTime
          }
        }
      );
      
      console.log(`Označeno ${updateResult.modifiedCount} radnih naloga kao overdue`);
      
      // Log za svaki overdue radni nalog
      overdueWorkOrders.forEach(workOrder => {
        if (!workOrder.isOverdue) {
          console.log(`Radni nalog ${workOrder._id} (${workOrder.address}) označen kao overdue - trebao je biti završen ${workOrder.appointmentDateTime}`);
        }
      });
    }
  } catch (error) {
    console.error('Greška pri proveri overdue radnih naloga:', error);
  }
}

// Helper function to ensure appointmentDateTime is set for all work orders
async function ensureAppointmentDateTimeSet() {
  try {
    // Find work orders without appointmentDateTime
    const workOrdersWithoutDateTime = await WorkOrder.find({
      appointmentDateTime: { $exists: false }
    });
    
    if (workOrdersWithoutDateTime.length > 0) {
      console.log(`Setting appointmentDateTime for ${workOrdersWithoutDateTime.length} work orders`);
      
      const bulkOps = workOrdersWithoutDateTime.map(workOrder => {
        // Parse time (format: "09:00" or "9:00")
        let [hours, minutes] = [9, 0];
        if (workOrder.time && typeof workOrder.time === 'string') {
          const timeParts = workOrder.time.split(':');
          hours = parseInt(timeParts[0]) || 9;
          minutes = parseInt(timeParts[1]) || 0;
        }
        
        // Create appointmentDateTime by combining date and time
        const appointmentDateTime = new Date(workOrder.date);
        appointmentDateTime.setHours(hours, minutes, 0, 0);
        
        return {
          updateOne: {
            filter: { _id: workOrder._id },
            update: { $set: { appointmentDateTime } }
          }
        };
      });
      
      await WorkOrder.bulkWrite(bulkOps);
      console.log(`Successfully set appointmentDateTime for ${workOrdersWithoutDateTime.length} work orders`);
    }
  } catch (error) {
    console.error('Error setting appointmentDateTime:', error);
  }
}

// Funkcija za proveru vozila sa istekajućom registracijom
async function checkVehicleRegistrations() {
  try {
    const currentTime = new Date();
    const thirtyDaysFromNow = new Date(currentTime.getTime() + (30 * 24 * 60 * 60 * 1000));
    const tenDaysFromNow = new Date(currentTime.getTime() + (10 * 24 * 60 * 60 * 1000));
    
    // Pronađi vozila sa registracijom koja ističe u narednih 30 dana
    const vehiclesExpiringIn30Days = await Vehicle.find({
      registrationExpiry: {
        $gte: currentTime,
        $lte: thirtyDaysFromNow
      },
      status: { $ne: 'sold' } // Isključi prodana vozila
    });
    
    // Pronađi vozila sa registracijom koja ističe u narednih 10 dana
    const vehiclesExpiringIn10Days = await Vehicle.find({
      registrationExpiry: {
        $gte: currentTime,
        $lte: tenDaysFromNow
      },
      status: { $ne: 'sold' }
    });
    
    if (vehiclesExpiringIn30Days.length > 0 || vehiclesExpiringIn10Days.length > 0) {
      
      // Pronađi sve admin korisnike za slanje notifikacija
      const adminUsers = await Technician.find({ isAdmin: true });
      
      if (adminUsers.length > 0) {
        // Kreiraj notifikacije za vozila sa registracijom koja ističe u narednih 10 dana (visoki prioritet)
        for (const vehicle of vehiclesExpiringIn10Days) {
          const daysUntilExpiry = Math.ceil((vehicle.registrationExpiry.getTime() - currentTime.getTime()) / (24 * 60 * 60 * 1000));
          
          for (const adminUser of adminUsers) {
            try {
              await createNotification('vehicle_registration_expiry', {
                vehicleId: vehicle._id,
                vehicleName: vehicle.name,
                licensePlate: vehicle.licensePlate,
                expiryDate: vehicle.registrationExpiry,
                recipientId: adminUser._id
              });
              
            } catch (notificationError) {
              console.error(`Greška pri kreiranju notifikacije za vozilo ${vehicle.name}:`, notificationError);
            }
          }
        }
        
        // Kreiraj notifikacije za vozila sa registracijom koja ističe u narednih 30 dana (srednji prioritet)
        for (const vehicle of vehiclesExpiringIn30Days) {
          // Proveri da li vozilo nije već pokriveno u 10-dnevnoj proveri
          const isAlreadyCovered = vehiclesExpiringIn10Days.some(v => v._id.toString() === vehicle._id.toString());
          
          if (!isAlreadyCovered) {
            const daysUntilExpiry = Math.ceil((vehicle.registrationExpiry.getTime() - currentTime.getTime()) / (24 * 60 * 60 * 1000));
            
            for (const adminUser of adminUsers) {
              try {
                await createNotification('vehicle_registration_expiry', {
                  vehicleId: vehicle._id,
                  vehicleName: vehicle.name,
                  licensePlate: vehicle.licensePlate,
                  expiryDate: vehicle.registrationExpiry,
                  recipientId: adminUser._id
                });
                
                } catch (notificationError) {
                console.error(`Greška pri kreiranju notifikacije za vozilo ${vehicle.name}:`, notificationError);
              }
            }
          }
        }
      } else {
      }
    }
  } catch (error) {
    console.error('Greška pri proveri registracije vozila:', error);
  }
}

// Pokretanje scheduler-a
function startWorkOrderScheduler() {
  console.log('Pokretanje Work Order Scheduler-a...');
  
  // Pokreni svakog sata na početku sata (0 minuta)
  cron.schedule('0 * * * *', async () => {
    await checkPostponedWorkOrders();
    await checkOverdueWorkOrders();
  });
  
  // Proveri vozila sa istekajućom registracijom jednom dnevno u 9:00 ujutru
  cron.schedule('0 9 * * *', async () => {
    await checkVehicleRegistrations();
  });
  
  console.log('Work Order Scheduler je pokrenut - proverava odložene i overdue radne naloge svakog sata');
}

// Ručno testiranje scheduler-a
async function testScheduler() {
  console.log('=== MANUAL SCHEDULER TEST ===');
  await checkPostponedWorkOrders();
  await checkOverdueWorkOrders();
  await checkVehicleRegistrations();
  console.log('=== TEST COMPLETED ===');
}

module.exports = {
  startWorkOrderScheduler,
  checkPostponedWorkOrders,
  checkOverdueWorkOrders,
  checkVehicleRegistrations,
  ensureAppointmentDateTimeSet,
  testScheduler
};