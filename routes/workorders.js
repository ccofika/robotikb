// Kompletna zamena za fajl: routes/workorders.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const xlsx = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const { WorkOrder, User, Technician, Equipment, Material } = require('../models');
const WorkOrderEvidence = require('../models/WorkOrderEvidence');
const AdminActivityLog = require('../models/AdminActivityLog');
const FinancialTransaction = require('../models/FinancialTransaction');
const FinancialSettings = require('../models/FinancialSettings');
const FailedFinancialTransaction = require('../models/FailedFinancialTransaction');
const MunicipalityDiscountConfirmation = require('../models/MunicipalityDiscountConfirmation');
const { uploadImage, deleteImage, uploadVoiceRecording, deleteVoiceRecording } = require('../config/cloudinary');
const convert = require('heic-convert');
const { logActivity } = require('../middleware/activityLogger');
const { auth } = require('../middleware/auth');

// Helper funkcija za case-insensitive pretragu serijskog broja
const findEquipmentBySerialNumber = (serialNumber) => {
  // Escape special regex characters
  const escapedSerial = serialNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Equipment.findOne({
    serialNumber: { $regex: new RegExp(`^${escapedSerial}$`, 'i') }
  });
};
const {
  logCommentAdded,
  logWorkOrderStatusChanged,
  logImageAdded,
  logImageRemoved,
  logMaterialAdded,
  logMaterialRemoved,
  logWorkOrderCreated,
  logWorkOrderAssigned,
  logWorkOrderUpdated,
  checkMaterialAnomaly
} = require('../utils/logger');
const { testScheduler } = require('../services/workOrderScheduler');
const notificationsRouter = require('./notifications');
const createNotification = notificationsRouter.createNotification;

// Pomoćna funkcija za brisanje failed transaction zapisa
async function removeFailedFinancialTransaction(workOrderId) {
  try {
    await FailedFinancialTransaction.findOneAndDelete({ workOrderId: workOrderId });
  } catch (error) {
    console.error('Error removing failed financial transaction:', error);
  }
}

// Pomoćna funkcija za kreiranje failed transaction zapisa
async function createFailedFinancialTransaction(workOrderId, failureReason, failureMessage, missingFields = [], pendingConfirmations = []) {
  try {
    // Pronađi osnovne podatke o radnom nalogu
    const workOrder = await WorkOrder.findById(workOrderId).populate('technicianId technician2Id');
    const evidence = await WorkOrderEvidence.findOne({ workOrderId: workOrderId });

    const workOrderDetails = {
      tisJobId: workOrder?.tisJobId || '',
      address: workOrder?.address || '',
      municipality: workOrder?.municipality || '',
      technicianNames: [
        workOrder?.technicianId?.name,
        workOrder?.technician2Id?.name
      ].filter(Boolean),
      customerStatus: evidence?.customerStatus || '',
      status: workOrder?.status || '',
      verified: workOrder?.verified || false
    };

    // Proveri da li već postoji zapis
    const existingFailed = await FailedFinancialTransaction.findOne({ workOrderId });

    if (existingFailed) {
      // Ažuriraj postojeći zapis
      existingFailed.attemptCount += 1;
      existingFailed.lastAttemptAt = new Date();
      existingFailed.failureReason = failureReason;
      existingFailed.failureMessage = failureMessage;
      existingFailed.missingFields = missingFields;
      existingFailed.workOrderDetails = workOrderDetails;
      existingFailed.requiresAdminAction = failureReason === 'PENDING_DISCOUNT_CONFIRMATION';
      if (pendingConfirmations.length > 0) {
        existingFailed.pendingDiscountConfirmation = pendingConfirmations[0];
      }
      await existingFailed.save();
    } else {
      // Kreiraj novi zapis
      const failedTransaction = new FailedFinancialTransaction({
        workOrderId,
        failureReason,
        failureMessage,
        missingFields,
        workOrderDetails,
        requiresAdminAction: failureReason === 'PENDING_DISCOUNT_CONFIRMATION',
        pendingDiscountConfirmation: pendingConfirmations.length > 0 ? pendingConfirmations[0] : undefined
      });
      await failedTransaction.save();
    }

    console.log('Failed financial transaction logged for work order:', workOrderId);
  } catch (error) {
    console.error('Error creating failed financial transaction:', error);
  }
}

// Pomoćna funkcija za kreiranje finansijske transakcije
async function createFinancialTransaction(workOrderId) {
  try {
    console.log('=== CREATING FINANCIAL TRANSACTION ===');
    console.log('WorkOrder ID:', workOrderId);

    // PROVERA: Da li je radni nalog isključen iz finansijskih kalkulacija
    const excludedTransaction = await FailedFinancialTransaction.findOne({
      workOrderId: workOrderId,
      excludedFromFinances: true
    });
    if (excludedTransaction) {
      console.log('Work order is excluded from financial calculations');
      return;
    }

    // Proveri da li transakcija već postoji
    const existingTransaction = await FinancialTransaction.findOne({ workOrderId: workOrderId });
    if (existingTransaction) {
      console.log('Financial transaction already exists for this work order');
      await removeFailedFinancialTransaction(workOrderId);
      return;
    }

    // VALIDACIJA 1: Pronađi radni nalog
    const workOrder = await WorkOrder.findById(workOrderId).populate('technicianId technician2Id');
    if (!workOrder) {
      console.log('WorkOrder not found');
      await createFailedFinancialTransaction(
        workOrderId,
        'WORK_ORDER_NOT_FOUND',
        'Radni nalog nije pronađen u bazi podataka',
        [{ field: 'workOrder', description: 'Radni nalog ne postoji' }]
      );
      return;
    }

    // VALIDACIJA 2: Pronađi WorkOrderEvidence
    const evidence = await WorkOrderEvidence.findOne({ workOrderId: workOrderId });
    if (!evidence) {
      console.log('WorkOrderEvidence not found');
      await createFailedFinancialTransaction(
        workOrderId,
        'MISSING_WORK_ORDER_EVIDENCE',
        'WorkOrderEvidence zapis nije pronađen za ovaj radni nalog',
        [{ field: 'workOrderEvidence', description: 'Potrebno je kreirati WorkOrderEvidence zapis' }]
      );
      return;
    }

    // VALIDACIJA 3: CustomerStatus mora postojati
    if (!evidence.customerStatus) {
      console.log('CustomerStatus not set in evidence');
      await createFailedFinancialTransaction(
        workOrderId,
        'MISSING_CUSTOMER_STATUS',
        'CustomerStatus nije postavljen u WorkOrderEvidence zapisu',
        [{ field: 'customerStatus', description: 'Potrebno je postaviti tip usluge (customerStatus) u evidenciji radnog naloga' }]
      );
      return;
    }

    // VALIDACIJA 4: Finansijske postavke moraju postojati
    const settings = await FinancialSettings.findOne();
    if (!settings) {
      console.log('Financial settings not found');
      await createFailedFinancialTransaction(
        workOrderId,
        'MISSING_FINANCIAL_SETTINGS',
        'Finansijske postavke nisu konfigurisane u sistemu',
        [{ field: 'financialSettings', description: 'Potrebno je konfigurisati finansijske postavke u Finansije sekciji' }]
      );
      return;
    }

    // VALIDACIJA 5: Osnovna cena mora postojati za dati tip usluge
    const basePrice = settings.pricesByCustomerStatus[evidence.customerStatus] || 0;
    console.log('Base price for', evidence.customerStatus, ':', basePrice);

    if (basePrice === 0) {
      console.log('No price configured for customer status:', evidence.customerStatus);
      await createFailedFinancialTransaction(
        workOrderId,
        'NO_PRICE_FOR_CUSTOMER_STATUS',
        `Cena nije postavljena za tip usluge: ${evidence.customerStatus}`,
        [{ field: 'pricesByCustomerStatus', description: `Potrebno je postaviti cenu za tip usluge "${evidence.customerStatus}" u Finansije sekciji` }]
      );
      return;
    }

    // VALIDACIJA 6: Tehnički moraju biti dodeljeni
    const technicians = [];
    if (workOrder.technicianId) {
      technicians.push({
        technicianId: workOrder.technicianId._id,
        name: workOrder.technicianId.name
      });
    }
    if (workOrder.technician2Id) {
      technicians.push({
        technicianId: workOrder.technician2Id._id,
        name: workOrder.technician2Id.name
      });
    }

    if (technicians.length === 0) {
      console.log('No technicians assigned to work order');
      await createFailedFinancialTransaction(
        workOrderId,
        'NO_TECHNICIANS_ASSIGNED',
        'Nijedan tehničar nije dodeljen radnom nalogu',
        [{ field: 'technicianId', description: 'Potrebno je dodeliti najmanje jednog tehničara radnom nalogu' }]
      );
      return;
    }

    // VALIDACIJA 7: Učitaj tehničare sa tipovima plaćanja
    const technicianIds = technicians.map(t => t.technicianId);
    const technicianDocs = await Technician.find({ _id: { $in: technicianIds } }).lean();

    // Mapa za brz pristup
    const technicianMap = {};
    technicianDocs.forEach(doc => {
      technicianMap[doc._id.toString()] = doc;
    });

    // Helper funkcija za računanje koliko je tehničar već zaradio ovog meseca
    // NAPOMENA: Ova funkcija može imati race condition problem ako se više transakcija
    // procesira istovremeno za istog tehničara. U produkciji bi trebalo koristiti
    // MongoDB transactions ili optimistic locking za sprečavanje ovog problema.
    const getTechnicianMonthlyEarnings = async (technicianId) => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      const transactions = await FinancialTransaction.find({
        'technicians.technicianId': technicianId,
        verifiedAt: { $gte: startOfMonth, $lte: endOfMonth }
      }).lean();

      let totalEarned = 0;
      transactions.forEach(tx => {
        const techEntry = tx.technicians.find(t => t.technicianId.toString() === technicianId.toString());
        if (techEntry && techEntry.paymentType === 'plata' && techEntry.salaryDetails) {
          totalEarned += techEntry.salaryDetails.earnedTowardsSalary || 0;
        }
      });

      return totalEarned;
    };

    // VALIDACIJA 7: Cene za tehničare moraju postojati
    let totalTechnicianExpenses = 0;
    for (const tech of technicians) {
      const techDoc = technicianMap[tech.technicianId.toString()];
      if (!techDoc) {
        console.log('Technician document not found:', tech.technicianId);
        await createFailedFinancialTransaction(
          workOrderId,
          'TECHNICIAN_NOT_FOUND',
          `Tehničar "${tech.name}" nije pronađen u bazi`,
          [{ field: 'technician', description: `Tehničar "${tech.name}" ne postoji u sistemu` }]
        );
        return;
      }

      tech.paymentType = techDoc.paymentType || 'po_statusu';

      if (tech.paymentType === 'po_statusu') {
        // Stari način - po statusu naloga
        const technicianPricing = settings.technicianPrices.find(
          tp => tp.technicianId.toString() === tech.technicianId.toString()
        );

        if (!technicianPricing || !technicianPricing.pricesByCustomerStatus[evidence.customerStatus]) {
          console.log('Missing technician pricing for:', tech.name, 'customer status:', evidence.customerStatus);
          await createFailedFinancialTransaction(
            workOrderId,
            'MISSING_TECHNICIAN_PRICING',
            `Cena za tehničara "${tech.name}" nije postavljena za tip usluge: ${evidence.customerStatus}`,
            [{ field: 'technicianPrices', description: `Potrebno je postaviti cenu za tehničara "${tech.name}" za tip usluge "${evidence.customerStatus}" u Finansije sekciji` }]
          );
          return;
        }

        const technicianPrice = technicianPricing.pricesByCustomerStatus[evidence.customerStatus];
        tech.earnings = technicianPrice;
        totalTechnicianExpenses += technicianPrice;

        // Nema dodatnih detalja za po_statusu
        tech.salaryDetails = undefined;

      } else if (tech.paymentType === 'plata') {
        // Novi način - mesečna plata
        if (!techDoc.monthlySalary || techDoc.monthlySalary === 0) {
          console.log('Monthly salary not set for:', tech.name);
          await createFailedFinancialTransaction(
            workOrderId,
            'MISSING_MONTHLY_SALARY',
            `Mesečna plata za tehničara "${tech.name}" nije postavljena`,
            [{ field: 'monthlySalary', description: `Potrebno je postaviti mesečnu platu za tehničara "${tech.name}" u Finansije sekciji` }]
          );
          return;
        }

        // Ovde će biti logika za platu - za sada samo inicijalizujemo
        tech.salaryDetails = {
          monthlySalary: techDoc.monthlySalary,
          earnedTowardsSalary: 0,
          previouslyEarned: 0,
          exceededSalary: false,
          excessAmount: 0
        };
        tech.earnings = 0; // Biće računato kasnije u novoj logici
      }
    }

    // VALIDACIJA 8: Popust po opštini - proveri da li je potvrđen
    let discount = 0;
    if (workOrder.municipality) {
      // Prvo proveri da li je popust potvrđen u MunicipalityDiscountConfirmation
      const confirmedDiscount = await MunicipalityDiscountConfirmation.findOne({
        municipality: workOrder.municipality
      });

      if (confirmedDiscount && confirmedDiscount.confirmedByAdmin) {
        discount = confirmedDiscount.discountPercent;
        console.log('Using confirmed discount for', workOrder.municipality, ':', discount, '%');
      } else {
        // Proveri da li postoji u settings
        const municipalDiscount = settings.discountsByMunicipality.find(
          d => d.municipality === workOrder.municipality
        );

        if (municipalDiscount && municipalDiscount.discountPercent >= 0) {
          discount = municipalDiscount.discountPercent;
          console.log('Using settings discount for', workOrder.municipality, ':', discount, '%');
        } else {
          // Nema popusta u settings - treba admin potvrda za 0% popust
          console.log('Discount not confirmed for municipality:', workOrder.municipality);
          await createFailedFinancialTransaction(
            workOrderId,
            'PENDING_DISCOUNT_CONFIRMATION',
            `Popust za opštinu "${workOrder.municipality}" nije potvrđen od strane administratora`,
            [{ field: 'municipalDiscount', description: `Potrebno je potvrditi popust za opštinu "${workOrder.municipality}"` }],
            [{
              municipality: workOrder.municipality,
              suggestedDiscount: 0
            }]
          );
          return;
        }
      }
    }

    // KALKULACIJA PRIHODA
    const finalRevenue = basePrice * (1 - discount / 100); // PRIHOD nakon popusta

    // KALKULACIJA RASHODA - nova logika sa platom
    let remainingRevenue = finalRevenue; // Ovo je prihod koji je dostupan za raspodelu

    // Prvo sortiramo tehničare: prvo oni "po_statusu", pa oni sa "plata"
    const sortedTechnicians = [...technicians].sort((a, b) => {
      if (a.paymentType === 'po_statusu' && b.paymentType === 'plata') return -1;
      if (a.paymentType === 'plata' && b.paymentType === 'po_statusu') return 1;
      return 0;
    });

    // Prvo obradimo sve tehničare "po_statusu"
    for (const tech of sortedTechnicians) {
      if (tech.paymentType === 'po_statusu') {
        // Tehničar po statusu dobija svoju cenu, a ta cena se oduzima od remainingRevenue
        remainingRevenue -= tech.earnings;
      }
    }

    // EDGE CASE: Ako je remainingRevenue negativan, znači da troškovi tehničara po statusu
    // prekoračuju prihod. To je validan scenario - kompanija pravi gubitak.
    // U tom slučaju, tehničari sa platom ne dobijaju ništa.

    // Sada obradimo tehničare sa "plata" - oni dobijaju ostatak
    for (const tech of sortedTechnicians) {
      if (tech.paymentType === 'plata') {
        // Učitaj koliko je tehničar već zaradio ovog meseca
        const previouslyEarned = await getTechnicianMonthlyEarnings(tech.technicianId);
        tech.salaryDetails.previouslyEarned = previouslyEarned;

        const monthlySalary = tech.salaryDetails.monthlySalary;
        const remainingToSalary = monthlySalary - previouslyEarned; // Koliko još treba da zaradi do plate

        // EDGE CASE: remainingToSalary može biti negativan ako je tehničar već zaradio više od plate
        // (npr. ako je plata smanjena tokom meseca). U tom slučaju, smatramo da je dostigao platu.
        if (remainingToSalary > 0 && remainingRevenue > 0) {
          // Tehničar još nije dostigao platu i ima prihoda za raspodelu
          if (remainingRevenue >= remainingToSalary) {
            // Ima dovoljno prihoda da dostigne platu
            tech.salaryDetails.earnedTowardsSalary = remainingToSalary;
            tech.earnings = remainingToSalary;
            totalTechnicianExpenses += remainingToSalary;
            remainingRevenue -= remainingToSalary;
            tech.salaryDetails.exceededSalary = false;
            tech.salaryDetails.excessAmount = 0;
          } else {
            // Nema dovoljno prihoda da dostigne platu, uzima sve što je ostalo
            tech.salaryDetails.earnedTowardsSalary = remainingRevenue;
            tech.earnings = remainingRevenue;
            totalTechnicianExpenses += remainingRevenue;
            remainingRevenue = 0;
            tech.salaryDetails.exceededSalary = false;
            tech.salaryDetails.excessAmount = 0;
          }
        } else if (remainingToSalary > 0 && remainingRevenue <= 0) {
          // Tehničar nije dostigao platu ali nema prihoda za raspodelu
          tech.salaryDetails.earnedTowardsSalary = 0;
          tech.earnings = 0;
          tech.salaryDetails.exceededSalary = false;
          tech.salaryDetails.excessAmount = 0;
        } else {
          // Tehničar je već dostigao platu (remainingToSalary <= 0), sve što bi dobio ide u profit
          tech.salaryDetails.earnedTowardsSalary = 0;
          tech.earnings = 0;
          tech.salaryDetails.exceededSalary = true;
          tech.salaryDetails.excessAmount = 0;
          // remainingRevenue ostaje isti - ne oduzimamo ništa jer ide u profit
        }
      }
    }

    // Zamenjujemo nazad u originalni niz
    technicians.length = 0;
    technicians.push(...sortedTechnicians);

    const totalExpenses = totalTechnicianExpenses; // RASHOD
    const companyProfit = finalRevenue - totalExpenses; // PROFIT

    // EDGE CASE: companyProfit može biti negativan ako su troškovi veći od prihoda

    console.log('Financial calculation:');
    console.log('- Base price:', basePrice);
    console.log('- Discount:', discount, '%');
    console.log('- Final revenue:', finalRevenue);
    console.log('- Technician expenses:', totalExpenses);
    console.log('- Company profit:', companyProfit);
    console.log('- Technicians breakdown:', technicians.map(t => ({
      name: t.name,
      paymentType: t.paymentType,
      earnings: t.earnings,
      salaryDetails: t.salaryDetails
    })));

    // Kreiraj transakciju
    // Odrediti pravi datum za finansijsku transakciju
    // Koristimo datum kada je radni nalog stvarno završen, a ne kada je verifikovan
    let transactionDate = new Date(); // fallback na trenutni datum

    if (workOrder.statusChangedAt && workOrder.status === 'zavrsen') {
      // Ako postoji datum kada je status promenjen na "zavrsen", koristi taj datum
      transactionDate = workOrder.statusChangedAt;
      console.log('Using statusChangedAt as transaction date:', transactionDate);
    } else if (workOrder.date) {
      // Ako nema statusChangedAt, koristi datum radnog naloga kao fallback
      transactionDate = workOrder.date;
      console.log('Using work order date as transaction date:', transactionDate);
    } else {
      console.log('Using current date as transaction date fallback:', transactionDate);
    }

    const transaction = new FinancialTransaction({
      workOrderId: workOrderId,
      customerStatus: evidence.customerStatus,
      municipality: workOrder.municipality,
      basePrice: basePrice,
      discountPercent: discount,
      discountAmount: basePrice * (discount / 100),
      finalPrice: finalRevenue, // Ovo je PRIHOD
      technicians: technicians,
      totalTechnicianEarnings: totalExpenses, // Ovo je RASHOD
      companyProfit: companyProfit,
      verifiedAt: transactionDate // Koristimo pravi datum završetka, ne datum verifikacije
    });

    await transaction.save();
    console.log('Financial transaction created successfully');

    // Ukloni failed zapis ako postoji
    await removeFailedFinancialTransaction(workOrderId);

  } catch (error) {
    console.error('Error creating financial transaction:', error);
    await createFailedFinancialTransaction(
      workOrderId,
      'OTHER_ERROR',
      `Greška pri kreiranju finansijske transakcije: ${error.message}`,
      [{ field: 'system', description: 'Sistemska greška - kontaktirajte administratora' }]
    );
  }
}

