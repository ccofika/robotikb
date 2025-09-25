const express = require('express');
const router = express.Router();
const FinancialSettings = require('../models/FinancialSettings');
const FinancialTransaction = require('../models/FinancialTransaction');
const FailedFinancialTransaction = require('../models/FailedFinancialTransaction');
const MunicipalityDiscountConfirmation = require('../models/MunicipalityDiscountConfirmation');
const WorkOrder = require('../models/WorkOrder');
const WorkOrderEvidence = require('../models/WorkOrderEvidence');
const Technician = require('../models/Technician');
const { auth, isSuperAdmin } = require('../middleware/auth');

// GET /api/finances/settings - Dobijanje finansijskih postavki
router.get('/settings', auth, isSuperAdmin, async (req, res) => {
  try {
    let settings = await FinancialSettings.findOne();

    if (!settings) {
      // Kreiranje default postavki ako ne postoje
      settings = new FinancialSettings({
        pricesByCustomerStatus: {},
        discountsByMunicipality: [],
        technicianPrices: []
      });
      await settings.save();
    }

    res.json(settings);
  } catch (error) {
    console.error('Greška pri dobijanju finansijskih postavki:', error);
    res.status(500).json({ error: 'Greška pri dobijanju finansijskih postavki' });
  }
});

// POST /api/finances/settings - Čuvanje finansijskih postavki
router.post('/settings', auth, isSuperAdmin, async (req, res) => {
  try {
    const { pricesByCustomerStatus, discountsByMunicipality, technicianPrices } = req.body;

    let settings = await FinancialSettings.findOne();

    if (!settings) {
      settings = new FinancialSettings();
    }

    // Ažuriranje postavki
    if (pricesByCustomerStatus) {
      settings.pricesByCustomerStatus = { ...settings.pricesByCustomerStatus, ...pricesByCustomerStatus };
    }

    if (discountsByMunicipality) {
      settings.discountsByMunicipality = discountsByMunicipality;
    }

    if (technicianPrices) {
      settings.technicianPrices = technicianPrices;
    }

    await settings.save();

    res.json({
      message: 'Finansijske postavke su uspešno sačuvane',
      settings
    });
  } catch (error) {
    console.error('Greška pri čuvanju finansijskih postavki:', error);
    res.status(500).json({ error: 'Greška pri čuvanju finansijskih postavki' });
  }
});

// GET /api/finances/municipalities - Lista svih opština iz WorkOrder tabele
router.get('/municipalities', auth, isSuperAdmin, async (req, res) => {
  try {
    const municipalities = await WorkOrder.distinct('municipality');
    res.json(municipalities.filter(m => m && m.trim() !== '').sort());
  } catch (error) {
    console.error('Greška pri dobijanju opština:', error);
    res.status(500).json({ error: 'Greška pri dobijanju opština' });
  }
});

// GET /api/finances/customer-status-options - Lista customerStatus opcija
router.get('/customer-status-options', auth, isSuperAdmin, async (req, res) => {
  try {
    const options = [
      'Priključenje korisnika na HFC KDS mreža u zgradi sa instalacijom CPE opreme (izrada kompletne instalacije od RO do korisnika sa instalacijom kompletne CPE opreme)',
      'Priključenje korisnika na HFC KDS mreža u privatnim kućama sa instalacijom CPE opreme (izrada instalacije od PM-a do korisnika sa instalacijom kompletne CPE opreme)',
      'Priključenje korisnika na GPON mrežu u privatnim kućama (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)',
      'Priključenje korisnika na GPON mrežu u zgradi (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)',
      'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji sa montažnim radovima',
      'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji bez montažnih radova',
      'Nov korisnik'
    ];

    // Kratki nazivi za UI
    const shortNames = {
      'Priključenje korisnika na HFC KDS mreža u zgradi sa instalacijom CPE opreme (izrada kompletne instalacije od RO do korisnika sa instalacijom kompletne CPE opreme)': 'HFC Zgrada',
      'Priključenje korisnika na HFC KDS mreža u privatnim kućama sa instalacijom CPE opreme (izrada instalacije od PM-a do korisnika sa instalacijom kompletne CPE opreme)': 'HFC Kuća',
      'Priključenje korisnika na GPON mrežu u privatnim kućama (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)': 'GPON Kuća',
      'Priključenje korisnika na GPON mrežu u zgradi (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)': 'GPON Zgrada',
      'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji sa montažnim radovima': 'Sa Montažom',
      'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji bez montažnih radova': 'Bez Montaže',
      'Nov korisnik': 'Nov Korisnik'
    };

    const formattedOptions = options.map(option => ({
      value: option,
      label: shortNames[option] || option,
      fullText: option
    }));

    res.json(formattedOptions);
  } catch (error) {
    console.error('Greška pri dobijanju customerStatus opcija:', error);
    res.status(500).json({ error: 'Greška pri dobijanju customerStatus opcija' });
  }
});

