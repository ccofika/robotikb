const cron = require('node-cron');
const { WorkOrder, Technician } = require('../models');
const Vehicle = require('../models/Vehicle');
const notificationsRouter = require('../routes/notifications');
const createNotification = notificationsRouter.createNotification;
const androidNotificationService = require('./androidNotificationService');
const emailService = require('./emailService');
const ContactEvent = require('../models/ContactEvent');

// Koliko minuta pre termina se šalje podsetnik tehničarima
const REMINDER_LEAD_MINUTES = 30;
// Koliko minuta pre termina se adminima šalje alert ako korisnik nije kontaktiran
const UNCONTACTED_ALERT_LEAD_MINUTES = 15;

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

// Offset (u minutima) zone Europe/Belgrade u odnosu na UTC za dati trenutak (DST-aware).
// Ne zavisi od vremenske zone servera (Render radi u UTC).
function belgradeOffsetMinutes(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Belgrade',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
  const parts = {};
  fmt.formatToParts(date).forEach(p => { parts[p.type] = p.value; });
  const asUTC = Date.UTC(
    parseInt(parts.year), parseInt(parts.month) - 1, parseInt(parts.day),
    parseInt(parts.hour) % 24, parseInt(parts.minute)
  );
  return Math.round((asUTC - date.getTime()) / 60000);
}

// Pravi trenutak termina: kalendarski dan iz `date` + `time` (zidno vreme u Srbiji).
// NAPOMENA: appointmentDateTime u bazi je upisan setHours-om u zoni SERVERA (UTC),
// pa je pomeren za 1-2h u odnosu na stvarno beogradsko vreme — zato računamo ovde.
function getAppointmentInstant(workOrder) {
  if (!workOrder.date) return null;
  const d = new Date(workOrder.date);
  if (isNaN(d.getTime())) return null;

  let hours = 9, minutes = 0;
  if (workOrder.time && typeof workOrder.time === 'string') {
    const timeParts = workOrder.time.split(':');
    const h = parseInt(timeParts[0]);
    const m = parseInt(timeParts[1]);
    if (!isNaN(h) && h >= 0 && h <= 23) hours = h;
    if (!isNaN(m) && m >= 0 && m <= 59) minutes = m;
  }

  const utcGuess = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hours, minutes, 0, 0);
  const offset = belgradeOffsetMinutes(new Date(utcGuess));
  return new Date(utcGuess - offset * 60000);
}