// Funkcija za kreiranje WorkOrderEvidence zapisa
async function createWorkOrderEvidence(workOrder) {
  try {
    // Kreiranje osnovnog WorkOrderEvidence zapisa sa bezbedom za postojeće workorder objekte
    const evidenceData = {
      workOrderId: workOrder._id,
      tisJobId: workOrder.tisJobId || `generated-${Date.now()}`,
      tisId: workOrder.tisId || `tisid-${Date.now()}`,
      customerName: workOrder.userName || 'Nepoznat korisnik',
      customerStatus: 'Priključenje korisnika na HFC KDS mreža u zgradi sa instalacijom CPE opreme (izrada kompletne instalacije od RO do korisnika sa instalacijom kompletne CPE opreme)',
      userPhone: workOrder.userPhone || '',
      municipality: workOrder.municipality || 'Nepoznata opština',
      address: workOrder.address || 'Nepoznata adresa',
      technician1: '', // Biće popunjeno kada se dodeli tehničar
      technician2: '',
      status: workOrder.status === 'zavrsen' ? 'ZAVRŠENO' : 
              workOrder.status === 'otkazan' ? 'OTKAZANO' : 
              workOrder.status === 'odlozen' ? 'ODLOŽENO' : 'U TOKU',
      executionDate: workOrder.date ? new Date(workOrder.date) : new Date(),
      notes: workOrder.comment || '',
      orderType: workOrder.type || 'Nespecifikovano',
      servicePackage: workOrder.additionalJobs || '',
      technology: workOrder.technology || 'other',
      verified: workOrder.verified || false,
      installedEquipment: [],
      removedEquipment: [],
      changeHistory: []
    };

    // Dodeli imena tehničara ako postoje i ako su validni ObjectId
    if (workOrder.technicianId) {
      try {
        // Proveri da li je technicianId string ili objekat
        const technicianId = workOrder.technicianId._id || workOrder.technicianId;
        if (mongoose.Types.ObjectId.isValid(technicianId)) {
          const technician = await Technician.findById(technicianId);
          if (technician) {
            evidenceData.technician1 = technician.name;
          }
        }
      } catch (techError) {
        console.warn('Greška pri pronalaženju tehničara 1:', techError.message);
        evidenceData.technician1 = 'Nepoznat tehničar';
      }
    }

    if (workOrder.technician2Id) {
      try {
        // Proveri da li je technician2Id string ili objekat
        const technician2Id = workOrder.technician2Id._id || workOrder.technician2Id;
        if (mongoose.Types.ObjectId.isValid(technician2Id)) {
          const technician2 = await Technician.findById(technician2Id);
          if (technician2) {
            evidenceData.technician2 = technician2.name;
          }
        }
      } catch (tech2Error) {
        console.warn('Greška pri pronalaženju tehničara 2:', tech2Error.message);
        evidenceData.technician2 = 'Nepoznat tehničar';
      }
    }

    console.log('Kreiram WorkOrderEvidence sa podacima:', JSON.stringify(evidenceData, null, 2));

    const evidence = new WorkOrderEvidence(evidenceData);
    await evidence.save();
    
    console.log('WorkOrderEvidence kreiran za WorkOrder:', workOrder._id);
    return evidence;
  } catch (error) {
    console.error('Greška pri kreiranju WorkOrderEvidence:', error);
    console.error('Stack trace:', error.stack);
    throw error;
  }
}

// Funkcija za ažuriranje WorkOrderEvidence zapisa
async function updateWorkOrderEvidence(workOrderId, updateData) {
  try {
    let evidence = await WorkOrderEvidence.findOne({ workOrderId });

    if (!evidence) {
      // Ako evidencija ne postoji, kreiraj je
      console.log('WorkOrderEvidence nije pronađen za WorkOrder:', workOrderId, '- kreiram novu evidenciju');
      const workOrder = await WorkOrder.findById(workOrderId);
      if (workOrder) {
        evidence = await createWorkOrderEvidence(workOrder);
        if (!evidence) {
          console.log('Nije moguće kreirati WorkOrderEvidence za WorkOrder:', workOrderId);
          return null;
        }
      } else {
        console.log('WorkOrder nije pronađen:', workOrderId);
        return null;
      }
    }

    // Ažuriranje osnovnih podataka
    Object.keys(updateData).forEach(key => {
      if (key in evidence.schema.paths) {
        evidence[key] = updateData[key];
      }
    });

    await evidence.save();
    console.log('WorkOrderEvidence ažuriran za WorkOrder:', workOrderId);
    return evidence;
  } catch (error) {
    console.error('Greška pri ažuriranju WorkOrderEvidence:', error);
    throw error;
  }
}



// Konfiguracija za upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)){
      fs.mkdirSync(uploadsDir);
    }
    
    const workordersUploadsDir = path.join(uploadsDir, 'workorders');
    if (!fs.existsSync(workordersUploadsDir)){
      fs.mkdirSync(workordersUploadsDir);
    }
    
    cb(null, workordersUploadsDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const originalName = file.originalname;
    // Zamena razmaka sa '_'
    const fileName = originalName.replace(/\s+/g, '_');
    cb(null, `${timestamp}-${fileName}`);
  }
});

// Konfiguracija za upload slika
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)){
      fs.mkdirSync(uploadsDir);
    }
    
    const imagesDir = path.join(uploadsDir, 'images');
    if (!fs.existsSync(imagesDir)){
      fs.mkdirSync(imagesDir);
    }
    
    cb(null, imagesDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const originalName = file.originalname;
    // Zamena razmaka sa '_'
    const fileName = originalName.replace(/\s+/g, '_');
    cb(null, `${timestamp}-${fileName}`);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
        file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new Error('Samo Excel fajlovi su dozvoljeni!'), false);
    }
  }
});

const imageUpload = multer({
  storage: multer.memoryStorage(), // Koristimo memory storage za Cloudinary
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Samo slike su dozvoljene!'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB - povećano jer će Cloudinary kompresovati
  }
});



// GET - Dohvati sve radne naloge
router.get('/', async (req, res) => {
  try {
    const { recent, page, limit, search, status, municipality, technician, lastMonthOnly } = req.query;
    const startTime = Date.now();

    // Server-side pagination support
    if (page && limit) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 24;
      const skip = (pageNum - 1) * limitNum;

      let query = {};

      // Last month filter for Edit page
      if (lastMonthOnly === 'true') {
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        query.date = { $gte: oneMonthAgo };
      }

      // Search filter
      if (search) {
        query.$or = [
          { tisId: { $regex: search, $options: 'i' } },
          { userName: { $regex: search, $options: 'i' } },
          { address: { $regex: search, $options: 'i' } },
          { municipality: { $regex: search, $options: 'i' } }
        ];
      }

      // Status filter
      if (status) {
        query.status = status;
      }

      // Municipality filter
      if (municipality) {
        query.municipality = municipality;
      }

      // Technician filter
      if (technician) {
        query.$or = [
          { technicianId: technician },
          { technician2Id: technician }
        ];
      }

      // Get total count
      const totalCount = await WorkOrder.countDocuments(query);

      // Get paginated results
      const workOrders = await WorkOrder.find(query)
        .populate('technicianId', 'name _id')
        .populate('technician2Id', 'name _id')
        .populate('statusChangedBy', 'name _id')
        .populate('materials.material', 'type')
        .sort({ date: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean()
        .exec();

      const duration = Date.now() - startTime;
      const totalPages = Math.ceil(totalCount / limitNum);

      res.json({
        workOrders,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalCount,
          limit: limitNum,
          hasNextPage: pageNum < totalPages,
          hasPreviousPage: pageNum > 1
        },
        performance: {
          queryTime: duration,
          resultsPerPage: workOrders.length
        }
      });
    } else {
      // Original behavior for backward compatibility
      let query = {};
      let sort = { date: -1 };

      if (recent) {
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(recent));
        query.date = { $gte: daysAgo };
      }

      const workOrders = await WorkOrder.find(query)
        .populate('technicianId', 'name _id')
        .populate('technician2Id', 'name _id')
        .populate('statusChangedBy', 'name _id')
        .populate('materials.material', 'type')
        .sort(sort)
        .lean()
        .exec();

      const duration = Date.now() - startTime;
      console.log(`Work orders query completed in ${duration}ms (${workOrders.length} orders)`);

      res.json(workOrders);
    }
  } catch (error) {
    console.error('Greška pri dohvatanju radnih naloga:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju radnih naloga' });
  }
});

// GET - Dohvati radne naloge tehničara
router.get('/technician/:technicianId', async (req, res) => {
  try {
    const { technicianId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(technicianId)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const technicianOrders = await WorkOrder.find({ 
      $or: [
        { technicianId },
        { technician2Id: technicianId }
      ]
    })
      .populate('materials.material', 'type')
      .populate('technicianId', 'name')
      .populate('technician2Id', 'name')
      .populate('statusChangedBy', 'name')
      .lean()
      .exec();
    res.json(technicianOrders);
  } catch (error) {
    console.error('Greška pri dohvatanju radnih naloga tehničara:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju radnih naloga tehničara' });
  }
});

// GET - Dohvati overdue radne naloge za tehničara
router.get('/technician/:technicianId/overdue', async (req, res) => {
  try {
    const { technicianId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(technicianId)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const overdueOrders = await WorkOrder.find({ 
      $or: [
        { technicianId },
        { technician2Id: technicianId }
      ],
      status: 'nezavrsen',
      isOverdue: true
    })
      .populate('technicianId', 'name')
      .populate('technician2Id', 'name')
      .select('_id address appointmentDateTime isOverdue overdueMarkedAt comment status type adminComment')
      .lean()
      .exec();
      
    res.json(overdueOrders);
  } catch (error) {
    console.error('Greška pri dohvatanju overdue radnih naloga:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju overdue radnih naloga' });
  }
});

// GET - Dohvati nedodeljene radne naloge
router.get('/unassigned', async (req, res) => {
  try {
    const { recent } = req.query;
    const startTime = Date.now();

    let query = {
      $or: [
        { technicianId: null },
        { technicianId: { $exists: false } }
      ]
    };

    // Recent filter for optimization
    if (recent) {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(recent));
      query.date = { $gte: daysAgo };
    }

    const unassignedOrders = await WorkOrder.find(query)
      .sort({ date: -1 })
      .lean()
      .exec();

    const duration = Date.now() - startTime;
    console.log(`Unassigned orders query completed in ${duration}ms (${unassignedOrders.length} orders)`);

    res.json(unassignedOrders);
  } catch (error) {
    console.error('Greška pri dohvatanju nedodeljenih radnih naloga:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju nedodeljenih radnih naloga' });
  }
});

// GET - Dohvati radne naloge za verifikaciju
router.get('/verification', async (req, res) => {
  try {
    const ordersForVerification = await WorkOrder.find({
      status: 'zavrsen',
      verified: false
    });
    
    res.json(ordersForVerification);
  } catch (error) {
    console.error('Greška pri dohvatanju radnih naloga za verifikaciju:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju radnih naloga za verifikaciju' });
  }
});


router.post('/:id/used-equipment', async (req, res) => {
  try {
    const { id } = req.params;
    const { equipment } = req.body;
    
    if (!Array.isArray(equipment)) {
      return res.status(400).json({ error: 'Potrebno je dostaviti niz korišćene opreme' });
    }
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const workOrder = await WorkOrder.findById(id);
    
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }
    
    // Dodaj ili ažuriraj listu korišćene opreme za radni nalog
    workOrder.usedEquipment = equipment;
    
    const updatedWorkOrder = await workOrder.save();
    
    res.json(updatedWorkOrder);
  } catch (error) {
    console.error('Greška pri ažuriranju korišćene opreme:', error);
    res.status(500).json({ error: 'Greška pri ažuriranju korišćene opreme' });
  }
});

// GET endpoint za dohvatanje opreme korisnika za radni nalog
router.get('/:id/user-equipment', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    // Dohvati radni nalog
    const workOrder = await WorkOrder.findById(id)
      .populate({
        path: 'installedEquipment.equipmentId',
        model: 'Equipment'
      })
      .lean();
      
    if (!workOrder) {
      return res.json([]);
    }
    
    // Ako radni nalog ima installedEquipment, vrati te podatke
    if (workOrder.installedEquipment && workOrder.installedEquipment.length > 0) {
      // Izvuci samo podatke o opremi iz installedEquipment
      const installedEquipmentData = workOrder.installedEquipment
        .filter(item => item.equipmentId) // Filtriraj samo validne zapise
        .map(item => ({
          ...item.equipmentId,
          installedAt: item.installedAt,
          notes: item.notes || '',
          technicianId: item.technicianId, // IMPORTANT: Include technicianId for filtering
          id: item._id // Dodaj ID zapisa za eventualno uklanjanje
        }));

      return res.json(installedEquipmentData);
    }
    
    // Ako nema installedEquipment, vrati prazan niz
    // Radni nalog treba da prikazuje samo opremu instaliranu kroz taj konkretan nalog
    return res.json([]);
  } catch (error) {
    console.error('Greška pri dohvatanju opreme korisnika:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju opreme korisnika' });
  }
});

// GET endpoint za dohvatanje materijala za radni nalog
router.get('/:id/materials', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    // Dohvati radni nalog sa materijalima
    const workOrder = await WorkOrder.findById(id)
      .populate('materials.material', 'type')
      .lean()
      .exec();
    
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }
    
    res.json(workOrder.materials || []);
  } catch (error) {
    console.error('Greška pri dohvatanju materijala za radni nalog:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju materijala za radni nalog' });
  }
});

// GET - Preuzimanje šablona (mora biti pre /:id rute)
router.get('/template', (req, res) => {
  const templatePath = path.join(__dirname, '../templates/workorders-template.xlsx');
  
  // Ako šablon ne postoji, kreiramo ga
  if (!fs.existsSync(templatePath)) {
    const workbook = xlsx.utils.book_new();
    const data = [
      {
        "Tehnicar 1": "Ime tehničara",
        "Tehnicar 2": "",
        "Područje": "BORČA",
        "Početak instalacije": "31/05/2023 12:00",
        "Tehnologija": "HFC",
        "TIS ID korisnika": "904317",
        "Adresa korisnika": "Beograd,BORČA,OBROVAČKA 9",
        "Ime korisnika": "PETAR ĐUKIĆ",
        "Kontakt telefon 1": "0642395394",
        "TIS Posao ID": "629841530",
        "Paket": "Dodatni STB/CA - Kabl TV",
        "Dodatni poslovi": "629841530,Dodatni STB/CA - Kabl TV",
        "Tip zahteva": "Zamena uređaja"
      }
    ];
    
    const worksheet = xlsx.utils.json_to_sheet(data);
    xlsx.utils.book_append_sheet(workbook, worksheet, "Radni Nalozi");
    
    // Kreiramo direktorijum ako ne postoji
    const dir = path.dirname(templatePath);
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, { recursive: true });
    }
    
    xlsx.writeFile(workbook, templatePath);
  }
  
  res.download(templatePath, 'radni-nalozi-sablon.xlsx');
});

// GET - Dohvati radni nalog po ID-u
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const workOrder = await WorkOrder.findById(id)
      .populate('technicianId')
      .populate('technician2Id')
      .populate('materials.material', 'type')
      .populate('materials.technicianId', 'name')
      .lean()
      .exec();
    
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }
    
    res.json(workOrder);
  } catch (error) {
    console.error('Greška pri dohvatanju radnog naloga:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju radnog naloga' });
  }
});