// GET /api/finances/technicians - Lista svih tehničara
router.get('/technicians', auth, isSuperAdmin, async (req, res) => {
  try {
    const allTechnicians = await Technician.find({})
      .select('_id name role isAdmin')
      .sort({ name: 1 });

    // Traži tehničare koji nisu admin ili superadmin
    const technicians = allTechnicians.filter(tech =>
      tech.role !== 'admin' &&
      tech.role !== 'superadmin' &&
      !tech.isAdmin
    );

    // Vrati samo potrebna polja za frontend
    const result = technicians.map(tech => ({
      _id: tech._id,
      name: tech.name
    }));

    res.json(result);
  } catch (error) {
    console.error('Greška pri dobijanju tehničara:', error);
    res.status(500).json({ error: 'Greška pri dobijanju tehničara' });
  }
});

// GET /api/finances/reports - Finansijski izveštaj
router.get('/reports', auth, isSuperAdmin, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    let filter = {};

    if (dateFrom && dateTo) {
      filter.verifiedAt = {
        $gte: new Date(dateFrom),
        $lte: new Date(dateTo + 'T23:59:59.999Z')
      };
    }

    const transactions = await FinancialTransaction.find(filter)
      .populate('technicians.technicianId', 'name')
      .populate('workOrderId', 'tisJobId date')
      .sort({ verifiedAt: -1 });

    // Ukupne sume
    const totalRevenue = transactions.reduce((sum, t) => sum + t.finalPrice, 0);
    const totalPayouts = transactions.reduce((sum, t) => sum + t.totalTechnicianEarnings, 0);
    const totalProfit = transactions.reduce((sum, t) => sum + t.companyProfit, 0);

    // Grupa po tehničarima
    const technicianStats = {};
    transactions.forEach(transaction => {
      transaction.technicians.forEach(tech => {
        if (!technicianStats[tech.technicianId._id]) {
          technicianStats[tech.technicianId._id] = {
            technicianId: tech.technicianId._id,
            name: tech.name,
            totalEarnings: 0,
            workOrdersCount: 0
          };
        }
        technicianStats[tech.technicianId._id].totalEarnings += tech.earnings;
        technicianStats[tech.technicianId._id].workOrdersCount += 1;
      });
    });

    res.json({
      summary: {
        totalRevenue,
        totalPayouts,
        totalProfit,
        transactionsCount: transactions.length
      },
      technicianStats: Object.values(technicianStats),
      transactions
    });

  } catch (error) {
    console.error('Greška pri generisanju finansijskog izveštaja:', error);
    res.status(500).json({ error: 'Greška pri generisanju finansijskog izveštaja' });
  }
});

// GET /api/finances/failed-transactions - Lista neuspešnih finansijskih obračuna
router.get('/failed-transactions', auth, isSuperAdmin, async (req, res) => {
  try {
    const failedTransactions = await FailedFinancialTransaction.find({ resolved: false })
      .populate('workOrderId', 'tisJobId address municipality status verified date')
      .sort({ createdAt: -1 });

    res.json(failedTransactions);
  } catch (error) {
    console.error('Greška pri dobijanju neuspešnih finansijskih transakcija:', error);
    res.status(500).json({ error: 'Greška pri dobijanju neuspešnih finansijskih transakcija' });
  }
});