// Podsetnik 30 minuta pre zakazanog termina — šalje push obojici tehničara na nalogu.
// Dodatno, 15 min pre termina: ako tehničar nije kliknuo "pozovi korisnika",
// adminima stiže web notifikacija. Poziva se svakog minuta.
async function checkUpcomingWorkOrderReminders() {
  if (process.env.WO_REMINDERS_DISABLED === 'true') return;

  try {
    const now = new Date();

    // Grubi prozor po appointmentDateTime — pomeren 1-2h zbog zone servera pri
    // upisu, a za termine u 00:xx i do ~11.5h jer pisci koriste `parseInt(h) || 9`
    // pa se ponoć upiše kao 09:xx. Precizna provera pravog termina je u JS ispod.
    const windowStart = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 12 * 60 * 60 * 1000);

    // Uključujemo i 'odlozen': odloženi nalog ima nov termin u date/time, a status
    // se prebacuje u 'nezavrsen' tek NAKON termina (hourly cron + tz pomak) — bez
    // ovoga odloženi nalozi nikad ne bi dobili podsetnik.
    const candidates = await WorkOrder.find({
      status: { $in: ['nezavrsen', 'odlozen'] },
      appointmentDateTime: { $gte: windowStart, $lte: windowEnd }
    })
      .select('_id date time address userName userPhone technicianId technician2Id appointmentDateTime reminderSentForAppointment reminderSentAt customerCallAttemptedAt uncontactedAlertSentForAppointment')
      .populate('technicianId', 'name')
      .populate('technician2Id', 'name');

    for (const workOrder of candidates) {
      const instant = getAppointmentInstant(workOrder);
      if (!instant) continue;

      const msUntil = instant.getTime() - now.getTime();
      // Prošli termini se preskaču (overdue sistem ih pokriva)
      if (msUntil <= 0 || msUntil > REMINDER_LEAD_MINUTES * 60 * 1000) continue;

      // technicianId/technician2Id su populate-ovani dokumenti — izvuci ID i ime
      const technicianEntries = [workOrder.technicianId, workOrder.technician2Id].filter(Boolean);
      if (technicianEntries.length === 0) continue;
      const technicianIds = technicianEntries.map(t => (t && t._id ? t._id : t).toString());

      // Identitet termina za dedup — menja se kad se nalog pomeri, pa se
      // podsetnik za novi termin šalje ponovo
      const identity = workOrder.appointmentDateTime || instant;

      // --- 1) Podsetnik tehničarima (do 30 min pre termina) ---
      const reminderAlreadySent = workOrder.reminderSentForAppointment &&
        workOrder.reminderSentForAppointment.getTime() === identity.getTime();

      if (!reminderAlreadySent) {
        // Atomski "claim" pre slanja — sprečava dupli podsetnik ako se ciklusi
        // preklope ili radi više instanci servera
        const claimed = await WorkOrder.updateOne(
          { _id: workOrder._id, reminderSentForAppointment: { $ne: identity } },
          { $set: { reminderSentForAppointment: identity, reminderSentAt: now } }
        );

        if (claimed.modifiedCount > 0) {
          const minutesUntil = Math.max(1, Math.round(msUntil / 60000));
          console.log(`⏰ Podsetnik: nalog ${workOrder._id} (${workOrder.address}) za ${minutesUntil} min — tehničari: ${technicianIds.join(', ')}`);

          let anyCreated = false;
          for (const technicianId of technicianIds) {
            try {
              const result = await androidNotificationService.createWorkOrderReminderNotification(technicianId, {
                address: workOrder.address || '',
                userName: workOrder.userName || '',
                userPhone: workOrder.userPhone || '',
                orderId: workOrder._id,
                minutesUntil,
                time: workOrder.time || ''
              });
              if (result && result.success) anyCreated = true;
            } catch (notifError) {
              console.error(`Greška pri slanju podsetnika tehničaru ${technicianId}:`, notifError.message);
            }
          }

          // Ako nijedna notifikacija nije ni KREIRANA (npr. baza privremeno nedostupna),
          // oslobodi claim da sledeći minut proba ponovo — prozor traje samo 30 min.
          if (!anyCreated) {
            await WorkOrder.updateOne(
              { _id: workOrder._id, reminderSentForAppointment: identity },
              { $set: { reminderSentForAppointment: null, reminderSentAt: null } }
            );
            console.warn(`⚠️ Podsetnik za nalog ${workOrder._id} nije kreiran — claim oslobođen, pokušaće ponovo.`);
          } else {
            // Trajni zapis za timeline na webu (fire-and-forget)
            const reminderTechNames = technicianEntries
              .map(t => (t && t.name) ? t.name : null).filter(Boolean).join(' i ');
            ContactEvent.create({
              workOrderId: workOrder._id,
              eventType: 'reminder_sent',
              at: now,
              technicianName: reminderTechNames
            }).catch(err => console.error('[ContactEvent] Upis reminder_sent nije uspeo:', err.message));
          }
        }
      }

      // --- 2) Alert adminima (do 15 min pre termina): korisnik nije kontaktiran ---
      if (msUntil <= UNCONTACTED_ALERT_LEAD_MINUTES * 60 * 1000) {
        await maybeSendUncontactedAlert(workOrder, technicianEntries, identity, now);
      }
    }
  } catch (error) {
    console.error('Greška pri slanju podsetnika za radne naloge:', error);
  }
}