// POST - Dodaj nove radne naloge putem Excel fajla
router.post('/upload', auth, logActivity('workorders', 'workorder_bulk_add', {
  getEntityName: (req, responseData) => `${responseData?.newWorkOrders?.length || 0} radnih naloga`,
  getDetails: async (req, responseData) => {
    return {
      action: 'bulk_created',
      summary: {
        totalProcessed: (responseData?.newWorkOrders?.length || 0) + (responseData?.duplicates?.length || 0) + (responseData?.errors?.length || 0),
        addedCount: responseData?.newWorkOrders?.length || 0,
        duplicatesCount: responseData?.duplicates?.length || 0,
        errorsCount: responseData?.errors?.length || 0,
        newUsersCount: responseData?.newUsers?.length || 0,
        existingUsersCount: responseData?.existingUsers?.length || 0
      },
      addedItems: responseData?.newWorkOrders || [],
      duplicates: responseData?.duplicates || [],
      errors: responseData?.errors || [],
      newUsers: responseData?.newUsers || [],
      existingUsers: responseData?.existingUsers || []
    };
  }
}), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Niste priložili fajl' });
    }
    
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    if (data.length === 0) {
      return res.status(400).json({ error: 'Excel fajl ne sadrži podatke' });
    }

    // Dohvatanje svih tehničara iz baze
    const technicians = await Technician.find().lean();
    
    // Mapiranje tehničara po imenu
    const technicianByName = {};
    technicians.forEach(tech => {
      technicianByName[tech.name.toLowerCase()] = tech._id;
    });
    
    const newWorkOrders = [];
    const newUsers = [];
    const existingUsers = [];
    const errors = [];
    const duplicates = [];
    
    for (const row of data) {
      try {
        // Izvlačenje podataka iz reda
        const technicianName1 = row["Tehnicar 1"] || '';
        const technicianName2 = row["Tehnicar 2"] || '';
        const area = row["Područje"] || '';
        const installDateTime = row["Početak instalacije"] || '';
        const technology = row["Tehnologija"] || '';
        const tisId = row["TIS ID korisnika"]?.toString() || '';
        const address = row["Adresa korisnika"] || '';
        const userName = row["Ime korisnika"] || '';
        const userPhone = row["Kontakt telefon 1"]?.toString() || '';
        const tisJobId = row["TIS Posao ID"]?.toString() || '';
        const packageName = row["Paket"] || '';
        const additionalJobs = row["Dodatni poslovi"] || '';
        const requestType = row["Tip zahteva"] || '';
        
        // Parsiranje datuma i vremena
        let date = new Date().toISOString().split('T')[0];
        let time = '09:00';
        if (installDateTime) {
          try {
            const parts = installDateTime.split(' ');
            if (parts.length > 0) {
              const dateParts = parts[0].split('/');
              if (dateParts.length === 3) {
                const parsedDate = new Date(
                  parseInt(dateParts[2], 10),
                  parseInt(dateParts[1], 10) - 1,
                  parseInt(dateParts[0], 10)
                );
                if (!isNaN(parsedDate.getTime())) {
                  date = parsedDate.toISOString().split('T')[0];
                }
              }
            }
            if (parts.length > 1 && parts[1].trim()) {
              time = parts[1].trim();
            }
          } catch (error) {
            console.error('Greška pri parsiranju datuma:', error);
          }
        }

        // Validacija da time nije prazan
        if (!time || time.trim() === '') {
          time = '09:00';
        }
        
        // Pronalaženje tehničara po imenu
        let technicianId = null;
        let technician2Id = null;
        if (technicianName1) {
          technicianId = technicianByName[technicianName1.toLowerCase()];
        }
        if (technicianName2) {
          technician2Id = technicianByName[technicianName2.toLowerCase()];
        }

        // Provera da li radni nalog već postoji
        const existingWorkOrder = await WorkOrder.findOne({
          date,
          time,
          municipality: area,
          address,
          type: packageName,
          tisId,
          tisJobId
        });

        if (existingWorkOrder) {
          console.log('Radni nalog već postoji, preskačem:', { address, tisId, tisJobId });
          duplicates.push({
            address,
            userName,
            tisId,
            tisJobId,
            date,
            time,
            technicianName1,
            technicianName2,
            packageName,
            reason: 'Radni nalog sa identičnim podacima već postoji u sistemu'
          });
          continue;
        }
        
        // Provera da li korisnik već postoji
        let user = null;
        if (tisId) {
          user = await User.findOne({ tisId });
          
          if (!user) {
            // Kreiranje novog korisnika
            const newUser = new User({
              tisId,
              name: userName,
              address,
              phone: userPhone,
              workOrders: []
            });
            
            user = await newUser.save();
            newUsers.push(user);
          } else {
            // Ažuriranje postojećeg korisnika
            user.name = userName || user.name;
            user.address = address || user.address;
            user.phone = userPhone || user.phone;
            await user.save();
            existingUsers.push(user);
          }
        }
        
        // Kreiraj appointmentDateTime kombinovanjem date i time
        const bulkWorkOrderTime = time || '09:00';
        let [bulkHours, bulkMinutes] = [9, 0];
        if (bulkWorkOrderTime && typeof bulkWorkOrderTime === 'string') {
          const bulkTimeParts = bulkWorkOrderTime.split(':');
          bulkHours = parseInt(bulkTimeParts[0]) || 9;
          bulkMinutes = parseInt(bulkTimeParts[1]) || 0;
        }
        const bulkAppointmentDateTime = new Date(date);
        bulkAppointmentDateTime.setHours(bulkHours, bulkMinutes, 0, 0);

        // Kreiranje novog radnog naloga
        const newWorkOrder = new WorkOrder({
          date,
          time: bulkWorkOrderTime,
          municipality: area,
          address,
          type: packageName,
          technicianId,
          technician2Id,
          details: requestType,
          comment: '',
          status: 'nezavrsen',
          technology,
          tisId,
          userName,
          userPhone,
          tisJobId,
          additionalJobs,
          images: [],
          verified: false,
          user: user ? user._id : null,
          appointmentDateTime: bulkAppointmentDateTime
        });
        
        const savedWorkOrder = await newWorkOrder.save();
        newWorkOrders.push(savedWorkOrder);
        
        // Kreiranje WorkOrderEvidence zapisa
        try {
          await createWorkOrderEvidence(savedWorkOrder);
        } catch (evidenceError) {
          console.error('Greška pri kreiranju WorkOrderEvidence:', evidenceError);
          // Ne prekidamo proces zbog greške u evidenciji
        }
        
        // Dodavanje radnog naloga korisniku
        if (user) {
          await User.findByIdAndUpdate(user._id, {
            $push: { workOrders: savedWorkOrder._id }
          });
        }
        
      } catch (error) {
        console.error('Greška pri obradi reda:', error);
        errors.push(`Greška pri obradi reda: ${JSON.stringify(row)}`);
      }
    }
    
    // Send email notifications to assigned technicians for bulk uploaded work orders
    const emailService = require('../services/emailService');
    try {
      // Group work orders by technician to minimize emails
      const workOrdersByTechnician = {};
      
      for (const workOrder of newWorkOrders) {
        // Check primary technician
        if (workOrder.technicianId && mongoose.Types.ObjectId.isValid(workOrder.technicianId)) {
          const techId = workOrder.technicianId.toString();
          if (!workOrdersByTechnician[techId]) {
            workOrdersByTechnician[techId] = [];
          }
          workOrdersByTechnician[techId].push(workOrder);
        }
        
        // Check secondary technician
        if (workOrder.technician2Id && mongoose.Types.ObjectId.isValid(workOrder.technician2Id)) {
          const tech2Id = workOrder.technician2Id.toString();
          if (!workOrdersByTechnician[tech2Id]) {
            workOrdersByTechnician[tech2Id] = [];
          }
          workOrdersByTechnician[tech2Id].push(workOrder);
        }
      }
      
      // Send emails to each technician with their assigned work orders (asinhrono)
      setImmediate(async () => {
        for (const [techId, workOrders] of Object.entries(workOrdersByTechnician)) {
          try {
            const technician = await Technician.findById(techId);
            if (technician && technician.gmail && workOrders.length > 0) {
              const emailResult = await emailService.sendEmailToTechnician(
                techId,
                'workOrderAssignment',
                {
                  technicianName: technician.name,
                  workOrders: workOrders.map(order => ({
                    date: order.date,
                    time: order.time,
                    municipality: order.municipality,
                    address: order.address,
                    type: order.type,
                    userName: order.userName,
                    userPhone: order.userPhone,
                    details: order.details,
                    technology: order.technology,
                    tisId: order.tisId
                  }))
                }
              );

              if (emailResult.success) {
                console.log(`✅ Bulk work order assignment email sent to technician ${technician.name} about ${workOrders.length} work orders`);
              } else {
                console.error('❌ Failed to send bulk work order assignment email notification:', emailResult.error);
              }

              // DODATO: Kreiranje Android notifikacija za svaki radni nalog
              const androidNotificationService = require('../services/androidNotificationService');
              for (const order of workOrders) {
                try {
                  await androidNotificationService.createWorkOrderNotification(techId, {
                    address: order.address,
                    municipality: order.municipality,
                    date: order.date,
                    time: order.time,
                    orderId: order._id
                  });
                } catch (notifError) {
                  console.error(`❌ Error creating Android notification for work order ${order._id}:`, notifError.message);
                }
              }
            }
          } catch (emailError) {
            console.error(`❌ Error sending email to technician ${techId}:`, emailError.message);
          }
        }
      });
    } catch (emailError) {
      console.error('Error sending bulk work order assignment emails:', emailError);
      // Ne prekidamo proces ako email ne uspe
    }
    
    res.json({
      newWorkOrders,
      newUsers,
      existingUsers,
      errors,
      duplicates
    });
    
  } catch (error) {
    console.error('Greška pri upload-u:', error);
    res.status(500).json({ error: 'Greška pri obradi Excel fajla: ' + error.message });
  } finally {
    // Brisanje privremenog fajla
    if (req.file) {
      fs.unlink(req.file.path, err => {
        if (err) console.error('Greška pri brisanju privremenog fajla:', err);
      });
    }
  }
});

// POST - Dodaj pojedinačni radni nalog
router.post('/', auth, logActivity('workorders', 'workorder_add', {
  getEntityName: (req, responseData) => responseData?.tisJobId || 'WorkOrder'
}), async (req, res) => {
  try {
    const { 
      date, time, municipality, address, type, technicianId, technician2Id, details, comment,
      technology, tisId, userName, userPhone, tisJobId, additionalJobs 
    } = req.body;
    
    if (!date || !municipality || !address || !type) {
      return res.status(400).json({ error: 'Datum, opština, adresa i tip su obavezna polja' });
    }
    
    // Provera da li tehničar postoji
    if (technicianId && mongoose.Types.ObjectId.isValid(technicianId)) {
      const technician = await Technician.findById(technicianId);
      if (!technician) {
        return res.status(400).json({ error: 'Tehničar nije pronađen' });
      }
    }
    
    // Provera da li drugi tehničar postoji
    if (technician2Id && mongoose.Types.ObjectId.isValid(technician2Id)) {
      const technician2 = await Technician.findById(technician2Id);
      if (!technician2) {
        return res.status(400).json({ error: 'Drugi tehničar nije pronađen' });
      }
      
      // Provera da nisu isti tehničari
      if (technicianId === technician2Id) {
        return res.status(400).json({ error: 'Ne možete dodeliti isti tehničar kao prvi i drugi tehničar' });
      }
    }
    
    // Ako je prosleđen tisId, pronalazimo ili kreiramo korisnika
    let userId = null;
    
    if (tisId) {
      // Proveravamo da li korisnik već postoji
      let user = await User.findOne({ tisId });
      
      // Ako ne postoji, kreiramo novog korisnika
      if (!user) {
        const newUser = new User({
          tisId,
          name: userName || '',
          address: address || '',
          phone: userPhone || '',
          workOrders: []
        });
        
        user = await newUser.save();
      }
      
      userId = user._id;
    }
    
    // Kreiraj appointmentDateTime kombinovanjem date i time
    const workOrderTime = time || '09:00';
    let [hours, minutes] = [9, 0];
    if (workOrderTime && typeof workOrderTime === 'string') {
      const timeParts = workOrderTime.split(':');
      hours = parseInt(timeParts[0]) || 9;
      minutes = parseInt(timeParts[1]) || 0;
    }
    const appointmentDateTime = new Date(date);
    appointmentDateTime.setHours(hours, minutes, 0, 0);

    // Kreiranje novog radnog naloga
    const newWorkOrder = new WorkOrder({
      date,
      time: workOrderTime,
      municipality,
      address,
      type,
      technicianId: technicianId || null,
      technician2Id: technician2Id || null,
      details: details || '',
      comment: comment || '',
      status: 'nezavrsen',
      technology: technology || '',
      tisId: tisId || '',
      userName: userName || '',
      userPhone: userPhone || '',
      tisJobId: tisJobId || '',
      additionalJobs: additionalJobs || '',
      images: [],
      verified: false,
      user: userId,
      appointmentDateTime: appointmentDateTime
    });
    
    const savedWorkOrder = await newWorkOrder.save();
    
    // Kreiranje WorkOrderEvidence zapisa
    try {
      await createWorkOrderEvidence(savedWorkOrder);
    } catch (evidenceError) {
      console.error('Greška pri kreiranju WorkOrderEvidence:', evidenceError);
      // Ne prekidamo proces zbog greške u evidenciji
    }
    
    // Ako je korisnik pronađen/kreiran, dodajemo radni nalog korisniku
    if (userId) {
      await User.findByIdAndUpdate(userId, {
        $push: { workOrders: savedWorkOrder._id }
      });
    }
    
    // Log work order creation - admin should be passed from frontend via req.user or similar
    try {
      const adminId = req.body.adminId || null; // This should be passed from frontend
      const adminName = req.body.adminName || 'Sistem Administrator'; // This should be passed from frontend
      // Proveravamo da li je adminId valjan ObjectId pre logovanja
      if (adminId && mongoose.Types.ObjectId.isValid(adminId)) {
        await logWorkOrderCreated(adminId, adminName, savedWorkOrder);
      }
    } catch (logError) {
      console.error('Greška pri logovanju kreiranja radnog naloga:', logError);
      // Ne prekidamo izvršavanje zbog greške u logovanju
    }

    // Send email notification to assigned technician(s)
    const emailService = require('../services/emailService');
    try {
      const techniciansToNotify = [];
      
      // Check primary technician
      if (technicianId && mongoose.Types.ObjectId.isValid(technicianId)) {
        const technician = await Technician.findById(technicianId);
        if (technician && technician.gmail) {
          techniciansToNotify.push({
            id: technicianId,
            name: technician.name
          });
        }
      }
      
      // Check secondary technician
      if (technician2Id && mongoose.Types.ObjectId.isValid(technician2Id)) {
        const technician2 = await Technician.findById(technician2Id);
        if (technician2 && technician2.gmail) {
          techniciansToNotify.push({
            id: technician2Id,
            name: technician2.name
          });
        }
      }
      
      // Send emails to all assigned technicians (asinhrono - ne čeka)
      setImmediate(async () => {
        for (const tech of techniciansToNotify) {
          try {
            const emailResult = await emailService.sendEmailToTechnician(
              tech.id,
              'workOrderAssignment',
              {
                technicianName: tech.name,
                workOrders: [{
                  date: savedWorkOrder.date,
                  time: savedWorkOrder.time,
                  municipality: savedWorkOrder.municipality,
                  address: savedWorkOrder.address,
                  type: savedWorkOrder.type,
                  userName: savedWorkOrder.userName,
                  userPhone: savedWorkOrder.userPhone,
                  details: savedWorkOrder.details,
                  technology: savedWorkOrder.technology,
                  tisId: savedWorkOrder.tisId
                }]
              }
            );

            if (emailResult.success) {
              console.log(`✅ Work order assignment email sent to technician ${tech.name}`);
            } else {
              console.error('❌ Failed to send work order assignment email notification:', emailResult.error);
            }

            // DODATO: Kreiranje Android notifikacije za radni nalog
            const androidNotificationService = require('../services/androidNotificationService');
            try {
              await androidNotificationService.createWorkOrderNotification(tech.id, {
                address: savedWorkOrder.address,
                municipality: savedWorkOrder.municipality,
                date: savedWorkOrder.date,
                time: savedWorkOrder.time,
                orderId: savedWorkOrder._id
              });
            } catch (notifError) {
              console.error(`❌ Error creating Android notification for work order:`, notifError.message);
            }
          } catch (emailError) {
            console.error(`❌ Error sending email to technician ${tech.name}:`, emailError.message);
          }
        }
      });
    } catch (emailError) {
      console.error('Error sending work order assignment email:', emailError);
      // Ne prekidamo proces ako email ne uspe
    }
    
    res.status(201).json(savedWorkOrder);
  } catch (error) {
    console.error('Greška pri kreiranju radnog naloga:', error);
    res.status(500).json({ error: 'Greška pri kreiranju radnog naloga' });
  }
});

