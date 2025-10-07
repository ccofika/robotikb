const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const FinancialSettings = require('../models/FinancialSettings');
const FinancialTransaction = require('../models/FinancialTransaction');
const FailedFinancialTransaction = require('../models/FailedFinancialTransaction');
const MunicipalityDiscountConfirmation = require('../models/MunicipalityDiscountConfirmation');
const WorkOrder = require('../models/WorkOrder');
const WorkOrderEvidence = require('../models/WorkOrderEvidence');
const Technician = require('../models/Technician');
const { auth, isSuperAdmin } = require('../middleware/auth');

// Cache for financial reports
let financialReportsCache = new Map();
const FINANCIAL_REPORTS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Function to invalidate financial reports cache
const invalidateFinancialReportsCache = () => {
  console.log('🗑️ Invalidating financial reports cache due to financial data change');
  financialReportsCache.clear();
};

// Function to generate cache key
const generateCacheKey = (dateFrom, dateTo) => {
  return `reports_${dateFrom || 'all'}_${dateTo || 'all'}`;
};

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

// POST /api/finances/technician-payment-settings - Čuvanje tipa plaćanja i plate za tehničara
router.post('/technician-payment-settings', auth, isSuperAdmin, async (req, res) => {
  try {
    const { technicianId, paymentType, monthlySalary } = req.body;

    if (!technicianId) {
      return res.status(400).json({ error: 'Tehničar ID je obavezan' });
    }

    const technician = await Technician.findById(technicianId);
    if (!technician) {
      return res.status(404).json({ error: 'Tehničar nije pronađen' });
    }

    // Ažuriraj tehničara
    technician.paymentType = paymentType || 'po_statusu';

    if (paymentType === 'plata') {
      const salary = parseFloat(monthlySalary) || 0;
      if (salary <= 0) {
        return res.status(400).json({ error: 'Mesečna plata mora biti veća od 0' });
      }
      technician.monthlySalary = salary;
    } else {
      technician.monthlySalary = 0; // Resetuj platu ako je po_statusu
    }

    await technician.save();

    res.json({
      message: 'Podešavanja plaćanja za tehničara su uspešno sačuvana',
      technician: {
        _id: technician._id,
        name: technician.name,
        paymentType: technician.paymentType,
        monthlySalary: technician.monthlySalary
      }
    });
  } catch (error) {
    console.error('Greška pri čuvanju podešavanja plaćanja:', error);
    res.status(500).json({ error: 'Greška pri čuvanju podešavanja plaćanja' });
  }
});