// Alert adminima na web platformi kada tehničar nije kliknuo "pozovi korisnika"
// do 15 min pre termina. Uslovi: nalog ima telefon, podsetnik za OVAJ termin je
// poslat pre bar 5 min (da tehničar stigne da reaguje), poziv nije zabeležen.
async function maybeSendUncontactedAlert(workOrder, technicianEntries, identity, now) {
  try {
    // Poseban kill-switch: tehničari na staroj verziji aplikacije ne prijavljuju
    // klikove, pa njihovi nalozi generišu lažne alerte dok svi ne pređu na novu.
    if (process.env.UNCONTACTED_ALERTS_DISABLED === 'true') return;
    if (!workOrder.userPhone) return;
    // Poziv se računa kao kontakt samo ako je u poslednja 24h (stariji poziv je
    // verovatno bio za raniji termin istog naloga)
    if (workOrder.customerCallAttemptedAt &&
        (now.getTime() - workOrder.customerCallAttemptedAt.getTime()) < 24 * 60 * 60 * 1000) return;
    if (!workOrder.reminderSentForAppointment ||
        workOrder.reminderSentForAppointment.getTime() !== identity.getTime()) return;
    if (!workOrder.reminderSentAt ||
        (now.getTime() - workOrder.reminderSentAt.getTime()) < 5 * 60 * 1000) return;
    if (workOrder.uncontactedAlertSentForAppointment &&
        workOrder.uncontactedAlertSentForAppointment.getTime() === identity.getTime()) return;

    // Atomski claim — isti obrazac kao za podsetnik
    const claimed = await WorkOrder.updateOne(
      { _id: workOrder._id, uncontactedAlertSentForAppointment: { $ne: identity } },
      { $set: { uncontactedAlertSentForAppointment: identity } }
    );
    if (claimed.modifiedCount === 0) return;

    const technicianNames = technicianEntries
      .map(t => (t && t.name) ? t.name : null)
      .filter(Boolean)
      .join(' i ') || 'Nepoznat tehničar';

    const adminUsers = await Technician.find({ isAdmin: true }).select('_id name');
    console.log(`🚨 Korisnik nije kontaktiran: nalog ${workOrder._id} (${workOrder.address}) — obaveštavam ${adminUsers.length} admina`);

    let anyCreated = false;
    for (const adminUser of adminUsers) {
      try {
        await createNotification('customer_not_contacted', {
          workOrderId: workOrder._id,
          technicianNames,
          userName: workOrder.userName || '',
          address: workOrder.address || '',
          time: workOrder.time || '',
          recipientId: adminUser._id
        });
        anyCreated = true;
      } catch (notifError) {
        console.error(`Greška pri slanju alerta adminu ${adminUser.name}:`, notifError.message);
      }
    }

    if (!anyCreated) {
      await WorkOrder.updateOne(
        { _id: workOrder._id, uncontactedAlertSentForAppointment: identity },
        { $set: { uncontactedAlertSentForAppointment: null } }
      );
      console.warn(`⚠️ Alert za nalog ${workOrder._id} nije kreiran — claim oslobođen, pokušaće ponovo.`);
      return;
    }

    // Trajni zapis za timeline na webu (fire-and-forget)
    ContactEvent.create({
      workOrderId: workOrder._id,
      eventType: 'uncontacted_alert',
      at: now,
      technicianName: technicianNames
    }).catch(err => console.error('[ContactEvent] Upis uncontacted_alert nije uspeo:', err.message));

    // Mejl obaveštenje na fiksne adrese — JEDNOM po događaju (ne po adminu).
    // Fire-and-forget: neuspešan mejl ne sme da poremeti scheduler.
    const emailRecipients = (process.env.UNCONTACTED_ALERT_EMAILS || 'nikola.popovic@robotik.rs,office@robotik.rs')
      .split(',').map(e => e.trim()).filter(Boolean);
    const emailData = {
      technicianNames,
      userName: workOrder.userName || '',
      address: workOrder.address || '',
      municipality: workOrder.municipality || '',
      time: workOrder.time || ''
    };
    for (const addr of emailRecipients) {
      emailService.sendEmailToAddress(addr, 'customerNotContacted', emailData)
        .then(r => {
          if (r.success) console.log(`📧 Mejl "korisnik nije kontaktiran" poslat na ${addr}`);
          else console.error(`📧 Mejl "korisnik nije kontaktiran" na ${addr} NIJE poslat:`, r.error);
        })
        .catch(err => console.error(`📧 Mejl na ${addr} — greška:`, err.message));
    }
  } catch (error) {
    console.error('Greška pri alertu za nekontaktiranog korisnika:', error);
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

// Funkcija za proveru tehničara sa istekajućim ugovorom o zaposlenju
async function checkTechnicianEmployments() {
  try {
    const currentTime = new Date();
    const thirtyDaysFromNow = new Date(currentTime.getTime() + (30 * 24 * 60 * 60 * 1000));
    const tenDaysFromNow = new Date(currentTime.getTime() + (10 * 24 * 60 * 60 * 1000));

    // Pronađi aktivne tehničare sa ugovorom koji ističe u narednih 30 dana
    const techsExpiringIn30Days = await Technician.find({
      isActive: true,
      employedUntil: {
        $gte: currentTime,
        $lte: thirtyDaysFromNow
      }
    });

    // Pronađi aktivne tehničare sa ugovorom koji ističe u narednih 10 dana
    const techsExpiringIn10Days = await Technician.find({
      isActive: true,
      employedUntil: {
        $gte: currentTime,
        $lte: tenDaysFromNow
      }
    });

    if (techsExpiringIn30Days.length > 0 || techsExpiringIn10Days.length > 0) {
      // Pronađi sve admin korisnike za slanje notifikacija
      const adminUsers = await Technician.find({ isAdmin: true });

      if (adminUsers.length > 0) {
        // Kreiraj notifikacije za tehničare sa ugovorom koji ističe u narednih 10 dana (visoki prioritet)
        for (const tech of techsExpiringIn10Days) {
          for (const adminUser of adminUsers) {
            try {
              await createNotification('technician_employment_expiry', {
                technicianId: tech._id,
                technicianName: tech.name,
                expiryDate: tech.employedUntil,
                recipientId: adminUser._id
              });
            } catch (notificationError) {
              console.error(`Greška pri kreiranju notifikacije za tehničara ${tech.name}:`, notificationError);
            }
          }
        }

        // Kreiraj notifikacije za tehničare sa ugovorom koji ističe u narednih 30 dana (srednji prioritet)
        for (const tech of techsExpiringIn30Days) {
          // Proveri da li tehničar nije već pokriven u 10-dnevnoj proveri
          const isAlreadyCovered = techsExpiringIn10Days.some(t => t._id.toString() === tech._id.toString());

          if (!isAlreadyCovered) {
            for (const adminUser of adminUsers) {
              try {
                await createNotification('technician_employment_expiry', {
                  technicianId: tech._id,
                  technicianName: tech.name,
                  expiryDate: tech.employedUntil,
                  recipientId: adminUser._id
                });
              } catch (notificationError) {
                console.error(`Greška pri kreiranju notifikacije za tehničara ${tech.name}:`, notificationError);
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Greška pri proveri ugovora tehničara:', error);
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
  
  // Proveri vozila sa istekajućom registracijom i ugovore tehničara jednom dnevno u 9:00 ujutru
  cron.schedule('0 9 * * *', async () => {
    await checkVehicleRegistrations();
    await checkTechnicianEmployments();
  });

  // Podsetnik 30 min pre termina — proverava svakog minuta (jeftin indeksiran upit)
  cron.schedule('* * * * *', async () => {
    await checkUpcomingWorkOrderReminders();
  });

  console.log('Work Order Scheduler je pokrenut - proverava odložene i overdue radne naloge svakog sata, podsetnike svakog minuta');
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
  checkUpcomingWorkOrderReminders,
  getAppointmentInstant,
  checkVehicleRegistrations,
  ensureAppointmentDateTimeSet,
  testScheduler
};