// PUT - Ažuriraj radni nalog
router.put('/:id', auth, logActivity('workorders', 'workorder_edit', {
  getEntityId: (req) => req.params.id,
  getEntityName: (req, responseData) => responseData?.tisJobId || 'WorkOrder',
  getDetails: async (req, responseData) => {
    // Generate human-readable change descriptions
    const changes = [];
    const before = responseData?.beforeData || {};
    const after = responseData?.afterData || {};

    console.log('🔍 [workorder_edit getDetails] Comparing:', {
      beforeKeys: Object.keys(before),
      afterKeys: Object.keys(after),
      beforeDate: before.date,
      afterDate: after.date
    });

    // Helper function to format field names
    const fieldLabels = {
      // Basic info
      status: 'Status',
      verified: 'Verifikacija',
      technicianId: 'Tehničar',
      technician2Id: 'Drugi tehničar',
      type: 'Tip radnog naloga',
      municipality: 'Opština',
      address: 'Adresa',
      userName: 'Ime korisnika',
      userPhone: 'Telefon korisnika',
      date: 'Datum izvođenja',
      time: 'Vreme izvođenja',
      appointmentDateTime: 'Datum i vreme termina',

      // Technical info
      technology: 'Tehnologija',
      tisJobId: 'TIS Job ID',
      tisId: 'TIS ID',

      // Work details
      comment: 'Komentar tehničara',
      adminComment: 'Komentar admina',
      details: 'Detalji naloga',
      additionalJobs: 'Dodatni poslovi',

      // Status tracking
      postponedUntil: 'Odloženo do',
      statusChangedAt: 'Vreme promene statusa',
      verifiedAt: 'Vreme verifikacije',
      overdueMarkedAt: 'Označeno kao prekoračeno',
      prvoMenjanjeStatusa: 'Prvo menjanje statusa',

      // Customer feedback
      customerStatus: 'Status korisnika',
      customerComment: 'Komentar korisnika'
    };

    // Status labels
    const statusLabels = {
      pending: 'Na čekanju',
      assigned: 'Dodeljen',
      zavrsen: 'Završen',
      otkazan: 'Otkazan',
      odlozen: 'Odložen',
      nezavrsen: 'Nezavršen'
    };

    // Get all unique keys from both before and after
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

    // Check each field for changes
    allKeys.forEach(key => {
      if (key === '_id' || key === '__v' || key === 'createdAt' || key === 'updatedAt' || key === 'images' || key === 'equipmentUsed' || key === 'postponeHistory' || key === 'cancelHistory') return;

      const oldValue = before[key];
      const newValue = after[key];

      // Normalize null/undefined/empty string to null for comparison
      const normalizedOld = (oldValue === undefined || oldValue === '' || oldValue === null) ? null : oldValue;
      const normalizedNew = (newValue === undefined || newValue === '' || newValue === null) ? null : newValue;

      // Skip if values are the same
      if (JSON.stringify(normalizedOld) === JSON.stringify(normalizedNew)) return;

      const label = fieldLabels[key] || key;

      // Format specific fields
      if (key === 'status') {
        const oldLabel = statusLabels[oldValue] || oldValue;
        const newLabel = statusLabels[newValue] || newValue;
        changes.push(`Promenjen ${label}: ${oldLabel} → ${newLabel}`);
      } else if (key === 'verified') {
        if (newValue === true && oldValue !== true) {
          changes.push(`Verifikovan radni nalog sa statusom: ${statusLabels[after.status] || after.status}`);
        } else if (newValue === false && oldValue === true) {
          changes.push(`Uklonjena verifikacija radnog naloga`);
        }
      } else if (key === 'technicianId' || key === 'technician2Id') {
        const techName = responseData?.technicianNames?.[key] || newValue || 'Niko';
        const oldTechName = responseData?.technicianNames?.['old_' + key] || oldValue || 'Niko';
        if (oldValue && !newValue) {
          changes.push(`Uklonjen ${label}: ${oldTechName}`);
        } else if (!oldValue && newValue) {
          changes.push(`Dodeljen ${label}: ${techName}`);
        } else if (oldValue !== newValue) {
          changes.push(`Promenjen ${label}: ${oldTechName} → ${techName}`);
        }
      } else if (key === 'date' || key === 'appointmentDateTime' || key === 'postponedUntil' || key === 'statusChangedAt' || key === 'verifiedAt' || key === 'overdueMarkedAt') {
        // Format datuma za prikaz
        const oldDate = oldValue ? new Date(oldValue).toLocaleDateString('sr-RS') : 'Nije postavljen';
        const newDate = newValue ? new Date(newValue).toLocaleDateString('sr-RS') : 'Nije postavljen';
        if (oldDate !== newDate) {
          changes.push(`Promenjen ${label}: ${oldDate} → ${newDate}`);
        }
      } else if (oldValue === null || oldValue === undefined || oldValue === '') {
        changes.push(`Dodato ${label}: ${newValue}`);
      } else if (newValue === null || newValue === undefined || newValue === '') {
        changes.push(`Uklonjeno ${label}: ${oldValue}`);
      } else {
        changes.push(`Promenjen ${label}: ${oldValue} → ${newValue}`);
      }
    });

    return {
      action: 'updated',
      changes: changes,
      changeCount: changes.length,
      summary: changes.join(' • ')
    };
  }
}), async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    console.log('Received update data:', updateData);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    // Provera da li radni nalog postoji - Sačuvaj STARO stanje
    const workOrder = await WorkOrder.findById(id).populate('technicianId', 'name').populate('technician2Id', 'name').lean();
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }

    // Provera i konverzija technicianId
    if (updateData.technicianId === '') {
      updateData.technicianId = null;
    } else if (updateData.technicianId && !mongoose.Types.ObjectId.isValid(updateData.technicianId)) {
      return res.status(400).json({ error: 'Neispravan format ID-a tehničara' });
    }

    // Provera i konverzija technician2Id
    if (updateData.technician2Id === '') {
      updateData.technician2Id = null;
    } else if (updateData.technician2Id && !mongoose.Types.ObjectId.isValid(updateData.technician2Id)) {
      return res.status(400).json({ error: 'Neispravan format ID-a drugog tehničara' });
    }

    // Konvertuj datum u pravilni Date objekat ako je string
    if (updateData.date && typeof updateData.date === 'string') {
      updateData.date = new Date(updateData.date);
    }

    // Ažuriraj appointmentDateTime ako se promeni date ili time
    const dateChanged = updateData.date !== undefined;
    const timeChanged = updateData.time !== undefined;

    if (dateChanged || timeChanged) {
      // Koristi nove vrednosti ako postoje, inače koristi postojeće iz workOrder
      const newDate = updateData.date || workOrder.date;
      const newTime = updateData.time || workOrder.time || '09:00';

      // Parse time (format: "09:00" or "9:00")
      let [hours, minutes] = [9, 0];
      if (newTime && typeof newTime === 'string') {
        const timeParts = newTime.split(':');
        hours = parseInt(timeParts[0]) || 9;
        minutes = parseInt(timeParts[1]) || 0;
      }

      // Kreiraj novi appointmentDateTime
      const appointmentDateTime = new Date(newDate);
      appointmentDateTime.setHours(hours, minutes, 0, 0);
      updateData.appointmentDateTime = appointmentDateTime;

      console.log('Date/Time changed - updating appointmentDateTime:', {
        newDate,
        newTime,
        appointmentDateTime: appointmentDateTime.toISOString()
      });

      // Proveri da li treba resetovati isOverdue flag
      const currentTime = new Date();
      const oneDayAgo = new Date(currentTime.getTime() - (24 * 60 * 60 * 1000));

      // Ako je novi appointmentDateTime u poslednjih 24 sata ili u budućnosti,
      // i status je 'nezavrsen', resetuj isOverdue
      if (appointmentDateTime > oneDayAgo) {
        // Novi termin nije stariji od 24 sata - nije overdue
        if (workOrder.isOverdue === true) {
          updateData.isOverdue = false;
          updateData.overdueMarkedAt = null;
          console.log('Resetting isOverdue flag - new appointment time is within 24 hours or in the future');
        }
      } else {
        // Novi termin je stariji od 24 sata
        const currentStatus = updateData.status || workOrder.status;
        if (currentStatus === 'nezavrsen' && !workOrder.isOverdue) {
          updateData.isOverdue = true;
          updateData.overdueMarkedAt = currentTime;
          console.log('Setting isOverdue flag - appointment time is more than 24 hours ago and status is nezavrsen');
        }
      }
    }

    // Resetuj isOverdue flag kada se status promeni na završen, otkazan ili odložen
    if (updateData.status && ['zavrsen', 'otkazan', 'odlozen'].includes(updateData.status)) {
      updateData.isOverdue = false;
      updateData.overdueMarkedAt = null;
      console.log('Resetting isOverdue flag - status changed to:', updateData.status);
    }

    console.log('Current work order:', workOrder);
    console.log('Processed update data:', updateData);

    // Check if technician is being assigned
    const oldTechnicianId = workOrder.technicianId;
    const newTechnicianId = updateData.technicianId;
    const technicianAssigned = !oldTechnicianId && newTechnicianId;

    // Pojednostavljeno ažuriranje
    const updatedWorkOrder = await WorkOrder.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('technicianId', 'name _id');

    console.log('Updated work order:', updatedWorkOrder);

    if (!updatedWorkOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen nakon ažuriranja' });
    }

    // Check if status was changed to "zavrsen" and create notifications for admins
    const oldStatus = workOrder.status;
    const newStatus = updatedWorkOrder.status;

    if (oldStatus !== 'zavrsen' && newStatus === 'zavrsen') {
      // Kreiraj notifikaciju za admin kada se radni nalog označi kao završen
      try {
        // Dohvati tehničara ako postoji
        let technicianName = 'Nepoznat tehničar';
        if (updatedWorkOrder.technicianId) {
          const technician = await Technician.findById(updatedWorkOrder.technicianId);
          if (technician) {
            technicianName = technician.name;
          }
        }
        
        // Pronađi sve admne (tehničari sa admin privilegijama)
        const adminUsers = await Technician.find({ isAdmin: true });
        
        // Kreiraj notifikaciju za svakog admina
        console.log('=== ADMIN UPDATE: Pozivam createNotification ===');
        console.log('createNotification type:', typeof createNotification);
        console.log('createNotification function:', createNotification);
        
        for (const adminUser of adminUsers) {
          console.log('Kreiram notifikaciju za admin:', adminUser._id);
          await createNotification('work_order_verification', {
            workOrderId: updatedWorkOrder._id,
            technicianId: updatedWorkOrder.technicianId,
            technicianName: technicianName,
            recipientId: adminUser._id
          });
          console.log('Notifikacija kreirana za admin:', adminUser._id);
        }
        
        console.log('Notifikacija kreirana za završetak radnog naloga (admin update):', updatedWorkOrder._id);
      } catch (notificationError) {
        console.error('Greška pri kreiranju notifikacije:', notificationError);
        // Ne prekidamo proces zbog greške u notifikaciji
      }
    }

    // FINANSIJSKA KALKULACIJA - Kada admin promeni status na 'zavrsen' i radni nalog je verifikovan
    console.log('=== ADMIN UPDATE - Checking for financial calculation ===');
    if (newStatus === 'zavrsen' && updatedWorkOrder.verified) {
      console.log('Work order is completed and verified by admin update, creating financial transaction...');
      await createFinancialTransaction(updatedWorkOrder._id);
    } else {
      console.log('Work order not ready for financial calculation - Status:', newStatus, 'Verified:', updatedWorkOrder.verified);
    }

    // Ažuriranje WorkOrderEvidence zapisa
    try {
      const evidenceUpdateData = {
        municipality: updatedWorkOrder.municipality,
        address: updatedWorkOrder.address,
        status: updatedWorkOrder.status === 'zavrsen' ? 'ZAVRŠENO' :
                updatedWorkOrder.status === 'otkazan' ? 'OTKAZANO' :
                updatedWorkOrder.status === 'odlozen' ? 'ODLOŽENO' : 'U TOKU',
        executionDate: updatedWorkOrder.date,
        notes: updatedWorkOrder.comment || '',
        orderType: updatedWorkOrder.type,
        servicePackage: updatedWorkOrder.additionalJobs || '',
        technology: updatedWorkOrder.technology,
        verified: updatedWorkOrder.verified,
        customerName: updatedWorkOrder.userName || '',
        userPhone: updatedWorkOrder.userPhone || '',
        tisJobId: updatedWorkOrder.tisJobId || '',
        tisId: updatedWorkOrder.tisId || ''
      };

      // Dodeli imena tehničara ako postoje
      if (updatedWorkOrder.technicianId) {
        const technician = await Technician.findById(updatedWorkOrder.technicianId);
        if (technician) {
          evidenceUpdateData.technician1 = technician.name;
        }
      }

      if (updatedWorkOrder.technician2Id) {
        const technician2 = await Technician.findById(updatedWorkOrder.technician2Id);
        if (technician2) {
          evidenceUpdateData.technician2 = technician2.name;
        }
      }

      await updateWorkOrderEvidence(updatedWorkOrder._id, evidenceUpdateData);
    } catch (evidenceError) {
      console.error('Greška pri ažuriranju WorkOrderEvidence:', evidenceError);
      // Ne prekidamo proces zbog greške u evidenciji
    }

    // Log work order assignment
    if (technicianAssigned && updatedWorkOrder.technicianId) {
      try {
        const adminId = updateData.adminId; // This should be passed from frontend
        const adminName = updateData.adminName || 'Admin'; // This should be passed from frontend
        if (adminId && mongoose.Types.ObjectId.isValid(adminId)) {
          await logWorkOrderAssigned(adminId, adminName, updatedWorkOrder, updatedWorkOrder.technicianId.name);
        }
      } catch (logError) {
        console.error('Greška pri logovanju dodele radnog naloga:', logError);
      }
    }

    // Log work order update (general)
    try {
      const adminId = updateData.adminId; // This should be passed from frontend
      const adminName = updateData.adminName || 'Admin'; // This should be passed from frontend
      if (adminId && mongoose.Types.ObjectId.isValid(adminId)) {
        await logWorkOrderUpdated(adminId, adminName, updatedWorkOrder);
      }
    } catch (logError) {
      console.error('Greška pri logovanju ažuriranja radnog naloga:', logError);
    }

    // Prepare response data for activity logger - SVA POLJA
    const responseData = {
      ...updatedWorkOrder.toObject(),
      beforeData: {
        // Basic info
        status: workOrder.status,
        verified: workOrder.verified,
        technicianId: workOrder.technicianId?._id || workOrder.technicianId,
        technician2Id: workOrder.technician2Id?._id || workOrder.technician2Id,
        type: workOrder.type,
        municipality: workOrder.municipality,
        address: workOrder.address,
        userName: workOrder.userName,
        userPhone: workOrder.userPhone,
        date: workOrder.date ? workOrder.date.toISOString() : null,
        time: workOrder.time,
        appointmentDateTime: workOrder.appointmentDateTime ? workOrder.appointmentDateTime.toISOString() : null,

        // Technical info
        technology: workOrder.technology,
        tisJobId: workOrder.tisJobId,
        tisId: workOrder.tisId,

        // Work details
        comment: workOrder.comment,
        adminComment: workOrder.adminComment,
        details: workOrder.details,
        additionalJobs: workOrder.additionalJobs,

        // Status tracking
        postponedUntil: workOrder.postponedUntil ? workOrder.postponedUntil.toISOString() : null,
        statusChangedAt: workOrder.statusChangedAt ? workOrder.statusChangedAt.toISOString() : null,
        verifiedAt: workOrder.verifiedAt ? workOrder.verifiedAt.toISOString() : null,
        overdueMarkedAt: workOrder.overdueMarkedAt ? workOrder.overdueMarkedAt.toISOString() : null,
        prvoMenjanjeStatusa: workOrder.prvoMenjanjeStatusa,

        // Additional fields
        customerStatus: workOrder.customerStatus,
        customerComment: workOrder.customerComment
      },
      afterData: {
        // Basic info
        status: updatedWorkOrder.status,
        verified: updatedWorkOrder.verified,
        technicianId: updatedWorkOrder.technicianId?._id || updatedWorkOrder.technicianId,
        technician2Id: updatedWorkOrder.technician2Id?._id || updatedWorkOrder.technician2Id,
        type: updatedWorkOrder.type,
        municipality: updatedWorkOrder.municipality,
        address: updatedWorkOrder.address,
        userName: updatedWorkOrder.userName,
        userPhone: updatedWorkOrder.userPhone,
        date: updatedWorkOrder.date ? updatedWorkOrder.date.toISOString() : null,
        time: updatedWorkOrder.time,
        appointmentDateTime: updatedWorkOrder.appointmentDateTime ? updatedWorkOrder.appointmentDateTime.toISOString() : null,

        // Technical info
        technology: updatedWorkOrder.technology,
        tisJobId: updatedWorkOrder.tisJobId,
        tisId: updatedWorkOrder.tisId,

        // Work details
        comment: updatedWorkOrder.comment,
        adminComment: updatedWorkOrder.adminComment,
        details: updatedWorkOrder.details,
        additionalJobs: updatedWorkOrder.additionalJobs,

        // Status tracking
        postponedUntil: updatedWorkOrder.postponedUntil ? updatedWorkOrder.postponedUntil.toISOString() : null,
        statusChangedAt: updatedWorkOrder.statusChangedAt ? updatedWorkOrder.statusChangedAt.toISOString() : null,
        verifiedAt: updatedWorkOrder.verifiedAt ? updatedWorkOrder.verifiedAt.toISOString() : null,
        overdueMarkedAt: updatedWorkOrder.overdueMarkedAt ? updatedWorkOrder.overdueMarkedAt.toISOString() : null,
        prvoMenjanjeStatusa: updatedWorkOrder.prvoMenjanjeStatusa,

        // Additional fields
        customerStatus: updatedWorkOrder.customerStatus,
        customerComment: updatedWorkOrder.customerComment
      },
      technicianNames: {
        technicianId: updatedWorkOrder.technicianId?.name || updatedWorkOrder.technicianId,
        technician2Id: updatedWorkOrder.technician2Id?.name || updatedWorkOrder.technician2Id,
        old_technicianId: workOrder.technicianId?.name || workOrder.technicianId,
        old_technician2Id: workOrder.technician2Id?.name || workOrder.technician2Id
      }
    };

    res.json(responseData);
  } catch (error) {
    console.error('Detalji greške:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ 
      error: 'Greška pri ažuriranju radnog naloga',
      details: error.message 
    });
  }
});

// PUT - Ažuriranje radnog naloga (tehničar)
router.put('/:id/technician-update', auth, logActivity('workorders', 'workorder_edit', {
  getEntityId: (req) => req.params.id,
  getEntityName: (req, responseData) => responseData?.tisJobId || 'WorkOrder',
  getDetails: async (req, responseData) => {
    const changes = [];
    const { comment, status } = req.body;
    const oldComment = responseData?.oldComment;
    const oldStatus = responseData?.oldStatus;

    // Status labels
    const statusLabels = {
      pending: 'Na čekanju',
      assigned: 'Dodeljen',
      zavrsen: 'Završen',
      otkazan: 'Otkazan',
      odlozen: 'Odložen',
      nezavrsen: 'Nezavršen'
    };

    // Check for status change
    if (status && oldStatus && status !== oldStatus) {
      const oldLabel = statusLabels[oldStatus] || oldStatus;
      const newLabel = statusLabels[status] || status;
      changes.push(`Promenjen Status: ${oldLabel} → ${newLabel}`);
    }

    // Check for comment change
    if (comment !== undefined && oldComment !== undefined && comment !== oldComment) {
      if (!oldComment || oldComment.trim() === '') {
        changes.push(`Dodat Komentar tehničara`);
      } else {
        changes.push(`Izmenjen Komentar tehničara`);
      }
    }

    return {
      action: 'updated',
      changes: changes.length > 0 ? changes : ['Ažuriranje od strane tehničara'],
      changeCount: changes.length || 1,
      summary: changes.join(' • ') || 'Ažuriranje od strane tehničara'
    };
  }
}), async (req, res) => {
  try {
    const { id } = req.params;
    const { comment, status, postponeDate, postponeTime, postponeComment, cancelComment, technicianId } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const workOrder = await WorkOrder.findById(id);
    
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }
    
    // Provjeri da li tehničar ima pravo da mijenja ovaj radni nalog
    if (technicianId && 
        workOrder.technicianId && 
        workOrder.technician2Id &&
        workOrder.technicianId.toString() !== technicianId && 
        workOrder.technician2Id.toString() !== technicianId) {
      return res.status(403).json({ error: 'Nemate dozvolu za ažuriranje ovog radnog naloga' });
    }
    
    // Dohvati tehničara za logging
    let technician = null;
    if (technicianId) {
      technician = await Technician.findById(technicianId);
    }
    
    const oldStatus = workOrder.status;
    const oldComment = workOrder.comment;
    
    // Tehničar može da ažurira samo komentar, status i vreme odlaganja
    if (comment !== undefined && comment !== oldComment) {
      workOrder.comment = comment;
      
      // Log comment addition
      if (technician && comment.trim() !== '') {
        await logCommentAdded(technicianId, technician.name, workOrder, comment);
      }
    }
    
    // Ako je status promenjen, ažuriramo i to
    if (status && status !== workOrder.status) {
      workOrder.status = status;
      workOrder.statusChangedBy = technicianId;
      workOrder.statusChangedAt = new Date();
      
      // Zapamti prvo menjanje statusa - samo ako nije već zapisano
      if (!workOrder.prvoMenjanjeStatusa) {
        workOrder.prvoMenjanjeStatusa = new Date();
      }
      
      // Log status change
      if (technician) {
        await logWorkOrderStatusChanged(technicianId, technician.name, workOrder, oldStatus, status);
      }
      
      // Resetuj isOverdue flag kada se status promeni na završen, otkazan ili odložen
      if (['zavrsen', 'otkazan', 'odlozen'].includes(status)) {
        workOrder.isOverdue = false;
        workOrder.overdueMarkedAt = null;
      }

      // Ako je status promenjen na "zavrsen", dodaj timestamp završetka
      if (status === 'zavrsen') {
        workOrder.completedAt = new Date();
        workOrder.verified = false; // Čeka verifikaciju admina
        
        // Kreiraj notifikaciju za admin kada tehničar završi radni nalog
        try {
          console.log('=== TEHNICIAN UPDATE: Pozivam createNotification ===');
          console.log('createNotification type:', typeof createNotification);
          console.log('createNotification function:', createNotification);
          
          // Pronađi sve admne (tehničari sa admin privilegijama)
          const adminUsers = await Technician.find({ isAdmin: true });
          console.log('Pronašao admin tehničare:', adminUsers.length);
          
          // Kreiraj notifikaciju za svakog admina
          for (const adminUser of adminUsers) {
            console.log('Kreiram notifikaciju za admin:', adminUser._id);
            await createNotification('work_order_verification', {
              workOrderId: workOrder._id,
              technicianId: technicianId,
              technicianName: technician ? technician.name : 'Nepoznat tehničar',
              recipientId: adminUser._id
            });
            console.log('Notifikacija kreirana za admin:', adminUser._id);
          }
          
          console.log('Notifikacija kreirana za završetak radnog naloga (tehnician update):', workOrder._id);
        } catch (notificationError) {
          console.error('=== Error u createNotification (tehnician update) ===');
          console.error('Greška pri kreiranju notifikacije za završetak radnog naloga:', notificationError);
          console.error('Error stack:', notificationError.stack);
          // Ne prekidamo proces zbog greške u notifikaciji
        }

        // FINANSIJSKA KALKULACIJA - Kada tehničar završi radni nalog i on je verifikovan
        console.log('=== TECHNICIAN UPDATE - Checking for financial calculation ===');
        if (workOrder.verified) {
          console.log('Work order is completed and verified by technician update, creating financial transaction...');
          await createFinancialTransaction(workOrder._id);
        } else {
          console.log('Work order completed but not yet verified - Status:', status, 'Verified:', workOrder.verified);
        }
      } 
      // Ako je status promenjen na "odlozen", dodaj novo vreme i datum
      else if (status === 'odlozen') {
        // Validacija: komentar za odlaganje je obavezan
        if (!postponeComment || postponeComment.trim() === '') {
          return res.status(400).json({ 
            error: 'Komentar za odlaganje radnog naloga je obavezan' 
          });
        }
        
        workOrder.postponedAt = new Date();
        
        // Ako su dostavljeni novi datum i vreme, ažuriramo ih i validiramo
        if (postponeDate && postponeTime) {
          // Kreiraj postponedUntil datetime objekat
          const postponedDateTime = new Date(`${postponeDate}T${postponeTime}:00`);
          const currentTime = new Date();
          const maxAllowedTime = new Date(currentTime.getTime() + (48 * 60 * 60 * 1000)); // 48 sati
          
          // Validacija: ne sme biti odložen za više od 48 sati
          if (postponedDateTime > maxAllowedTime) {
            return res.status(400).json({ 
              error: 'Radni nalog ne može biti odložen za više od 48 sati. Otkažite radni nalog.' 
            });
          }
          
          // Validacija: ne sme biti odložen u prošlost
          if (postponedDateTime <= currentTime) {
            return res.status(400).json({ 
              error: 'Radni nalog ne može biti odložen u prošlost.' 
            });
          }
          
          workOrder.date = postponeDate;
          workOrder.time = postponeTime;
          workOrder.postponedUntil = postponedDateTime;

          // Ažuriraj appointmentDateTime kada se menja datum/vreme
          let [postponeHours, postponeMinutes] = [9, 0];
          if (postponeTime && typeof postponeTime === 'string') {
            const postponeTimeParts = postponeTime.split(':');
            postponeHours = parseInt(postponeTimeParts[0]) || 9;
            postponeMinutes = parseInt(postponeTimeParts[1]) || 0;
          }
          const newAppointmentDateTime = new Date(postponeDate);
          newAppointmentDateTime.setHours(postponeHours, postponeMinutes, 0, 0);
          workOrder.appointmentDateTime = newAppointmentDateTime;
        }
        
        // Dodaj podatke o odlaganju u historiju
        if (!workOrder.postponeHistory) {
          workOrder.postponeHistory = [];
        }
        
        workOrder.postponeHistory.push({
          postponedAt: new Date(),
          fromDate: workOrder.date,
          fromTime: workOrder.time,
          toDate: postponeDate,
          toTime: postponeTime,
          comment: postponeComment,
          postponedBy: technicianId
        });
      }
      // Ako je status "otkazan", dodaj timestamp otkazivanja
      else if (status === 'otkazan') {
        // Validacija: komentar za otkazivanje je obavezan
        if (!cancelComment || cancelComment.trim() === '') {
          return res.status(400).json({ 
            error: 'Komentar za otkazivanje radnog naloga je obavezan' 
          });
        }
        
        workOrder.canceledAt = new Date();
        
        // Dodaj podatke o otkazivanju u historiju
        if (!workOrder.cancelHistory) {
          workOrder.cancelHistory = [];
        }
        
        workOrder.cancelHistory.push({
          canceledAt: new Date(),
          comment: cancelComment,
          canceledBy: technicianId
        });
      }
    }
    
    const updatedWorkOrder = await workOrder.save();

    // Ažuriranje WorkOrderEvidence zapisa
    try {
      const evidenceUpdateData = {
        status: updatedWorkOrder.status === 'zavrsen' ? 'ZAVRŠENO' :
                updatedWorkOrder.status === 'otkazan' ? 'OTKAZANO' :
                updatedWorkOrder.status === 'odlozen' ? 'ODLOŽENO' : 'U TOKU',
        notes: updatedWorkOrder.comment || '',
        verified: updatedWorkOrder.verified,
        userPhone: updatedWorkOrder.userPhone || '',
        customerName: updatedWorkOrder.userName || ''
      };

      if (updatedWorkOrder.status === 'zavrsen') {
        evidenceUpdateData.executionDate = new Date();
      } else if (updatedWorkOrder.status === 'odlozen') {
        evidenceUpdateData.executionDate = updatedWorkOrder.date;
      }

      // Dodeli ime tehničara ako postoji
      if (technician) {
        evidenceUpdateData.technician1 = technician.name;
      }

      await updateWorkOrderEvidence(updatedWorkOrder._id, evidenceUpdateData);
    } catch (evidenceError) {
      console.error('Greška pri ažuriranju WorkOrderEvidence:', evidenceError);
      // Ne prekidamo proces zbog greške u evidenciji
    }

    // Prepare response for activity logger
    const responseData = {
      ...updatedWorkOrder.toObject(),
      oldStatus: oldStatus,
      oldComment: oldComment
    };

    res.json(responseData);
  } catch (error) {
    console.error('Greška pri ažuriranju radnog naloga od strane tehničara:', error);
    res.status(500).json({ error: 'Greška pri ažuriranju radnog naloga' });
  }
});