// POST /api/finances/retry-failed-transaction - Ponovi obračun za neuspešnu transakciju
router.post('/retry-failed-transaction/:workOrderId', auth, isSuperAdmin, async (req, res) => {
  try {
    const { workOrderId } = req.params;

    // Importuj funkciju za kreiranje finansijske transakcije
    // Ova funkcija će biti dostupna iz workorders rute
    const { createFinancialTransaction } = require('./workorders');

    // Pokušaj ponovo da kreiraš finansijsku transakciju
    await createFinancialTransaction(workOrderId);

    // Proveri da li je transakcija uspešno kreirana
    const successfulTransaction = await FinancialTransaction.findOne({ workOrderId });
    const failedTransaction = await FailedFinancialTransaction.findOne({ workOrderId });

    if (successfulTransaction) {
      res.json({
        success: true,
        message: 'Finansijska transakcija je uspešno kreirana',
        transaction: successfulTransaction
      });
    } else if (failedTransaction) {
      res.json({
        success: false,
        message: 'Obračun i dalje nije moguć',
        failureReason: failedTransaction.failureMessage,
        missingFields: failedTransaction.missingFields
      });
    } else {
      res.json({
        success: false,
        message: 'Nepoznata greška pri ponovnom obračunu'
      });
    }

  } catch (error) {
    console.error('Greška pri ponovnom obračunu:', error);
    res.status(500).json({ error: 'Greška pri ponovnom obračunu finansijske transakcije' });
  }
});

// DELETE /api/finances/failed-transaction/:workOrderId - Označiti kao razrešeno
router.delete('/failed-transaction/:workOrderId', auth, isSuperAdmin, async (req, res) => {
  try {
    const { workOrderId } = req.params;

    const failedTransaction = await FailedFinancialTransaction.findOne({ workOrderId });
    if (!failedTransaction) {
      return res.status(404).json({ error: 'Neuspešna transakcija nije pronađena' });
    }

    failedTransaction.resolved = true;
    failedTransaction.resolvedAt = new Date();
    await failedTransaction.save();

    res.json({
      message: 'Neuspešna transakcija je označena kao razrešena'
    });

  } catch (error) {
    console.error('Greška pri označavanju kao razrešeno:', error);
    res.status(500).json({ error: 'Greška pri označavanju transakcije kao razrešena' });
  }
});

// POST /api/finances/confirm-discount - Potvrdi popust za opštinu
router.post('/confirm-discount', auth, isSuperAdmin, async (req, res) => {
  try {
    const { municipality, discountPercent, workOrderIds } = req.body;

    // Kreiraj ili ažuriraj potvrdu popusta
    const confirmation = await MunicipalityDiscountConfirmation.findOneAndUpdate(
      { municipality },
      {
        municipality,
        discountPercent: parseFloat(discountPercent) || 0,
        confirmedByAdmin: true,
        confirmedAt: new Date(),
        confirmedBy: req.user.name || 'SuperAdmin'
      },
      { upsert: true, new: true }
    );

    // Pokušaj ponovni obračun za sve radne naloge koji čekaju ovu potvrdu
    const { createFinancialTransaction } = require('./workorders');
    const retryResults = [];

    if (workOrderIds && workOrderIds.length > 0) {
      for (const workOrderId of workOrderIds) {
        try {
          await createFinancialTransaction(workOrderId);
          retryResults.push({ workOrderId, success: true });
        } catch (error) {
          console.error(`Retry failed for work order ${workOrderId}:`, error);
          retryResults.push({ workOrderId, success: false, error: error.message });
        }
      }
    }

    res.json({
      message: `Popust od ${discountPercent}% za opštinu "${municipality}" je potvrđen`,
      confirmation,
      retryResults
    });

  } catch (error) {
    console.error('Greška pri potvrdi popusta:', error);
    res.status(500).json({ error: 'Greška pri potvrdi popusta' });
  }
});

module.exports = router;