// GET /api/finances/municipalities - Lista svih opština iz WorkOrder tabele (optimized)
router.get('/municipalities', auth, isSuperAdmin, async (req, res) => {
  try {
    const { statsOnly } = req.query;

    // Za dashboard, vrati samo broj elemenata
    if (statsOnly === 'true') {
      const count = await WorkOrder.distinct('municipality').then(m => m.filter(municipality => municipality && municipality.trim() !== '').length);
      return res.json({ total: count });
    }

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

// GET /api/finances/technicians - Lista svih tehničara (optimized)
router.get('/technicians', auth, isSuperAdmin, async (req, res) => {
  try {
    const { statsOnly } = req.query;

    // Za dashboard, vrati samo broj elemenata
    if (statsOnly === 'true') {
      const count = await Technician.countDocuments({
        role: { $nin: ['admin', 'superadmin'] },
        isAdmin: { $ne: true }
      });
      return res.json({ total: count });
    }

    const allTechnicians = await Technician.find({})
      .select('_id name role isAdmin paymentType monthlySalary')
      .sort({ name: 1 })
      .lean(); // Dodano lean za performance

    // Traži tehničare koji nisu admin ili superadmin
    const technicians = allTechnicians.filter(tech =>
      tech.role !== 'admin' &&
      tech.role !== 'superadmin' &&
      !tech.isAdmin
    );

    // Vrati potrebna polja za frontend
    const result = technicians.map(tech => ({
      _id: tech._id,
      name: tech.name,
      paymentType: tech.paymentType || 'po_statusu',
      monthlySalary: tech.monthlySalary || 0
    }));

    res.json(result);
  } catch (error) {
    console.error('Greška pri dobijanju tehničara:', error);
    res.status(500).json({ error: 'Greška pri dobijanju tehničara' });
  }
});

// GET /api/finances/reports - Finansijski izveštaj (optimized with caching, aggregation & server-side pagination)
router.get('/reports', auth, isSuperAdmin, async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      statsOnly,
      page = 1,
      limit = 10,
      search = '',
      technicianFilter = ''
    } = req.query;
    const now = Date.now();

    // Modified cache key to include pagination params
    const cacheKey = generateCacheKey(dateFrom, dateTo) + `_${page}_${limit}_${search}_${technicianFilter}`;

    // Check cache first (only for first page without search/filters)
    if ((!page || page === '1') && !search && (!technicianFilter || technicianFilter.trim() === '' || technicianFilter === 'all')) {
      const cachedData = financialReportsCache.get(cacheKey);
      if (cachedData && (now - cachedData.timestamp) < FINANCIAL_REPORTS_CACHE_TTL) {
        console.log('Returning cached financial reports for:', cacheKey);
        return res.json(cachedData.data);
      }
    }

    console.log('Calculating fresh financial reports...');
    console.log('📊 Finances filter params:', { search, technicianFilter, dateFrom, dateTo });
    const startTime = Date.now();

    let filter = {};
    if (dateFrom && dateTo) {
      filter.verifiedAt = {
        $gte: new Date(dateFrom + 'T00:00:00.000Z'),
        $lte: new Date(dateTo + 'T23:59:59.999Z')
      };
    }

    // Search is now handled in aggregation pipeline for proper $lookup
    // (removed from basic filter to avoid conflicts)

    // Add technician filter - IMPORTANT: Only add when filter is truly present
    if (technicianFilter && technicianFilter.trim() !== '' && technicianFilter !== 'all') {
      try {
        filter['technicians.technicianId'] = new mongoose.Types.ObjectId(technicianFilter);
      } catch (error) {
        console.error('Invalid technician filter ObjectId:', technicianFilter);
        // Ignore invalid ObjectId, don't apply filter
      }
    }

    // Determine if we need aggregation (search or valid technician filter)
    const needsAggregation = search || (technicianFilter && technicianFilter.trim() !== '' && technicianFilter !== 'all');

    console.log('📊 Final MongoDB filter:', JSON.stringify(filter, null, 2));

    // Za dashboard stats, vrati samo osnovne brojke
    if (statsOnly === 'true') {
      const [summaryAgg] = await FinancialTransaction.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$finalPrice' },
            totalPayouts: { $sum: '$totalTechnicianEarnings' },
            totalProfit: { $sum: '$companyProfit' },
            transactionsCount: { $sum: 1 }
          }
        }
      ]);

      const result = summaryAgg || {
        totalRevenue: 0,
        totalPayouts: 0,
        totalProfit: 0,
        transactionsCount: 0
      };

      return res.json({ summary: result });
    }

    // Server-side pagination setup
    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 100); // Max 100 per page
    const skip = (pageNum - 1) * limitNum;

    // Use aggregation pipeline for better performance with pagination
    const [summaryAgg, technicianStatsAgg, transactions, totalCount] = await Promise.all([
      // Summary aggregation (only for first page or when no pagination)
      pageNum === 1 ? (
        needsAggregation ?
          // Use aggregation with lookup for technician filter
          FinancialTransaction.aggregate([
            {
              $lookup: {
                from: 'workorders',
                localField: 'workOrderId',
                foreignField: '_id',
                as: 'workOrder'
              }
            },
            {
              $lookup: {
                from: 'technicians',
                localField: 'technicians.technicianId',
                foreignField: '_id',
                as: 'technicianData'
              }
            },
            {
              $match: {
                $and: [
                  // Date filter
                  ...(filter.verifiedAt ? [{ verifiedAt: filter.verifiedAt }] : []),
                  // Technician filter
                  ...(technicianFilter && technicianFilter.trim() !== '' && technicianFilter !== 'all' ?
                    [{ 'technicians.technicianId': new mongoose.Types.ObjectId(technicianFilter) }] : []
                  ),
                  // Search in tisJobId, municipality, customerStatus, or technician names (only if search exists)
                  ...(search ? [{
                    $or: [
                      { 'workOrder.tisJobId': { $regex: search, $options: 'i' } },
                      { municipality: { $regex: search, $options: 'i' } },
                      { customerStatus: { $regex: search, $options: 'i' } },
                      { 'technicianData.name': { $regex: search, $options: 'i' } }
                    ]
                  }] : [])
                ]
              }
            },
            {
              $group: {
                _id: null,
                totalRevenue: { $sum: '$finalPrice' },
                totalPayouts: { $sum: '$totalTechnicianEarnings' },
                totalProfit: { $sum: '$companyProfit' },
                transactionsCount: { $sum: 1 }
              }
            }
          ]) :
          // Use simple match for basic queries
          FinancialTransaction.aggregate([
            { $match: filter },
            {
              $group: {
                _id: null,
                totalRevenue: { $sum: '$finalPrice' },
                totalPayouts: { $sum: '$totalTechnicianEarnings' },
                totalProfit: { $sum: '$companyProfit' },
                transactionsCount: { $sum: 1 }
              }
            }
          ])
      ) : Promise.resolve([null]),

      // Technician stats aggregation (only for first page)
      pageNum === 1 ? (
        needsAggregation ?
          // Use aggregation with lookup for technician filter
          FinancialTransaction.aggregate([
            {
              $lookup: {
                from: 'workorders',
                localField: 'workOrderId',
                foreignField: '_id',
                as: 'workOrder'
              }
            },
            {
              $lookup: {
                from: 'technicians',
                localField: 'technicians.technicianId',
                foreignField: '_id',
                as: 'technicianData'
              }
            },
            {
              $match: {
                $and: [
                  // Date filter
                  ...(filter.verifiedAt ? [{ verifiedAt: filter.verifiedAt }] : []),
                  // Technician filter
                  ...(technicianFilter && technicianFilter.trim() !== '' && technicianFilter !== 'all' ?
                    [{ 'technicians.technicianId': new mongoose.Types.ObjectId(technicianFilter) }] : []
                  ),
                  // Search in tisJobId, municipality, customerStatus, or technician names (only if search exists)
                  ...(search ? [{
                    $or: [
                      { 'workOrder.tisJobId': { $regex: search, $options: 'i' } },
                      { municipality: { $regex: search, $options: 'i' } },
                      { customerStatus: { $regex: search, $options: 'i' } },
                      { 'technicianData.name': { $regex: search, $options: 'i' } }
                    ]
                  }] : [])
                ]
              }
            },
            { $unwind: '$technicians' },
            {
              $group: {
                _id: '$technicians.technicianId',
                totalEarnings: { $sum: '$technicians.earnings' },
                workOrdersCount: { $sum: 1 }
              }
            },
            {
              $lookup: {
                from: 'technicians',
                localField: '_id',
                foreignField: '_id',
                as: 'technicianInfo'
              }
            },
            {
              $project: {
                technicianId: '$_id',
                name: { $arrayElemAt: ['$technicianInfo.name', 0] },
                paymentType: { $arrayElemAt: ['$technicianInfo.paymentType', 0] },
                monthlySalary: { $arrayElemAt: ['$technicianInfo.monthlySalary', 0] },
                totalEarnings: 1,
                workOrdersCount: 1
              }
            },
            {
              $match: {
                name: { $ne: null, $exists: true }
              }
            }
          ]) :
          // Use simple match for basic queries
          FinancialTransaction.aggregate([
            { $match: filter },
            { $unwind: '$technicians' },
            {
              $group: {
                _id: '$technicians.technicianId',
                totalEarnings: { $sum: '$technicians.earnings' },
                workOrdersCount: { $sum: 1 }
              }
            },
            {
              $lookup: {
                from: 'technicians',
                localField: '_id',
                foreignField: '_id',
                as: 'technicianInfo'
              }
            },
            {
              $project: {
                technicianId: '$_id',
                name: { $arrayElemAt: ['$technicianInfo.name', 0] },
                paymentType: { $arrayElemAt: ['$technicianInfo.paymentType', 0] },
                monthlySalary: { $arrayElemAt: ['$technicianInfo.monthlySalary', 0] },
                totalEarnings: 1,
                workOrdersCount: 1
              }
            },
            {
              $match: {
                name: { $ne: null, $exists: true }
              }
            }
          ])
      ) : Promise.resolve([]),

      // Paginated transactions - use aggregation when search or technician filter is present
      needsAggregation ?
        FinancialTransaction.aggregate([
          // First lookup workorders to get tisJobId for search
          {
            $lookup: {
              from: 'workorders',
              localField: 'workOrderId',
              foreignField: '_id',
              as: 'workOrder'
            }
          },
          // Then lookup technicians for name search
          {
            $lookup: {
              from: 'technicians',
              localField: 'technicians.technicianId',
              foreignField: '_id',
              as: 'technicianData'
            }
          },
          // Apply all filters including search
          {
            $match: {
              $and: [
                // Date filter
                ...(filter.verifiedAt ? [{ verifiedAt: filter.verifiedAt }] : []),
                // Technician filter
                ...(technicianFilter && technicianFilter.trim() !== '' && technicianFilter !== 'all' ?
                  [{ 'technicians.technicianId': new mongoose.Types.ObjectId(technicianFilter) }] : []
                ),
                // Search in tisJobId, municipality, customerStatus, or technician names (only if search exists)
                ...(search ? [{
                  $or: [
                    { 'workOrder.tisJobId': { $regex: search, $options: 'i' } },
                    { municipality: { $regex: search, $options: 'i' } },
                    { customerStatus: { $regex: search, $options: 'i' } },
                    { 'technicianData.name': { $regex: search, $options: 'i' } }
                  ]
                }] : [])
              ]
            }
          },
          // Format the output to match populate structure
          {
            $addFields: {
              workOrderId: { $arrayElemAt: ['$workOrder', 0] },
              technicians: {
                $map: {
                  input: '$technicians',
                  as: 'tech',
                  in: {
                    $mergeObjects: [
                      '$$tech',
                      {
                        technicianId: {
                          $let: {
                            vars: {
                              techData: {
                                $arrayElemAt: [
                                  {
                                    $filter: {
                                      input: '$technicianData',
                                      cond: { $eq: ['$$this._id', '$$tech.technicianId'] }
                                    }
                                  },
                                  0
                                ]
                              }
                            },
                            in: {
                              _id: '$$tech.technicianId',
                              name: '$$techData.name'
                            }
                          }
                        }
                      }
                    ]
                  }
                }
              }
            }
          },
          { $sort: { verifiedAt: -1 } },
          { $skip: skip },
          { $limit: limitNum }
        ]) :
        FinancialTransaction.find(filter)
          .populate('technicians.technicianId', 'name')
          .populate('workOrderId', 'tisJobId date')
          .sort({ verifiedAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),

      // Total count for pagination - use same aggregation logic as main query
      needsAggregation ?
        FinancialTransaction.aggregate([
          {
            $lookup: {
              from: 'workorders',
              localField: 'workOrderId',
              foreignField: '_id',
              as: 'workOrder'
            }
          },
          {
            $lookup: {
              from: 'technicians',
              localField: 'technicians.technicianId',
              foreignField: '_id',
              as: 'technicianData'
            }
          },
          {
            $match: {
              $and: [
                // Date filter
                ...(filter.verifiedAt ? [{ verifiedAt: filter.verifiedAt }] : []),
                // Technician filter
                ...(technicianFilter && technicianFilter.trim() !== '' && technicianFilter !== 'all' ?
                  [{ 'technicians.technicianId': new mongoose.Types.ObjectId(technicianFilter) }] : []
                ),
                // Search in tisJobId, municipality, customerStatus, or technician names (only if search exists)
                ...(search ? [{
                  $or: [
                    { 'workOrder.tisJobId': { $regex: search, $options: 'i' } },
                    { municipality: { $regex: search, $options: 'i' } },
                    { customerStatus: { $regex: search, $options: 'i' } },
                    { 'technicianData.name': { $regex: search, $options: 'i' } }
                  ]
                }] : [])
              ]
            }
          },
          { $count: 'total' }
        ]).then(result => result[0]?.total || 0) :
        FinancialTransaction.countDocuments(filter)
    ]);

    const summary = summaryAgg?.[0] || {
      totalRevenue: 0,
      totalPayouts: 0,
      totalProfit: 0,
      transactionsCount: 0
    };

    const result = {
      summary: pageNum === 1 ? summary : null, // Only include summary on first page
      technicianStats: pageNum === 1 ? technicianStatsAgg : [], // Only include stats on first page
      transactions,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalCount / limitNum),
        totalCount,
        limit: limitNum,
        hasNextPage: pageNum < Math.ceil(totalCount / limitNum),
        hasPrevPage: pageNum > 1
      }
    };

    // Cache the result (only cache first page)
    if (pageNum === 1) {
      financialReportsCache.set(cacheKey, {
        data: result,
        timestamp: now
      });
    }

    const endTime = Date.now();
    console.log(`Financial reports calculated in ${endTime - startTime}ms (page ${pageNum}/${Math.ceil(totalCount / limitNum)})`);

    res.json(result);

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