// POST - Dodavanje slike radnom nalogu (Cloudinary)
router.post('/:id/images', imageUpload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { technicianId } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'Slika nije priložena' });
    }
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const workOrder = await WorkOrder.findById(id);
    
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }
    
    console.log('Pokušavam upload slike na Cloudinary za radni nalog:', id);

    let imageBuffer = req.file.buffer;
    let originalFileName = req.file.originalname;

    // Konvertuj HEIC/HEIF u JPEG ako je potrebno (samo ako fajl nije već konvertovan)
    const fileExtension = path.extname(originalFileName).toLowerCase();
    const isHeicFile = fileExtension === '.heic' || fileExtension === '.heif';
    const isAlreadyJpeg = fileExtension === '.jpg' || fileExtension === '.jpeg' || req.file.mimetype === 'image/jpeg';

    if (isHeicFile && !isAlreadyJpeg) {
      console.log('Konvertujem HEIC/HEIF sliku u JPEG...');
      try {
        imageBuffer = await convert({
          buffer: imageBuffer, // the HEIC file buffer
          format: 'JPEG',      // output format
          quality: 0.8         // output quality (0.1 to 1.0)
        });

        // Promeni extension u .jpg za konvertovanu sliku
        const nameWithoutExtension = path.parse(originalFileName).name;
        originalFileName = nameWithoutExtension + '.jpg';

        console.log('HEIC/HEIF konverzija uspešna, novi naziv:', originalFileName);
      } catch (conversionError) {
        console.error('Greška pri konverziji HEIC/HEIF slike:', conversionError);
        return res.status(500).json({ error: 'Greška pri konverziji HEIC/HEIF slike' });
      }
    }

    // Upload slike na Cloudinary sa kompresijom
    const cloudinaryResult = await uploadImage(imageBuffer, id);
    
    if (!workOrder.images) {
      workOrder.images = [];
    }
    
    // Dodaj Cloudinary URL i originalni naziv u bazu podataka
    const imageUrl = cloudinaryResult.secure_url;
    const imageObject = {
      url: imageUrl,
      originalName: originalFileName, // Koristi procesovano ime fajla
      uploadedAt: new Date(),
      uploadedBy: technicianId
    };
    workOrder.images.push(imageObject);

    const updatedWorkOrder = await workOrder.save();

    // Log image addition
    if (technicianId) {
      try {
        const technician = await Technician.findById(technicianId);
        if (technician) {
          await logImageAdded(technicianId, technician.name, workOrder, originalFileName, imageUrl); // Koristi procesovano ime fajla
        }
      } catch (logError) {
        console.error('Greška pri logovanju dodavanja slike:', logError);
      }
    }
    
    console.log('Slika uspešno upload-ovana na Cloudinary:', imageUrl);
    
    res.json({
      message: 'Slika uspešno dodata na Cloudinary',
      imageUrl: imageUrl,
      workOrder: updatedWorkOrder
    });
  } catch (error) {
    console.error('Greška pri dodavanju slike radnom nalogu na Cloudinary:', error);
    res.status(500).json({ 
      error: 'Greška pri dodavanju slike radnom nalogu', 
      details: error.message 
    });
  }
});

// DELETE - Brisanje slike iz radnog naloga
router.delete('/:id/images', async (req, res) => {
  try {
    const { id } = req.params;
    const { imageUrl, technicianId } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    if (!imageUrl) {
      return res.status(400).json({ error: 'URL slike je obavezan' });
    }
    
    const workOrder = await WorkOrder.findById(id);
    
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }
    
    // Extract image name from URL for logging
    const imageName = imageUrl.split('/').pop().split('.')[0];
    
    // Ukloni sliku iz baze podataka (radi sa novom i starom strukturom)
    workOrder.images = workOrder.images.filter(img => {
      // Novi format - objekat sa url propertijem
      if (typeof img === 'object' && img.url) {
        return img.url !== imageUrl;
      }
      // Stari format - direktno string URL
      return img !== imageUrl;
    });
    
    try {
      // Izvuci public_id iz Cloudinary URL-a
      const publicId = imageUrl.split('/').pop().split('.')[0];
      const fullPublicId = `workorders/${publicId}`;
      
      // Obriši sliku sa Cloudinary
      await deleteImage(fullPublicId);
      console.log('Slika obrisana sa Cloudinary:', fullPublicId);
    } catch (cloudinaryError) {
      console.error('Greška pri brisanju slike sa Cloudinary:', cloudinaryError);
      // Nastavi i bez brisanja sa Cloudinary
    }
    
    const updatedWorkOrder = await workOrder.save();
    
    // Log image removal
    if (technicianId) {
      try {
        const technician = await Technician.findById(technicianId);
        if (technician) {
          await logImageRemoved(technicianId, technician.name, workOrder, imageName, imageUrl);
        }
      } catch (logError) {
        console.error('Greška pri logovanju brisanja slike:', logError);
      }
    }
    
    res.json({
      message: 'Slika uspešno obrisana',
      workOrder: updatedWorkOrder
    });
  } catch (error) {
    console.error('Greška pri brisanju slike:', error);
    res.status(500).json({ error: 'Greška pri brisanju slike' });
  }
});

// PUT - Verifikacija radnog naloga od strane admina
router.put('/:id/verify', auth, logActivity('workorders', 'workorder_edit', {
  getEntityId: (req) => req.params.id,
  getEntityName: (req, responseData) => responseData?.workOrder?.tisJobId || 'WorkOrder',
  getDetails: async (req, responseData) => {
    const customerStatus = responseData?.customerStatus || 'Nije naveden';
    return {
      action: 'updated',
      changes: [
        'Verifikovan radni nalog',
        `Status korisnika: ${customerStatus}`
      ],
      changeCount: 2,
      summary: `Verifikovan sa statusom: ${customerStatus}`
    };
  }
}), async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    const workOrder = await WorkOrder.findById(id);

    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }

    if (workOrder.status !== 'zavrsen') {
      return res.status(400).json({ error: 'Samo završeni radni nalozi mogu biti verifikovani' });
    }

    // Umesto save() koji pokreće validaciju, koristimo findByIdAndUpdate
    // koji će ažurirati samo navedena polja
    const updatedWorkOrder = await WorkOrder.findByIdAndUpdate(
      id,
      {
        verified: true,
        verifiedAt: new Date()
      },
      { new: true } // Vraća ažurirani dokument
    );

    // FINANSIJSKA KALKULACIJA - Kada admin verifikuje radni nalog
    console.log('=== ADMIN VERIFICATION - Checking for financial calculation ===');
    if (updatedWorkOrder && updatedWorkOrder.status === 'zavrsen' && updatedWorkOrder.verified) {
      console.log('Work order is completed and verified, creating financial transaction...');
      await createFinancialTransaction(updatedWorkOrder._id);
    } else {
      console.log('Work order not ready for financial calculation - Status:', updatedWorkOrder?.status, 'Verified:', updatedWorkOrder?.verified);
    }

    // Get customer status from WorkOrderEvidence for logging
    let customerStatus = 'Nije naveden';
    try {
      const evidence = await WorkOrderEvidence.findOne({ workOrderId: id }).select('customerStatus').lean();
      if (evidence && evidence.customerStatus) {
        customerStatus = evidence.customerStatus;
      }
    } catch (err) {
      console.error('Error fetching customer status:', err);
    }

    res.json({
      message: 'Radni nalog je uspešno verifikovan',
      workOrder: updatedWorkOrder,
      customerStatus: customerStatus
    });
  } catch (error) {
    console.error('Greška pri verifikaciji radnog naloga:', error);
    res.status(500).json({ error: 'Greška pri verifikaciji radnog naloga' });
  }
});

// PUT - Vraćanje radnog naloga kao neispravno popunjenog
router.put('/:id/return-incorrect', auth, logActivity('workorders', 'workorder_edit', {
  getEntityId: (req) => req.params.id,
  getEntityName: (req, responseData) => {
    return responseData?.tisJobId || responseData?.workOrder?.tisJobId || 'WorkOrder';
  },
  getDetails: async (req, responseData) => {
    const adminComment = responseData?.adminComment || req.body?.adminComment || 'Nije naveden';
    console.log('🔍 [getDetails] adminComment:', adminComment);
    return {
      action: 'updated',
      changes: [
        'Radni nalog vraćen kao neispravno popunjen',
        `Razlog: ${adminComment}`
      ],
      changeCount: 2,
      summary: 'Vraćen kao neispravno popunjen'
    };
  }
}), async (req, res) => {
  try {
    const { id } = req.params;
    const { adminComment } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    if (!adminComment || adminComment.trim() === '') {
      return res.status(400).json({ error: 'Admin komentar je obavezan' });
    }

    const workOrder = await WorkOrder.findById(id);

    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }

    if (workOrder.status !== 'zavrsen') {
      return res.status(400).json({ error: 'Samo završeni radni nalozi mogu biti vraćeni' });
    }

    // Ažuriraj radni nalog - postavi status na nezavrsen i dodaj admin komentar
    const updatedWorkOrder = await WorkOrder.findByIdAndUpdate(
      id,
      {
        status: 'nezavrsen',
        adminComment: adminComment.trim(),
        verified: false,
        verifiedAt: null
      },
      { new: true }
    ).populate('technicianId technician2Id', 'name');

    console.log('🔍 [return-incorrect] Sending response with:', {
      tisJobId: updatedWorkOrder.tisJobId,
      adminComment: adminComment.trim()
    });

    res.json({
      message: 'Radni nalog je vraćen tehničaru',
      workOrder: updatedWorkOrder,
      tisJobId: updatedWorkOrder.tisJobId,
      adminComment: adminComment.trim()
    });
  } catch (error) {
    console.error('Greška pri vraćanju radnog naloga:', error);
    res.status(500).json({ error: 'Greška pri vraćanju radnog naloga' });
  }
});

// POST - Ažuriranje utrošenog materijala za radni nalog
router.post('/:id/used-materials', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { materials, technicianId } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    if (!Array.isArray(materials)) {
      return res.status(400).json({ error: 'Potrebno je dostaviti niz materijala' });
    }
    
    // Validacija materijala
    for (const material of materials) {
      if (!material.material || !mongoose.Types.ObjectId.isValid(material.material)) {
        return res.status(400).json({ error: 'Neispravan ID materijala' });
      }
      if (!material.quantity || material.quantity <= 0) {
        return res.status(400).json({ error: 'Količina mora biti veća od 0' });
      }
    }
    
    const workOrder = await WorkOrder.findById(id);
    
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }
    
    // Store old materials for comparison
    const oldMaterials = workOrder.materials || [];
    
    // Proveravamo i ažuriramo tehničarov inventar pre čuvanja workorder-a
    if (technicianId) {
      const technician = await Technician.findById(technicianId);
      if (!technician) {
        return res.status(404).json({ error: 'Tehničar nije pronađen' });
      }
      
      // Prolazimo kroz sve materijale i ažuriramo tehničarov inventar
      for (const materialItem of materials) {
        const existingOldMaterial = oldMaterials.find(
          old => old.material.toString() === materialItem.material.toString()
        );
        
        const newQuantity = materialItem.quantity;
        const oldQuantity = existingOldMaterial ? existingOldMaterial.quantity : 0;
        const quantityDiff = newQuantity - oldQuantity;
        
        if (quantityDiff !== 0) {
          // Pronađi materijal kod tehničara
          const techMaterialIndex = technician.materials.findIndex(
            tm => tm.materialId.toString() === materialItem.material.toString()
          );
          
          if (quantityDiff > 0) {
            // Dodaje se materijal - treba oduzeti iz tehničarovog inventara
            if (techMaterialIndex === -1) {
              return res.status(400).json({ 
                error: `Tehničar nema materijal ${materialItem.material} u svom inventaru` 
              });
            }
            
            const techMaterial = technician.materials[techMaterialIndex];
            if (techMaterial.quantity < quantityDiff) {
              const materialDoc = await Material.findById(materialItem.material);
              return res.status(400).json({ 
                error: `Tehničar nema dovoljno materijala ${materialDoc ? materialDoc.type : materialItem.material}. Dostupno: ${techMaterial.quantity}, potrebno: ${quantityDiff}` 
              });
            }
            
            // Oduzmi iz tehničarovog inventara
            techMaterial.quantity -= quantityDiff;
            if (techMaterial.quantity === 0) {
              technician.materials.splice(techMaterialIndex, 1);
            }
          } else if (quantityDiff < 0) {
            // Uklanja se materijal - treba vratiti u tehničarov inventar
            const returnQuantity = Math.abs(quantityDiff);
            
            if (techMaterialIndex === -1) {
              // Tehničar nema ovaj materijal - dodaj ga
              technician.materials.push({
                materialId: materialItem.material,
                quantity: returnQuantity
              });
            } else {
              // Tehničar već ima ovaj materijal - uvećaj količinu
              technician.materials[techMaterialIndex].quantity += returnQuantity;
            }
          }
        }
      }
      
      // Proveravamo materijale koji su u potpunosti uklonjeni iz workorder-a
      for (const oldMaterial of oldMaterials) {
        const stillExists = materials.find(
          mat => mat.material.toString() === oldMaterial.material.toString()
        );
        
        if (!stillExists) {
          // Materijal je u potpunosti uklonjen - vrati ga u tehničarov inventar
          const techMaterialIndex = technician.materials.findIndex(
            tm => tm.materialId.toString() === oldMaterial.material.toString()
          );
          
          if (techMaterialIndex === -1) {
            technician.materials.push({
              materialId: oldMaterial.material,
              quantity: oldMaterial.quantity
            });
          } else {
            technician.materials[techMaterialIndex].quantity += oldMaterial.quantity;
          }
        }
      }
      
      // Sačuvaj tehničara sa ažuriranim inventarom
      await technician.save();
    }
    
    // Ažuriranje utrošenih materijala
    // Za svaki materijal, dodaj technicianId ako je nov, ili zadrži postojeći ako već postoji
    workOrder.materials = materials.map(mat => {
      const existing = oldMaterials.find(old => old.material.toString() === mat.material.toString());
      return {
        material: mat.material,
        quantity: mat.quantity,
        technicianId: existing ? existing.technicianId : technicianId
      };
    });

    const updatedWorkOrder = await workOrder.save();
    
    // Log material additions
    if (technicianId) {
      try {
        const technician = await Technician.findById(technicianId);
        if (technician) {
          // Compare old and new materials to log changes
          for (const newMaterial of materials) {
            const existingMaterial = oldMaterials.find(
              old => old.material.toString() === newMaterial.material.toString()
            );
            
            const newQuantity = newMaterial.quantity;
            const oldQuantity = existingMaterial ? existingMaterial.quantity : 0;
            
            if (newQuantity > oldQuantity) {
              // Material was added
              const materialDoc = await Material.findById(newMaterial.material);
              if (materialDoc) {
                const log = await logMaterialAdded(
                  technicianId, 
                  technician.name, 
                  workOrder, 
                  materialDoc, 
                  newQuantity - oldQuantity
                );
                
                // Check for material anomaly after logging
                if (log) {
                  await checkMaterialAnomaly(
                    technicianId,
                    technician.name,
                    workOrder,
                    materialDoc,
                    newQuantity - oldQuantity,
                    log._id
                  );
                }
              }
            } else if (newQuantity < oldQuantity) {
              // Material was reduced
              const materialDoc = await Material.findById(newMaterial.material);
              if (materialDoc) {
                await logMaterialRemoved(
                  technicianId, 
                  technician.name, 
                  workOrder, 
                  materialDoc, 
                  oldQuantity - newQuantity
                );
              }
            }
          }
          
          // Log materials that were completely removed from workorder
          for (const oldMaterial of oldMaterials) {
            const stillExists = materials.find(
              mat => mat.material.toString() === oldMaterial.material.toString()
            );
            
            if (!stillExists) {
              // Material was completely removed from workorder
              const materialDoc = await Material.findById(oldMaterial.material);
              if (materialDoc) {
                await logMaterialRemoved(
                  technicianId, 
                  technician.name, 
                  workOrder, 
                  materialDoc, 
                  oldMaterial.quantity
                );
              }
            }
          }
        }
      } catch (logError) {
        console.error('Greška pri logovanju dodavanja materijala:', logError);
      }
    }

    // Log to AdminActivityLog if action is done by admin/superadmin/supervisor
    if (req.user && (req.user.role === 'admin' || req.user.role === 'superadmin' || req.user.role === 'supervisor')) {
      try {
        // Log material additions and removals
        for (const newMaterial of materials) {
          const existingMaterial = oldMaterials.find(
            old => old.material.toString() === newMaterial.material.toString()
          );

          const newQuantity = newMaterial.quantity;
          const oldQuantity = existingMaterial ? existingMaterial.quantity : 0;

          if (newQuantity > oldQuantity) {
            // Material was added
            const materialDoc = await Material.findById(newMaterial.material);
            if (materialDoc) {
              await AdminActivityLog.create({
                userId: req.user._id,
                userName: req.user.name,
                userRole: req.user.role,
                action: 'edit_material_add',
                category: 'edit',
                entityType: 'WorkOrder',
                entityId: workOrder._id,
                entityName: `Radni nalog ${workOrder.tisId} - ${workOrder.userName || workOrder.user || 'N/A'}`,
                details: {
                  action: 'added',
                  workOrder: {
                    _id: workOrder._id,
                    tisId: workOrder.tisId,
                    userName: workOrder.userName || workOrder.user || 'N/A',
                    address: workOrder.address,
                    municipality: workOrder.municipality,
                    type: workOrder.type,
                    date: workOrder.date
                  },
                  material: {
                    _id: materialDoc._id,
                    type: materialDoc.type,
                    quantity: newQuantity - oldQuantity
                  }
                },
                timestamp: new Date()
              });
            }
          } else if (newQuantity < oldQuantity) {
            // Material was reduced
            const materialDoc = await Material.findById(newMaterial.material);
            if (materialDoc) {
              await AdminActivityLog.create({
                userId: req.user._id,
                userName: req.user.name,
                userRole: req.user.role,
                action: 'edit_material_remove',
                category: 'edit',
                entityType: 'WorkOrder',
                entityId: workOrder._id,
                entityName: `Radni nalog ${workOrder.tisId} - ${workOrder.userName || workOrder.user || 'N/A'}`,
                details: {
                  action: 'removed',
                  workOrder: {
                    _id: workOrder._id,
                    tisId: workOrder.tisId,
                    userName: workOrder.userName || workOrder.user || 'N/A',
                    address: workOrder.address,
                    municipality: workOrder.municipality,
                    type: workOrder.type,
                    date: workOrder.date
                  },
                  material: {
                    _id: materialDoc._id,
                    type: materialDoc.type,
                    quantity: oldQuantity - newQuantity
                  }
                },
                timestamp: new Date()
              });
            }
          }
        }

        // Log materials that were completely removed from workorder
        for (const oldMaterial of oldMaterials) {
          const stillExists = materials.find(
            mat => mat.material.toString() === oldMaterial.material.toString()
          );

          if (!stillExists) {
            const materialDoc = await Material.findById(oldMaterial.material);
            if (materialDoc) {
              await AdminActivityLog.create({
                userId: req.user._id,
                userName: req.user.name,
                userRole: req.user.role,
                action: 'edit_material_remove',
                category: 'edit',
                entityType: 'WorkOrder',
                entityId: workOrder._id,
                entityName: `Radni nalog ${workOrder.tisId} - ${workOrder.userName || workOrder.user || 'N/A'}`,
                details: {
                  action: 'removed',
                  workOrder: {
                    _id: workOrder._id,
                    tisId: workOrder.tisId,
                    userName: workOrder.userName || workOrder.user || 'N/A',
                    address: workOrder.address,
                    municipality: workOrder.municipality,
                    type: workOrder.type,
                    date: workOrder.date
                  },
                  material: {
                    _id: materialDoc._id,
                    type: materialDoc.type,
                    quantity: oldMaterial.quantity
                  }
                },
                timestamp: new Date()
              });
            }
          }
        }

        console.log(`✅ Admin activity logged for materials by ${req.user.name} (${req.user.role})`);
      } catch (logError) {
        console.error('Greška pri logovanju edit akcije za materijale:', logError);
      }
    }

    res.json({
      message: 'Uspešno ažurirani utrošeni materijali',
      workOrder: updatedWorkOrder
    });
  } catch (error) {
    console.error('Greška pri ažuriranju materijala:', error);
    res.status(500).json({ error: 'Greška pri ažuriranju materijala' });
  }
});

// POST - Ažuriranje utrošene opreme za radni nalog
router.post('/:id/used-equipment', (req, res) => {
  const { id } = req.params;
  const { equipmentSerialNumbers } = req.body;
  
  if (!Array.isArray(equipmentSerialNumbers)) {
    return res.status(400).json({ error: 'Potrebno je dostaviti niz serijskih brojeva opreme' });
  }
  
  const workOrders = readWorkordersFile();
  const workOrderIndex = workOrders.findIndex(order => order.id === id);
  
  if (workOrderIndex === -1) {
    return res.status(404).json({ error: 'Radni nalog nije pronađen' });
  }
  
  // Dodaj ili ažuriraj listu utrošene opreme
  workOrders[workOrderIndex].usedEquipment = equipmentSerialNumbers;
  workOrders[workOrderIndex].equipmentUpdatedAt = new Date().toISOString();
  
  saveWorkordersFile(workOrders);
  
  res.json({
    message: 'Uspešno ažurirana utrošena oprema',
    workOrder: workOrders[workOrderIndex]
  });
});

// DELETE - Brisanje radnog naloga
router.delete('/:id', auth, logActivity('workorders', 'workorder_delete', {
  getEntityId: (req) => req.params.id,
  getEntityName: (req, responseData) => responseData?.deletedData?.tisJobId || 'WorkOrder'
}), async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    const workOrder = await WorkOrder.findById(id);

    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }

    // Uklanjanje referenci na radni nalog iz korisnika
    if (workOrder.user) {
      await User.findByIdAndUpdate(workOrder.user, {
        $pull: { workOrders: id }
      });
    } else if (workOrder.tisId) {
      // Alternativni način ako koristimo tisId
      const user = await User.findOne({ tisId: workOrder.tisId });
      if (user) {
        await User.findByIdAndUpdate(user._id, {
          $pull: { workOrders: id }
        });
      }
    }

    // Brisanje radnog naloga
    await WorkOrder.findByIdAndDelete(id);

    // Brisanje povezane WorkOrderEvidence evidencije
    const deletedEvidence = await WorkOrderEvidence.deleteMany({ workOrderId: id });
    if (deletedEvidence.deletedCount > 0) {
      console.log(`Obrisano ${deletedEvidence.deletedCount} WorkOrderEvidence zapisa za WorkOrder: ${id}`);
    }

    // Vrati podatke o obrisanom radnom nalogu za logovanje
    res.json({
      message: 'Radni nalog uspešno obrisan',
      deletedData: {
        tisJobId: workOrder.tisJobId,
        address: workOrder.address,
        municipality: workOrder.municipality,
        type: workOrder.type,
        status: workOrder.status,
        date: workOrder.date,
        _id: workOrder._id
      }
    });
  } catch (error) {
    console.error('Greška pri brisanju radnog naloga:', error);
    res.status(500).json({ error: 'Greška pri brisanju radnog naloga' });
  }
});

// GET - Dohvati analitiku vremena završavanja radnih naloga
router.get('/statistics/completion-time', async (req, res) => {
  try {
    const { technician, period, startDate, endDate } = req.query;
    
    // Build aggregation pipeline
    const pipeline = [];
    
    // Match criteria for work orders with first status change
    const matchCriteria = {
      prvoMenjanjeStatusa: { $exists: true, $ne: null }
    };
    
    // Add date filtering based on prvoMenjanjeStatusa
    if (period && period !== 'all') {
      const now = new Date();
      let dateFrom;
      
      switch (period) {
        case 'danas':
          dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'nedelja':
          dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'mesec':
          dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case 'kvartal':
          const currentQuarter = Math.floor(now.getMonth() / 3);
          dateFrom = new Date(now.getFullYear(), currentQuarter * 3, 1);
          break;
        case 'godina':
          dateFrom = new Date(now.getFullYear(), 0, 1);
          break;
        default:
          dateFrom = null;
      }
      
      if (dateFrom) {
        matchCriteria.prvoMenjanjeStatusa = { 
          $exists: true, 
          $ne: null,
          $gte: dateFrom 
        };
      }
    } else if (startDate && endDate) {
      matchCriteria.prvoMenjanjeStatusa = {
        $exists: true,
        $ne: null,
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    // Add technician filter
    if (technician && technician !== 'all') {
      const technicianDoc = await Technician.findOne({ name: technician });
      if (technicianDoc) {
        matchCriteria.$or = [
          { technicianId: technicianDoc._id },
          { technician2Id: technicianDoc._id }
        ];
      }
    }
    
    pipeline.push({ $match: matchCriteria });
    
    // Populate technician info
    pipeline.push({
      $lookup: {
        from: 'technicians',
        localField: 'technicianId',
        foreignField: '_id',
        as: 'technicianInfo'
      }
    });
    
    // Add technician name and construct start time from date and time
    pipeline.push({
      $addFields: {
        startDateTime: {
          $cond: {
            if: { $and: [{ $ne: ['$date', null] }, { $ne: ['$time', null] }] },
            then: {
              $dateFromParts: {
                year: { $year: '$date' },
                month: { $month: '$date' },
                day: { $dayOfMonth: '$date' },
                // Convert Belgrade time to UTC by subtracting 2 hours
                hour: { 
                  $subtract: [
                    { $toInt: { $substr: [{ $ifNull: ['$time', '09:00'] }, 0, 2] } },
                    2 // Belgrade is UTC+2
                  ]
                },
                minute: { $toInt: { $substr: [{ $ifNull: ['$time', '09:00'] }, 3, 2] } }
              }
            },
            else: '$date' // fallback to just date if time is missing
          }
        },
        technicianName: { $arrayElemAt: ['$technicianInfo.name', 0] }
      }
    });
    
    pipeline.push({
      $addFields: {
        completionTimeHours: {
          $cond: {
            if: { $ne: ['$startDateTime', null] },
            then: {
              $divide: [
                { $subtract: ['$prvoMenjanjeStatusa', '$startDateTime'] },
                3600000 // Convert milliseconds to hours
              ]
            },
            else: 0 // Default to 0 if no start time
          }
        }
      }
    });
    
    // Filter out negative completion times and null values
    pipeline.push({
      $match: {
        completionTimeHours: { $gte: 0 }
      }
    });
    
    // Group by technician for individual stats
    pipeline.push({
      $group: {
        _id: '$technicianName',
        avgCompletionTime: { $avg: '$completionTimeHours' },
        minCompletionTime: { $min: '$completionTimeHours' },
        maxCompletionTime: { $max: '$completionTimeHours' },
        totalWorkOrders: { $sum: 1 },
        completionTimes: { $push: '$completionTimeHours' },
        // Add tisJobId samples for debugging
        tisJobIds: { $push: '$tisJobId' }
      }
    });
    
    // Sort by average completion time
    pipeline.push({ $sort: { avgCompletionTime: 1 } });
    
    const results = await WorkOrder.aggregate(pipeline);
    
    // Calculate overall statistics
    let overallAvg = 0;
    let overallMin = Number.MAX_VALUE;
    let overallMax = 0;
    let totalOrders = 0;
    let allCompletionTimes = [];
    
    results.forEach(result => {
      if (result._id) { // Only count if technician name exists
        overallAvg += result.avgCompletionTime * result.totalWorkOrders;
        overallMin = Math.min(overallMin, result.minCompletionTime);
        overallMax = Math.max(overallMax, result.maxCompletionTime);
        totalOrders += result.totalWorkOrders;
        allCompletionTimes = allCompletionTimes.concat(result.completionTimes);
      }
    });
    
    overallAvg = totalOrders > 0 ? overallAvg / totalOrders : 0;
    overallMin = overallMin === Number.MAX_VALUE ? 0 : overallMin;
    
    // Calculate median
    allCompletionTimes.sort((a, b) => a - b);
    const median = allCompletionTimes.length > 0 ? 
      allCompletionTimes.length % 2 === 0 ?
        (allCompletionTimes[allCompletionTimes.length / 2 - 1] + allCompletionTimes[allCompletionTimes.length / 2]) / 2 :
        allCompletionTimes[Math.floor(allCompletionTimes.length / 2)] : 0;
    
    // Format technician data
    const technicianStats = results
      .filter(result => result._id) // Only include results with technician names
      .map(result => ({
        name: result._id,
        avgCompletionTime: Math.round(result.avgCompletionTime * 100) / 100,
        minCompletionTime: Math.round(result.minCompletionTime * 100) / 100,
        maxCompletionTime: Math.round(result.maxCompletionTime * 100) / 100,
        totalWorkOrders: result.totalWorkOrders,
        efficiency: result.avgCompletionTime <= overallAvg ? 'high' : result.avgCompletionTime <= overallAvg * 1.5 ? 'medium' : 'low',
        // Add tisJobIds for debugging/verification
        tisJobIds: result.tisJobIds || []
      }));
    
    const response = {
      overall: {
        avgCompletionTime: Math.round(overallAvg * 100) / 100,
        minCompletionTime: Math.round(overallMin * 100) / 100,
        maxCompletionTime: Math.round(overallMax * 100) / 100,
        medianCompletionTime: Math.round(median * 100) / 100,
        totalWorkOrders: totalOrders,
        period: period || 'custom',
        dateRange: startDate && endDate ? { startDate, endDate } : null
      },
      technicians: technicianStats,
      distribution: {
        fast: allCompletionTimes.filter(t => t <= overallAvg * 0.8).length,
        average: allCompletionTimes.filter(t => t > overallAvg * 0.8 && t <= overallAvg * 1.2).length,
        slow: allCompletionTimes.filter(t => t > overallAvg * 1.2).length
      }
    };
    
    res.json(response);
  } catch (error) {
    console.error('Greška pri dohvatanju analitike vremena završavanja:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju analitike vremena završavanja' });
  }
});

// GET - Dohvati statistiku radnih naloga (optimizovano sa MongoDB agregacijom)
router.get('/statistics/summary', async (req, res) => {
  try {
    // Paralelno izvršavanje agregacija za maksimalnu performansu
    const [
      totalStats,
      statusStats,
      typeStats,
      municipalityStats,
      technologyStats,
      technicianStats,
      unassignedCount,
      technicians
    ] = await Promise.all([
      // Ukupna statistika
      WorkOrder.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            verified: { $sum: { $cond: ['$verified', 1, 0] } }
          }
        }
      ]),

      // Statistika po statusu
      WorkOrder.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),

      // Statistika po tipu
      WorkOrder.aggregate([
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 }
          }
        }
      ]),

      // Statistika po opštini
      WorkOrder.aggregate([
        {
          $group: {
            _id: '$municipality',
            count: { $sum: 1 }
          }
        }
      ]),

      // Statistika po tehnologiji
      WorkOrder.aggregate([
        {
          $match: { technology: { $exists: true, $ne: null } }
        },
        {
          $group: {
            _id: '$technology',
            count: { $sum: 1 }
          }
        }
      ]),

      // Statistika po tehničarima
      WorkOrder.aggregate([
        {
          $match: { technicianId: { $exists: true, $ne: null } }
        },
        {
          $group: {
            _id: '$technicianId',
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'zavrsen'] }, 1, 0] } },
            pending: { $sum: { $cond: [{ $eq: ['$status', 'nezavrsen'] }, 1, 0] } },
            postponed: { $sum: { $cond: [{ $eq: ['$status', 'odlozen'] }, 1, 0] } },
            canceled: { $sum: { $cond: [{ $eq: ['$status', 'otkazan'] }, 1, 0] } },
            verified: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'zavrsen'] }, '$verified'] }, 1, 0] } }
          }
        }
      ]),

      // Broj nedodeljenih
      WorkOrder.countDocuments({ technicianId: { $exists: false } }),

      // Podaci o tehničarima
      Technician.find().select('name phone email').lean()
    ]);

    // Formatiranje rezultata
    const total = totalStats[0]?.total || 0;
    const verified = totalStats[0]?.verified || 0;

    // Formatiranje statusnih statistika
    const statusMap = { completed: 0, pending: 0, postponed: 0, canceled: 0 };
    statusStats.forEach(stat => {
      switch (stat._id) {
        case 'zavrsen': statusMap.completed = stat.count; break;
        case 'nezavrsen': statusMap.pending = stat.count; break;
        case 'odlozen': statusMap.postponed = stat.count; break;
        case 'otkazan': statusMap.canceled = stat.count; break;
      }
    });

    // Formatiranje statistika po tipovima
    const byType = {};
    typeStats.forEach(stat => {
      byType[stat._id] = stat.count;
    });

    // Formatiranje statistika po opštinama
    const byMunicipality = {};
    municipalityStats.forEach(stat => {
      byMunicipality[stat._id] = stat.count;
    });

    // Formatiranje statistika po tehnologijama
    const byTechnology = {};
    technologyStats.forEach(stat => {
      byTechnology[stat._id] = stat.count;
    });

    // Formatiranje statistika po tehničarima
    const byTechnician = {};
    technicianStats.forEach(stat => {
      byTechnician[stat._id.toString()] = {
        total: stat.total,
        completed: stat.completed,
        pending: stat.pending,
        postponed: stat.postponed,
        canceled: stat.canceled,
        verified: stat.verified
      };
    });

    // Formatiranje podataka o tehničarima
    const technicianDetails = {};
    technicians.forEach(tech => {
      technicianDetails[tech._id.toString()] = {
        name: tech.name,
        phone: tech.phone || null,
        email: tech.email || null
      };
    });

    res.json({
      total,
      completed: statusMap.completed,
      pending: statusMap.pending,
      postponed: statusMap.postponed,
      canceled: statusMap.canceled,
      verified,
      unassigned: unassignedCount,
      byType,
      byMunicipality,
      byTechnology,
      byTechnician,
      technicianDetails
    });
  } catch (error) {
    console.error('Greška pri dohvatanju statistike radnih naloga:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju statistike radnih naloga' });
  }
});