// POST /api/finances/exclude-from-finances/:workOrderId - Isključiti iz finansijskih kalkulacija
router.post('/exclude-from-finances/:workOrderId', auth, isSuperAdmin, async (req, res) => {
  try {
    const { workOrderId } = req.params;

    // Pronađi neuspešnu transakciju
    const failedTransaction = await FailedFinancialTransaction.findOne({ workOrderId });
    if (!failedTransaction) {
      return res.status(404).json({ error: 'Neuspešna transakcija nije pronađena' });
    }

    // Označiti kao potpuno isključen iz finansija
    failedTransaction.excludedFromFinances = true;
    failedTransaction.excludedAt = new Date();
    failedTransaction.excludedBy = req.user.name || 'SuperAdmin';
    failedTransaction.resolved = true; // Takođe označi kao razrešen
    failedTransaction.resolvedAt = new Date();
    await failedTransaction.save();

    res.json({
      message: 'Radni nalog je potpuno isključen iz finansijskih kalkulacija'
    });

  } catch (error) {
    console.error('Greška pri isključivanju iz finansija:', error);
    res.status(500).json({ error: 'Greška pri isključivanju radnog naloga iz finansija' });
  }
});

module.exports = router;
module.exports.invalidateFinancialReportsCache = invalidateFinancialReportsCache;