// POST - Dodavanje instaliranog uređaja u WorkOrderEvidence
router.post('/:id/installed-equipment', async (req, res) => {
  try {
    const { id } = req.params;
    const { equipmentType, serialNumber, condition, notes } = req.body;
    
    console.log('Received request for installed equipment:', { id, equipmentType, serialNumber, condition, notes });
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    if (!equipmentType || !serialNumber) {
      return res.status(400).json({ error: 'Tip uređaja i serijski broj su obavezni' });
    }

    console.log('Looking for WorkOrderEvidence with workOrderId:', id);
    const evidence = await WorkOrderEvidence.findOne({ workOrderId: id });
    console.log('Found evidence:', evidence ? 'Yes' : 'No');
    
    if (!evidence) {
      return res.status(404).json({ error: 'WorkOrderEvidence nije pronađen' });
    }

    const equipmentData = {
      equipmentType,
      serialNumber,
      condition: condition || 'N',
      installedAt: new Date(),
      notes: notes || ''
    };

    console.log('Adding equipment data:', equipmentData);
    console.log('Current installedEquipment length:', evidence.installedEquipment.length);
    
    evidence.installedEquipment.push(equipmentData);
    
    console.log('New installedEquipment length:', evidence.installedEquipment.length);
    
    const savedEvidence = await evidence.save();
    console.log('Evidence saved successfully');

    res.json({
      message: 'Uređaj uspešno dodat u listu instaliranih',
      evidence: savedEvidence
    });
  } catch (error) {
    console.error('Greška pri dodavanju instaliranog uređaja:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Greška pri dodavanju instaliranog uređaja',
      details: error.message
    });
  }
});

// POST - Dodavanje uklonjenog uređaja u WorkOrderEvidence
router.post('/:id/removed-equipment', async (req, res) => {
  try {
    const { id } = req.params;
    const { equipmentType, serialNumber, condition, reason, notes } = req.body;

    console.log('Received request for removed equipment:', { id, equipmentType, serialNumber, condition, reason, notes });

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    if (!equipmentType || !serialNumber || !condition) {
      return res.status(400).json({ error: 'Tip uređaja, serijski broj i stanje su obavezni' });
    }

    console.log('Looking for WorkOrderEvidence with workOrderId:', id);
    const evidence = await WorkOrderEvidence.findOne({ workOrderId: id });
    console.log('Found evidence:', evidence ? 'Yes' : 'No');

    if (!evidence) {
      return res.status(404).json({ error: 'WorkOrderEvidence nije pronađen' });
    }

    // Provera da li oprema postoji u Equipment bazi (case-insensitive)
    const existingEquipment = await findEquipmentBySerialNumber(serialNumber);

    if (existingEquipment) {
      console.log('Equipment found in database:', existingEquipment.serialNumber);

      // Automatski markiranje opreme kao defektivne ako je u lošem stanju
      if (condition === 'R' && existingEquipment.status !== 'defective') {
        existingEquipment.status = 'defective';
        existingEquipment.location = 'defective';
        existingEquipment.removedAt = new Date();
        existingEquipment.assignedTo = null;
        existingEquipment.assignedToUser = null;
        await existingEquipment.save();
        console.log('Equipment marked as defective in database');
      }
    } else {
      console.log('Equipment not found in database - proceeding with manual entry');
    }

    const equipmentData = {
      equipmentType,
      serialNumber,
      condition,
      removedAt: new Date(),
      reason: reason || 'Ostalo',
      notes: notes || ''
    };

    console.log('Adding removed equipment data:', equipmentData);
    console.log('Current removedEquipment length:', evidence.removedEquipment.length);

    evidence.removedEquipment.push(equipmentData);

    console.log('New removedEquipment length:', evidence.removedEquipment.length);

    const savedEvidence = await evidence.save();
    console.log('Evidence saved successfully');

    res.json({
      message: 'Uređaj uspešno dodat u listu uklonjenih',
      evidence: savedEvidence,
      equipmentMarkedDefective: existingEquipment && condition === 'R'
    });
  } catch (error) {
    console.error('Greška pri dodavanju uklonjenog uređaja:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      error: 'Greška pri dodavanju uklonjenog uređaja',
      details: error.message
    });
  }
});

// PUT - Ažuriranje statusa korisnika u WorkOrderEvidence
router.put('/:id/customer-status', auth, logActivity('workorders', 'workorder_edit', {
  getEntityId: (req) => req.params.id,
  getEntityName: async (req, responseData) => {
    // Get WorkOrder to find tisJobId
    const workOrder = await WorkOrder.findById(req.params.id).select('tisJobId').lean();
    return workOrder?.tisJobId || 'WorkOrder';
  },
  getDetails: async (req, responseData) => {
    const { customerStatus } = req.body;
    const oldStatus = responseData?.oldCustomerStatus;

    const changes = [];
    if (oldStatus && oldStatus !== customerStatus) {
      changes.push(`Promenjen Status korisnika: ${oldStatus} → ${customerStatus}`);
    } else if (!oldStatus) {
      changes.push(`Dodat Status korisnika: ${customerStatus}`);
    }

    return {
      action: 'updated',
      changes: changes.length > 0 ? changes : ['Ažuriran status korisnika'],
      changeCount: changes.length || 1,
      summary: changes.join(' • ') || 'Ažuriran status korisnika'
    };
  }
}), async (req, res) => {
  try {
    const { id } = req.params;
    const { customerStatus } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    if (!customerStatus) {
      return res.status(400).json({ error: 'Status korisnika je obavezan' });
    }

    let evidence = await WorkOrderEvidence.findOne({ workOrderId: id });
    const oldCustomerStatus = evidence?.customerStatus;

    if (!evidence) {
      // Ako ne postoji WorkOrderEvidence, kreiraj ga na osnovu WorkOrder-a
      console.log('WorkOrderEvidence ne postoji za:', id, 'kreiram novi...');

      const workOrder = await WorkOrder.findById(id);
      if (!workOrder) {
        return res.status(404).json({ error: 'Radni nalog nije pronađen' });
      }

      // Kreiraj novi WorkOrderEvidence zapis
      try {
        evidence = await createWorkOrderEvidence(workOrder);
        console.log('Novi WorkOrderEvidence kreiran za:', id);
      } catch (createError) {
        console.error('Greška pri kreiranju WorkOrderEvidence:', createError);
        return res.status(500).json({ error: 'Greška pri kreiranju evidence zapisa' });
      }
    }

    evidence.customerStatus = customerStatus;
    await evidence.save();

    res.json({
      message: 'Status korisnika uspešno ažuriran',
      evidence: evidence,
      oldCustomerStatus: oldCustomerStatus
    });
  } catch (error) {
    console.error('Greška pri ažuriranju statusa korisnika:', error);
    res.status(500).json({ error: 'Greška pri ažuriranju statusa korisnika' });
  }
});

// GET - Dohvati WorkOrderEvidence za radni nalog
router.get('/:id/evidence', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    let evidence = await WorkOrderEvidence.findOne({ workOrderId: id });
    
    if (!evidence) {
      // Ako ne postoji WorkOrderEvidence, kreiraj ga na osnovu WorkOrder-a
      console.log('WorkOrderEvidence ne postoji za:', id, 'kreiram novi...');
      
      const workOrder = await WorkOrder.findById(id);
      if (!workOrder) {
        return res.status(404).json({ error: 'Radni nalog nije pronađen' });
      }
      
      // Kreiraj novi WorkOrderEvidence zapis
      try {
        evidence = await createWorkOrderEvidence(workOrder);
        console.log('Novi WorkOrderEvidence kreiran za:', id);
      } catch (createError) {
        console.error('Greška pri kreiranju WorkOrderEvidence:', createError);
        return res.status(500).json({ error: 'Greška pri kreiranju evidence zapisa' });
      }
    }

    res.json(evidence);
  } catch (error) {
    console.error('Greška pri dohvatanju WorkOrderEvidence:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju WorkOrderEvidence' });
  }
});

// DELETE - Uklanjanje instaliranog uređaja iz WorkOrderEvidence
router.delete('/:id/installed-equipment/:equipmentId', async (req, res) => {
  try {
    const { id, equipmentId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    const evidence = await WorkOrderEvidence.findOne({ workOrderId: id });
    if (!evidence) {
      return res.status(404).json({ error: 'WorkOrderEvidence nije pronađen' });
    }

    evidence.installedEquipment = evidence.installedEquipment.filter(
      eq => eq._id.toString() !== equipmentId
    );
    await evidence.save();

    res.json({
      message: 'Uređaj uspešno uklonjen iz liste instaliranih',
      evidence: evidence
    });
  } catch (error) {
    console.error('Greška pri uklanjanju instaliranog uređaja:', error);
    res.status(500).json({ error: 'Greška pri uklanjanju instaliranog uređaja' });
  }
});

// DELETE - Uklanjanje uklonjenog uređaja iz WorkOrderEvidence
router.delete('/:id/removed-equipment/:equipmentId', async (req, res) => {
  try {
    const { id, equipmentId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    const evidence = await WorkOrderEvidence.findOne({ workOrderId: id });
    if (!evidence) {
      return res.status(404).json({ error: 'WorkOrderEvidence nije pronađen' });
    }

    evidence.removedEquipment = evidence.removedEquipment.filter(
      eq => eq._id.toString() !== equipmentId
    );
    await evidence.save();

    res.json({
      message: 'Uređaj uspešno uklonjen iz liste uklonjenih',
      evidence: evidence
    });
  } catch (error) {
    console.error('Greška pri uklanjanju uklonjenog uređaja:', error);
    res.status(500).json({ error: 'Greška pri uklanjanju uklonjenog uređaja' });
  }
});

// Test endpoint za ručno pokretanje scheduler-a
router.post('/test-scheduler', async (req, res) => {
  try {
    await testScheduler();
    res.json({ message: 'Scheduler test completed - check console logs' });
  } catch (error) {
    console.error('Error running scheduler test:', error);
    res.status(500).json({ error: 'Error running scheduler test' });
  }
});

// GET version za lakše testiranje u browseru
router.get('/test-scheduler', async (req, res) => {
  try {
    console.log('=== MANUAL SCHEDULER TEST via GET ===');
    await testScheduler();
    res.json({ 
      message: 'Scheduler test completed - check console logs',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error running scheduler test:', error);
    res.status(500).json({ error: 'Error running scheduler test', details: error.message });
  }
});

// DEBUG - Check completion time data
router.get('/debug/completion-time', async (req, res) => {
  try {
    // Find all work orders with prvoMenjanjeStatusa
    const workOrders = await WorkOrder.find({
      prvoMenjanjeStatusa: { $exists: true, $ne: null }
    })
    .populate('technicianId', 'name')
    .select('_id prvoMenjanjeStatusa date time technicianId address status')
    .lean();

    console.log('Found work orders with prvoMenjanjeStatusa:', workOrders.length);
    
    const result = {
      totalFound: workOrders.length,
      workOrders: workOrders.map(wo => ({
        _id: wo._id,
        prvoMenjanjeStatusa: wo.prvoMenjanjeStatusa,
        date: wo.date,
        time: wo.time,
        technicianName: wo.technicianId?.name || 'No technician',
        address: wo.address,
        status: wo.status
      }))
    };

    res.json(result);
  } catch (error) {
    console.error('Debug completion time error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DEBUG - Check overdue work orders status
router.get('/debug/overdue-status', async (req, res) => {
  try {
    const currentTime = new Date();
    const oneHourAgo = new Date(currentTime.getTime() - (60 * 60 * 1000));
    
    // Find all incomplete work orders with appointment time
    const incompleteOrders = await WorkOrder.find({
      status: 'nezavrsen'
    }).select('_id address appointmentDateTime isOverdue overdueMarkedAt technicianId').populate('technicianId', 'name');
    
    const result = {
      currentTime: currentTime.toISOString(),
      oneHourAgo: oneHourAgo.toISOString(),
      totalIncompleteOrders: incompleteOrders.length,
      orders: incompleteOrders.map(order => ({
        _id: order._id,
        address: order.address,
        appointmentDateTime: order.appointmentDateTime,
        isOverdue: order.isOverdue,
        overdueMarkedAt: order.overdueMarkedAt,
        technician: order.technicianId?.name || 'No technician assigned',
        shouldBeOverdue: order.appointmentDateTime && order.appointmentDateTime <= oneHourAgo,
        hoursOverdue: order.appointmentDateTime ? 
          Math.max(0, (currentTime.getTime() - order.appointmentDateTime.getTime()) / (60 * 60 * 1000)) : 0
      }))
    };
    
    res.json(result);
  } catch (error) {
    console.error('Error checking overdue status:', error);
    res.status(500).json({ error: 'Error checking overdue status' });
  }
});

// POST - AI analiza radnog naloga (samo analiza, bez automatske verifikacije)
router.post('/:id/ai-verify', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    console.log('=== AI VERIFICATION REQUEST ===');
    console.log('Work Order ID:', id);

    // Proveri da li radni nalog postoji i ima status 'zavrsen'
    const workOrder = await WorkOrder.findById(id);
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }

    if (workOrder.status !== 'zavrsen') {
      return res.status(400).json({
        error: 'Radni nalog mora biti u statusu "zavrsen" da bi se analizirao'
      });
    }

    if (workOrder.verified) {
      return res.status(400).json({
        error: 'Radni nalog je već verifikovan'
      });
    }

    // Pozovi AI servis za analizu
    const { verifyWorkOrderWithAI } = require('../services/aiVerificationService');
    const aiResult = await verifyWorkOrderWithAI(id);

    console.log('=== AI ANALYSIS RESULT ===');
    console.log('Verified:', aiResult.verified);
    console.log('Customer Status:', aiResult.customerStatus);
    console.log('Reason:', aiResult.reason);

    // SAMO VRATI REZULTAT - NE MENJAJ NIŠTA U BAZI
    return res.json({
      success: true,
      verified: aiResult.verified,
      customerStatus: aiResult.customerStatus,
      reason: aiResult.reason,
      checkedItems: aiResult.checkedItems,
      confidence: aiResult.confidence,
      workOrderId: id
    });

  } catch (error) {
    console.error('Greška pri AI analizi radnog naloga:', error);
    res.status(500).json({
      error: 'Greška pri AI analizi radnog naloga',
      details: error.message
    });
  }
});

// ============================================================================
// EDIT PAGE ROUTES - For admin/superadmin/supervisor to edit work orders
// ============================================================================

// POST - Add equipment to work order via Edit page
router.post('/:id/edit/add-equipment', auth, logActivity('edit', 'edit_equipment_add', {
  getEntityId: (req) => req.params.id,
  getEntityName: (req, responseData) => responseData?.workOrder?.tisJobId || 'WorkOrder'
}), async (req, res) => {
  try {
    const { id } = req.params;
    const { equipmentId, technicianId, addedBy, addedByRole } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID radnog naloga' });
    }

    if (!equipmentId || !technicianId) {
      return res.status(400).json({ error: 'Nedostaju obavezni podaci (equipmentId, technicianId)' });
    }

    // Verify user has admin privileges
    if (!['admin', 'superadmin', 'supervisor'].includes(addedByRole)) {
      return res.status(403).json({ error: 'Nemate dozvolu za ovu akciju' });
    }

    const workOrder = await WorkOrder.findById(id);
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }

    // Verify technician is assigned to this work order
    const tech1Id = workOrder.technicianId?._id || workOrder.technicianId;
    const tech2Id = workOrder.technician2Id?._id || workOrder.technician2Id;

    if (tech1Id?.toString() !== technicianId && tech2Id?.toString() !== technicianId) {
      return res.status(400).json({
        error: 'Tehničar nije dodeljen ovom radnom nalogu'
      });
    }

    // Verify equipment exists and belongs to the technician
    const equipment = await Equipment.findById(equipmentId);
    if (!equipment) {
      return res.status(404).json({ error: 'Oprema nije pronađena' });
    }

    const expectedLocation = `tehnicar-${technicianId}`;
    if (equipment.location !== expectedLocation) {
      return res.status(400).json({
        error: 'Oprema ne pripada odabranom tehničaru'
      });
    }

    // Get user ID for assigning equipment
    const userId = workOrder.user?._id || workOrder.user || workOrder.tisId;

    // Update equipment
    equipment.assignedToUser = userId;
    equipment.location = `user-${userId}`;
    equipment.status = 'installed';
    equipment.installedAt = new Date();
    await equipment.save();

    // Update work order with installed equipment
    if (!workOrder.installedEquipment) {
      workOrder.installedEquipment = [];
    }

    workOrder.installedEquipment.push({
      equipmentId: equipment._id,
      installedAt: new Date(),
      technicianId,
      addedViaEdit: true, // Mark as added via Edit page
      addedBy
    });

    if (!workOrder.equipment) {
      workOrder.equipment = [];
    }

    const equipmentExists = workOrder.equipment.some(eq => eq.toString() === equipment._id.toString());
    if (!equipmentExists) {
      workOrder.equipment.push(equipment._id);
    }

    await workOrder.save();

    // Update WorkOrderEvidence if exists
    try {
      const evidence = await WorkOrderEvidence.findOne({ workOrderId: id });
      if (evidence) {
        const mappedEquipmentType = equipment.category || 'ONT/HFC';

        const equipmentData = {
          equipmentType: mappedEquipmentType,
          serialNumber: equipment.serialNumber || '',
          condition: equipment.status === 'defective' ? 'R' : 'N',
          installedAt: new Date(),
          notes: `Dodato preko Edit stranice od ${addedByRole} - ${equipment.description || ''}`
        };

        // Remove from removedEquipment if exists
        evidence.removedEquipment = evidence.removedEquipment.filter(
          removedEq => removedEq.serialNumber !== equipmentData.serialNumber
        );

        // Remove duplicates from installedEquipment
        evidence.installedEquipment = evidence.installedEquipment.filter(
          installedEq => installedEq.serialNumber !== equipmentData.serialNumber
        );

        evidence.installedEquipment.push(equipmentData);
        await evidence.save();
      }
    } catch (evidenceError) {
      console.error('Greška pri ažuriranju WorkOrderEvidence:', evidenceError);
    }

    // Log equipment addition
    try {
      const technician = await Technician.findById(technicianId);
      if (technician) {
        await logEquipmentAdded(technicianId, technician.name, workOrder, equipment);
      }
    } catch (logError) {
      console.error('Greška pri logovanju dodavanja opreme:', logError);
    }

    res.json({
      message: 'Oprema uspešno dodata',
      workOrder,
      equipment
    });

  } catch (error) {
    console.error('Greška pri dodavanju opreme:', error);
    res.status(500).json({ error: 'Greška pri dodavanju opreme' });
  }
});

// POST - Add materials to work order via Edit page
router.post('/:id/edit/add-materials', auth, logActivity('edit', 'edit_material_add', {
  getEntityId: (req) => req.params.id,
  getEntityName: (req, responseData) => responseData?.workOrder?.tisJobId || 'WorkOrder'
}), async (req, res) => {
  try {
    const { id } = req.params;
    const { materials, technicianId, addedBy, addedByRole } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID radnog naloga' });
    }

    if (!Array.isArray(materials) || materials.length === 0) {
      return res.status(400).json({ error: 'Potrebno je dostaviti niz materijala' });
    }

    if (!technicianId) {
      return res.status(400).json({ error: 'Nedostaje ID tehničara' });
    }

    // Verify user has admin privileges
    if (!['admin', 'superadmin', 'supervisor'].includes(addedByRole)) {
      return res.status(403).json({ error: 'Nemate dozvolu za ovu akciju' });
    }

    // Validate materials
    for (const material of materials) {
      if (!material.material || !mongoose.Types.ObjectId.isValid(material.material)) {
        return res.status(400).json({ error: 'Neispravan ID materijala' });
      }
      if (!material.quantity || material.quantity <= 0) {
        return res.status(400).json({ error: 'Količina mora biti veća od 0' });
      }
    }

    const workOrder = await WorkOrder.findById(id);
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }

    // Verify technician is assigned to this work order
    const tech1Id = workOrder.technicianId?._id || workOrder.technicianId;
    const tech2Id = workOrder.technician2Id?._id || workOrder.technician2Id;

    if (tech1Id?.toString() !== technicianId && tech2Id?.toString() !== technicianId) {
      return res.status(400).json({
        error: 'Tehničar nije dodeljen ovom radnom nalogu'
      });
    }

    const technician = await Technician.findById(technicianId);
    if (!technician) {
      return res.status(404).json({ error: 'Tehničar nije pronađen' });
    }

    // Store old materials for comparison
    const oldMaterials = workOrder.materials || [];

    // Check if technician has sufficient materials and update inventory
    for (const materialItem of materials) {
      const existingOldMaterial = oldMaterials.find(
        old => old.material.toString() === materialItem.material.toString()
      );

      const newQuantity = materialItem.quantity;
      const oldQuantity = existingOldMaterial ? existingOldMaterial.quantity : 0;
      const quantityDiff = newQuantity - oldQuantity;

      if (quantityDiff > 0) {
        // Adding material - deduct from technician's inventory
        const techMaterialIndex = technician.materials.findIndex(
          tm => tm.materialId.toString() === materialItem.material.toString()
        );

        if (techMaterialIndex === -1) {
          return res.status(400).json({
            error: `Tehničar nema materijal u svom inventaru`
          });
        }

        const techMaterial = technician.materials[techMaterialIndex];
        if (techMaterial.quantity < quantityDiff) {
          const materialDoc = await Material.findById(materialItem.material);
          return res.status(400).json({
            error: `Tehničar nema dovoljno materijala ${materialDoc ? materialDoc.type : ''}. Dostupno: ${techMaterial.quantity}, potrebno: ${quantityDiff}`
          });
        }

        // Deduct from technician's inventory
        techMaterial.quantity -= quantityDiff;
        if (techMaterial.quantity === 0) {
          technician.materials.splice(techMaterialIndex, 1);
        }
      }
    }

    await technician.save();

    // Update work order materials
    workOrder.materials = materials;
    await workOrder.save();

    // Log material additions
    for (const newMaterial of materials) {
      const existingMaterial = oldMaterials.find(
        old => old.material.toString() === newMaterial.material.toString()
      );

      const newQuantity = newMaterial.quantity;
      const oldQuantity = existingMaterial ? existingMaterial.quantity : 0;

      if (newQuantity > oldQuantity) {
        const materialDoc = await Material.findById(newMaterial.material);
        if (materialDoc) {
          const log = await logMaterialAdded(
            technicianId,
            technician.name,
            workOrder,
            materialDoc,
            newQuantity - oldQuantity
          );

          if (log) {
            await checkMaterialAnomaly(
              technicianId,
              technician.name,
              workOrder,
              materialDoc,
              newQuantity - oldQuantity,
              log._id
            );
          }
        }
      }
    }

    res.json({
      message: 'Materijal uspešno dodat',
      workOrder
    });

  } catch (error) {
    console.error('Greška pri dodavanju materijala:', error);
    res.status(500).json({ error: 'Greška pri dodavanju materijala' });
  }
});

// GET - Get removed equipment for work order
router.get('/:id/removed-equipment', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID radnog naloga' });
    }

    // Find removed equipment from WorkOrderEvidence
    const evidence = await WorkOrderEvidence.findOne({ workOrderId: id });
    const removedEquipment = evidence?.removedEquipment || [];

    res.json(removedEquipment);
  } catch (error) {
    console.error('Greška pri dohvatanju uklonjene opreme:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju uklonjene opreme' });
  }
});

// ============================================================================
// VOICE RECORDINGS ENDPOINTS
// ============================================================================

// Helper funkcija za normalizaciju broja telefona
const normalizePhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return null;

  // Ukloni sve ne-numeričke karaktere (razmake, crtice, zagrade, +)
  let cleaned = phoneNumber.toString().replace(/[\s\-\(\)\+\.]/g, '').replace(/\D/g, '');

  console.log(`[normalizePhoneNumber] Input: "${phoneNumber}" -> Cleaned: "${cleaned}"`);

  // Ako počinje sa 381 (međunarodni format bez +), zameni sa 0
  if (cleaned.startsWith('381') && cleaned.length >= 12) {
    cleaned = '0' + cleaned.substring(3);
    console.log(`[normalizePhoneNumber] Converted from 381 format: "${cleaned}"`);
  }

  // Ako nema vodeću nulu a trebalo bi (npr. "603721085" umesto "0603721085")
  if (cleaned.length === 9 && !cleaned.startsWith('0')) {
    cleaned = '0' + cleaned;
    console.log(`[normalizePhoneNumber] Added leading zero: "${cleaned}"`);
  }

  console.log(`[normalizePhoneNumber] Final result: "${cleaned}"`);
  return cleaned;
};

// Uporedi dva broja telefona - vraća true ako se poklapaju
const phoneNumbersMatch = (phone1, phone2) => {
  if (!phone1 || !phone2) return false;

  const n1 = normalizePhoneNumber(phone1);
  const n2 = normalizePhoneNumber(phone2);

  if (n1 === n2) return true;

  // Ako se ne poklapaju direktno, probaj dodatne varijacije
  // Neki brojevi mogu biti sačuvani kao "60 123 456" a drugi kao "+38160123456"

  // Ukloni sve osim cifara za oba
  const digits1 = phone1.toString().replace(/\D/g, '');
  const digits2 = phone2.toString().replace(/\D/g, '');

  // Proveri da li se završavaju istim ciframa (ignoriši prefix)
  const minLen = Math.min(digits1.length, digits2.length);
  if (minLen >= 8) {
    const suffix1 = digits1.slice(-minLen);
    const suffix2 = digits2.slice(-minLen);
    if (suffix1 === suffix2) {
      console.log(`[phoneNumbersMatch] Matched by suffix: ${suffix1}`);
      return true;
    }
  }

  return false;
};

// Helper funkcija za pronalaženje tehničara po broju telefona
const findTechnicianByPhone = async (phoneNumber) => {
  const normalized = normalizePhoneNumber(phoneNumber);
  if (!normalized) return null;

  // Pokušaj direktno
  let technician = await Technician.findOne({ phoneNumber: normalized });
  if (technician) return technician;

  // Pokušaj sa +381 prefiksom
  const withPrefix = '+381' + normalized.substring(1);
  technician = await Technician.findOne({ phoneNumber: withPrefix });
  if (technician) return technician;

  // Pokušaj sa 381 prefiksom
  const with381 = '381' + normalized.substring(1);
  technician = await Technician.findOne({ phoneNumber: with381 });

  return technician;
};

// Helper funkcija za pronalaženje najbližeg radnog naloga
const findMatchingWorkOrder = async (technicianId, customerPhone, recordedAt) => {
  console.log('=== FINDING MATCHING WORK ORDER ===');
  console.log('Input - Technician ID:', technicianId);
  console.log('Input - Customer Phone:', customerPhone);
  console.log('Input - Recorded At:', recordedAt);

  const normalizedCustomerPhone = normalizePhoneNumber(customerPhone);
  console.log('Normalized customer phone:', normalizedCustomerPhone);

  if (!normalizedCustomerPhone) {
    console.log('❌ Could not normalize customer phone');
    return null;
  }

  // Traži radne naloge tehničara u periodu ±2 dana od poziva
  const twoDaysBefore = new Date(recordedAt);
  twoDaysBefore.setDate(twoDaysBefore.getDate() - 2);

  const twoDaysAfter = new Date(recordedAt);
  twoDaysAfter.setDate(twoDaysAfter.getDate() + 2);

  console.log('Date range:', twoDaysBefore.toISOString(), 'to', twoDaysAfter.toISOString());

  // Pronađi sve radne naloge u tom periodu
  const workOrders = await WorkOrder.find({
    $or: [
      { technicianId: technicianId },
      { technician2Id: technicianId }
    ],
    date: {
      $gte: twoDaysBefore,
      $lte: twoDaysAfter
    }
  }).sort({ date: 1 });

  console.log('Found', workOrders.length, 'work orders for technician in date range');

  // Filtriraj one koji imaju matching customer phone
  const matchingOrders = workOrders.filter(wo => {
    const isMatch = phoneNumbersMatch(wo.userPhone, customerPhone);
    console.log(`  WO ${wo._id}: userPhone="${wo.userPhone}" vs customerPhone="${customerPhone}" | Match: ${isMatch}`);
    return isMatch;
  });

  console.log('Matching orders count:', matchingOrders.length);

  if (matchingOrders.length === 0) {
    console.log('❌ No matching work orders found');
    return null;
  }

  // Ako ima više, uzmi najbližeg po vremenu
  let closest = matchingOrders[0];
  let minDiff = Math.abs(new Date(closest.date) - new Date(recordedAt));

  for (const wo of matchingOrders) {
    const diff = Math.abs(new Date(wo.date) - new Date(recordedAt));
    if (diff < minDiff) {
      minDiff = diff;
      closest = wo;
    }
  }

  console.log('✅ Found closest matching work order:', closest._id);
  return closest;
};

// Multer konfiguracija za voice recordings (memory storage)
const voiceStorage = multer.memoryStorage();
const voiceUpload = multer({
  storage: voiceStorage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Prihvati samo audio fajlove
    const allowedMimes = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/3gpp'];
    if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(mp3|m4a|wav|ogg|webm|3gp|aac)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Nepodržan format audio fajla. Podržani formati: MP3, M4A, WAV, OGG, WebM, 3GP, AAC'));
    }
  }
});

// POST /api/workorders/voice-recordings/upload
// Upload voice recording sa automatskim povezivanjem na radni nalog
router.post('/voice-recordings/upload', auth, voiceUpload.single('audio'), async (req, res) => {
  try {
    console.log('=== VOICE RECORDING UPLOAD REQUEST ===');
    console.log('Body:', req.body);
    console.log('File:', req.file ? { name: req.file.originalname, size: req.file.size, mime: req.file.mimetype } : 'No file');

    if (!req.file) {
      return res.status(400).json({ error: 'Audio fajl nije pronađen' });
    }

    const { phoneNumber, recordedAt, duration } = req.body;

    if (!phoneNumber || !recordedAt) {
      return res.status(400).json({ error: 'Nedostaju obavezni parametri: phoneNumber, recordedAt' });
    }

    // Normalizuj broj telefona iz naziva fajla (format: +3816389927)
    const callerPhone = normalizePhoneNumber(phoneNumber);
    console.log('Normalized caller phone:', callerPhone);

    // Pronađi tehničara po broju telefona
    const technician = await findTechnicianByPhone(callerPhone);
    if (!technician) {
      return res.status(404).json({
        error: 'Tehničar sa ovim brojem telefona nije pronađen',
        phoneNumber: callerPhone
      });
    }

    console.log('Found technician:', technician.name);

    // Izvuci customer phone iz imena fajla ili body-ja
    // Format fajla: +3816389927_20231106_143022.m4a
    const filenameParts = req.file.originalname.split('_');
    let customerPhone = req.body.customerPhone;

    if (!customerPhone && filenameParts.length > 0) {
      customerPhone = filenameParts[0]; // Prvi deo je broj telefona
    }

    if (!customerPhone) {
      return res.status(400).json({ error: 'Broj korisnika (customerPhone) nije pronađen' });
    }

    const normalizedCustomerPhone = normalizePhoneNumber(customerPhone);
    console.log('Normalized customer phone:', normalizedCustomerPhone);

    // Pronađi matching radni nalog
    const workOrder = await findMatchingWorkOrder(
      technician._id,
      normalizedCustomerPhone,
      new Date(recordedAt)
    );

    if (!workOrder) {
      return res.status(404).json({
        error: 'Nije pronađen radni nalog koji odgovara ovom pozivu',
        technicianName: technician.name,
        customerPhone: normalizedCustomerPhone,
        recordedAt: recordedAt
      });
    }

    console.log('Found matching work order:', workOrder._id);

    // DUPLIKAT CHECK - proveri da li fajl sa istim imenom već postoji
    const originalFileName = req.body.originalFileName || req.file.originalname;
    const fileUniqueId = req.body.fileUniqueId;

    const existingRecording = workOrder.voiceRecordings.find(r => {
      // Proveri po fileUniqueId ako postoji
      if (fileUniqueId && r.fileUniqueId === fileUniqueId) {
        return true;
      }
      // Ili po originalnom imenu fajla
      if (r.originalFileName === originalFileName || r.fileName === originalFileName) {
        return true;
      }
      return false;
    });

    if (existingRecording) {
      console.log('❌ Duplicate recording found:', originalFileName);
      return res.status(409).json({
        error: 'Ovaj snimak već postoji u radnom nalogu',
        fileName: originalFileName,
        existingRecordingId: existingRecording._id
      });
    }

    // Upload na Cloudinary sa kompresijom
    const cloudinaryResult = await uploadVoiceRecording(
      req.file.buffer,
      workOrder._id,
      normalizedCustomerPhone
    );

    // Dodaj voice recording u radni nalog
    const voiceRecording = {
      url: cloudinaryResult.secure_url,
      fileName: req.file.originalname,
      originalFileName: originalFileName,
      fileUniqueId: fileUniqueId || null,
      phoneNumber: normalizedCustomerPhone,
      duration: duration ? parseInt(duration) : null,
      recordedAt: new Date(recordedAt),
      uploadedBy: req.technician._id,
      fileSize: req.file.size
    };

    workOrder.voiceRecordings.push(voiceRecording);
    await workOrder.save();

    console.log('Voice recording added to work order successfully');

    res.json({
      success: true,
      message: 'Voice recording uspešno uploadovan i povezan sa radnim nalogom',
      workOrderId: workOrder._id,
      voiceRecording: voiceRecording
    });

  } catch (error) {
    console.error('Greška pri upload-u voice recording-a:', error);
    res.status(500).json({
      error: 'Greška pri upload-u voice recording-a',
      details: error.message
    });
  }
});

// DELETE /api/workorders/:id/voice-recordings/:recordingId
// Brisanje voice recording-a iz radnog naloga
router.delete('/:id/voice-recordings/:recordingId', auth, async (req, res) => {
  try {
    const { id, recordingId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID radnog naloga' });
    }

    const workOrder = await WorkOrder.findById(id);
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }

    // Pronađi recording
    const recording = workOrder.voiceRecordings.id(recordingId);
    if (!recording) {
      return res.status(404).json({ error: 'Voice recording nije pronađen' });
    }

    // Izvuci public_id iz URL-a
    const urlParts = recording.url.split('/');
    const publicIdWithExt = urlParts[urlParts.length - 1];
    const publicId = 'voice-recordings/' + publicIdWithExt.split('.')[0];

    // Obriši sa Cloudinary
    await deleteVoiceRecording(publicId);

    // Ukloni iz array-a
    workOrder.voiceRecordings.pull(recordingId);
    await workOrder.save();

    res.json({
      success: true,
      message: 'Voice recording uspešno obrisan'
    });

  } catch (error) {
    console.error('Greška pri brisanju voice recording-a:', error);
    res.status(500).json({
      error: 'Greška pri brisanju voice recording-a',
      details: error.message
    });
  }
});

// ============================================================================

// POST /api/workorders/voice-recordings/trigger-sync
// Šalje push notifikaciju svim tehničarima da sinhronizuju snimke poziva
// Samo za superadmin i supervisor
router.post('/voice-recordings/trigger-sync', auth, async (req, res) => {
  try {
    console.log('=== TRIGGER SYNC RECORDINGS ===');
    console.log('Request received at:', new Date().toISOString());

    // Debug: proveri req.user (auth middleware postavlja req.user, NE req.technician)
    if (!req.user) {
      console.error('ERROR: req.user is undefined');
      return res.status(401).json({
        error: 'Autentifikacija nije uspela - korisnik nije pronađen'
      });
    }

    console.log('User info:', {
      id: req.user._id,
      name: req.user.name,
      role: req.user.role
    });

    // Proveri da li je korisnik superadmin ili supervisor
    if (!['superadmin', 'supervisor'].includes(req.user.role)) {
      console.log('ACCESS DENIED - role:', req.user.role);
      return res.status(403).json({
        error: 'Nemate dozvolu za ovu akciju. Potrebna je superadmin ili supervisor uloga.'
      });
    }

    console.log('Loading androidNotificationService...');
    let androidNotificationService;
    try {
      androidNotificationService = require('../services/androidNotificationService');
      console.log('Service loaded successfully');
    } catch (requireError) {
      console.error('ERROR loading androidNotificationService:', requireError);
      return res.status(500).json({
        error: 'Greška pri učitavanju notification servisa',
        details: requireError.message,
        stack: requireError.stack
      });
    }

    console.log('Calling sendSyncRecordingsNotificationToAll...');
    const result = await androidNotificationService.sendSyncRecordingsNotificationToAll();
    console.log('Service result:', JSON.stringify(result, null, 2));

    if (result.success) {
      res.json({
        success: true,
        message: `Sync notifikacija poslata ${result.successCount} tehničarima`,
        totalTechnicians: result.totalTechnicians,
        successCount: result.successCount,
        failCount: result.failCount
      });
    } else {
      console.error('Service returned error:', result.error);
      res.status(500).json({
        success: false,
        error: result.error || 'Nepoznata greška u servisu'
      });
    }

  } catch (error) {
    console.error('=== TRIGGER SYNC ERROR ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Full error:', error);

    res.status(500).json({
      error: 'Greška pri slanju sync notifikacije',
      details: error.message,
      errorName: error.name,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
});

// ============================================================================

// Eksportuj funkciju za korišćenje u drugim rutama
module.exports = router;
module.exports.createFinancialTransaction = createFinancialTransaction;