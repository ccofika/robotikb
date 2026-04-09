const express = require('express');
     const router = express.Router();
     const { Equipment, Log, WorkOrder, Technician } = require('../models');

     // Cache for stats (1 minute TTL)
     let statsCache = null;
     let statsCacheTimestamp = 0;
     const STATS_CACHE_TTL = 60 * 1000;

     // Function to invalidate defective equipment cache
     const invalidateDefectiveEquipmentCache = () => {
       statsCache = null;
       statsCacheTimestamp = 0;
     };

     // Base filter for defective equipment
     const DEFECTIVE_FILTER = {
       $or: [
         { status: 'defective' },
         { location: 'defective' }
       ]
     };

     // GET /api/defective-equipment - Server-side paginated defective equipment
     router.get('/', async (req, res) => {
       try {
         const { statsOnly, page = '1', limit = '50', search = '', category = '' } = req.query;
         const startTime = Date.now();

         // Stats-only mode for dashboard
         if (statsOnly === 'true') {
           const now = Date.now();
           if (statsCache && (now - statsCacheTimestamp) < STATS_CACHE_TTL) {
             return res.json({ success: true, stats: statsCache });
           }

           const [total, categoryStats] = await Promise.all([
             Equipment.countDocuments(DEFECTIVE_FILTER),
             Equipment.aggregate([
               { $match: DEFECTIVE_FILTER },
               { $group: { _id: '$category', count: { $sum: 1 } } },
               { $sort: { count: -1 } }
             ])
           ]);

           const byCategory = {};
           categoryStats.forEach(item => { byCategory[item._id] = item.count; });

           const result = { total, byCategory };
           statsCache = result;
           statsCacheTimestamp = now;

           return res.json({ success: true, stats: result });
         }

         // Build filter
         const filter = { ...DEFECTIVE_FILTER };
         const conditions = [DEFECTIVE_FILTER];

         if (search) {
           const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
           conditions.push({
             $or: [
               { serialNumber: searchRegex },
               { description: searchRegex },
               { category: searchRegex }
             ]
           });
         }

         if (category) {
           conditions.push({ category });
         }

         const finalFilter = conditions.length > 1 ? { $and: conditions } : DEFECTIVE_FILTER;

         // Pagination
         const pageNum = parseInt(page, 10) || 1;
         const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
         const skip = (pageNum - 1) * limitNum;

         // Execute count + paginated query in parallel
         const [totalCount, equipment] = await Promise.all([
           Equipment.countDocuments(finalFilter),
           Equipment.find(finalFilter)
             .select('category description serialNumber location status assignedTo removedAt createdAt updatedAt')
             .populate('assignedTo', 'name')
             .sort({ removedAt: -1, updatedAt: -1 })
             .skip(skip)
             .limit(limitNum)
             .lean()
         ]);

         // Batch fetch logs for this page only (much faster than N+1 queries)
         const equipmentIds = equipment.map(eq => eq._id);
         const logs = await Log.find({
           'equipmentDetails.equipmentId': { $in: equipmentIds },
           action: { $in: ['equipment_removed', 'equipment_marked_defective'] }
         })
         .populate('performedBy', 'name')
         .populate('workOrderId', 'tisId userName address municipality type')
         .sort({ timestamp: -1 })
         .lean();

         // Build log map (latest log per equipment)
         const logMap = {};
         for (const log of logs) {
           const eqId = log.equipmentDetails?.equipmentId?.toString();
           if (eqId && !logMap[eqId]) {
             logMap[eqId] = log;
           }
         }

         // If some equipment didn't have removal logs, try any log
         const missingIds = equipmentIds.filter(id => !logMap[id.toString()]);
         if (missingIds.length > 0) {
           const fallbackLogs = await Log.find({
             'equipmentDetails.equipmentId': { $in: missingIds }
           })
           .populate('performedBy', 'name')
           .populate('workOrderId', 'tisId userName address municipality type')
           .sort({ timestamp: -1 })
           .lean();

           for (const log of fallbackLogs) {
             const eqId = log.equipmentDetails?.equipmentId?.toString();
             if (eqId && !logMap[eqId]) {
               logMap[eqId] = log;
             }
           }
         }

         // Enrich equipment with log data
         const enrichedEquipment = equipment.map(eq => {
           const relevantLog = logMap[eq._id.toString()];
           return {
             ...eq,
             removalInfo: relevantLog ? {
               removedBy: relevantLog.performedBy,
               removedByName: relevantLog.performedByName,
               removalDate: relevantLog.timestamp,
               workOrder: relevantLog.workOrderId,
               reason: relevantLog.equipmentDetails?.removalReason || 'Neispravno',
               isWorking: relevantLog.equipmentDetails?.isWorking || false,
               action: relevantLog.action
             } : null
           };
         });

         // Also fetch category list for filter dropdown
         const categories = await Equipment.distinct('category', DEFECTIVE_FILTER);

         const totalPages = Math.ceil(totalCount / limitNum);
         const queryTime = Date.now() - startTime;

         res.json({
           success: true,
           data: enrichedEquipment,
           categories: categories.sort(),
           pagination: {
             currentPage: pageNum,
             totalPages,
             totalCount,
             limit: limitNum,
             hasNextPage: pageNum < totalPages,
             hasPreviousPage: pageNum > 1
           },
           performance: { queryTime, resultsPerPage: enrichedEquipment.length }
         });

       } catch (error) {
         console.error('Error fetching defective equipment:', error);
         res.status(500).json({
           success: false,
           message: 'Greška pri dobijanju neispravne opreme',
           error: error.message
         });
       }
     });

     // GET /api/defective-equipment/stats - Dobijanje statistika
     router.get('/stats', async (req, res) => {
       try {
         console.log('📊 Fetching defective equipment statistics...');

         // Brojimo opremu po kategorijama
         const categoryStats = await Equipment.aggregate([
           {
             $match: {
               $or: [
                 { status: 'defective' },
                 { location: 'defective' }
               ]
             }
           },
           {
             $group: {
               _id: '$category',
               count: { $sum: 1 }
             }
           },
           {
             $sort: { count: -1 }
           }
         ]);

         // Brojimo po mesecima kada je oprema označena kao defective
         const monthlyStats = await Equipment.aggregate([
           {
             $match: {
               $or: [
                 { status: 'defective' },
                 { location: 'defective' }
               ],
               removedAt: { $exists: true }
             }
           },
           {
             $group: {
               _id: {
                 year: { $year: '$removedAt' },
                 month: { $month: '$removedAt' }
               },
               count: { $sum: 1 }
             }
           },
           {
             $sort: { '_id.year': -1, '_id.month': -1 }
           },
           {
             $limit: 12
           }
         ]);

         // Ukupan broj
         const total = await Equipment.countDocuments({
           $or: [
             { status: 'defective' },
             { location: 'defective' }
           ]
         });

         res.json({
           success: true,
           stats: {
             total,
             byCategory: categoryStats,
             byMonth: monthlyStats
           }
         });

       } catch (error) {
         console.error('❌ Error fetching defective equipment stats:', error);
         res.status(500).json({
           success: false,
           message: 'Greška pri dobijanju statistika',
           error: error.message
         });
       }
     });

     // PUT /api/defective-equipment/:id/restore - Vraćanje neispravne opreme u ispravnu opremu
     router.put('/:id/restore', async (req, res) => {
       try {
         const { id } = req.params;
         console.log(`🔄 Restoring defective equipment to available: ${id}`);

         // Pronađi opremu
         const equipment = await Equipment.findById(id);

         if (!equipment) {
           return res.status(404).json({
             success: false,
             message: 'Oprema nije pronađena'
           });
         }

         // Debug: loguj status i lokaciju
         console.log(`📋 Equipment status: "${equipment.status}", location: "${equipment.location}"`);

         // Proveri da li je oprema zaista neispravna
         // Oprema je neispravna ako je status='defective' ILI location='defective'
         const isDefective = equipment.status === 'defective' || equipment.location === 'defective';

         if (!isDefective) {
           return res.status(400).json({
             success: false,
             message: `Oprema nije označena kao neispravna. Status: "${equipment.status}", Lokacija: "${equipment.location}"`
           });
         }

         // Proveri da li već postoji ispravna oprema sa istim serijskim brojem
         // (za slučaj da je serijski broj promenjen ili dupliciran)
         const existingEquipment = await Equipment.findOne({
           serialNumber: equipment.serialNumber,
           _id: { $ne: equipment._id },
           status: { $ne: 'defective' },
           location: { $ne: 'defective' }
         });

         if (existingEquipment) {
           return res.status(409).json({
             success: false,
             message: `Oprema sa serijskim brojem "${equipment.serialNumber}" već postoji u bazi ispravne opreme`
           });
         }

         // Vrati opremu u ispravnu
         equipment.status = 'available';
         equipment.location = 'magacin';
         equipment.removedAt = null;
         equipment.assignedTo = null;
         equipment.assignedToUser = null;

         await equipment.save();

         // Invalidate cache
         invalidateDefectiveEquipmentCache();

         console.log(`✅ Equipment ${equipment.serialNumber} restored to available`);

         res.json({
           success: true,
           message: `Oprema "${equipment.category} - ${equipment.description}" (${equipment.serialNumber}) je uspešno vraćena u magacin`,
           data: equipment
         });

       } catch (error) {
         console.error('❌ Error restoring defective equipment:', error);
         res.status(500).json({
           success: false,
           message: 'Greška pri vraćanju opreme',
           error: error.message
         });
       }
     });

     // GET /api/defective-equipment/:id - Dobijanje detalja pojedinačne neispravne opreme
     router.get('/:id', async (req, res) => {
       try {
         const { id } = req.params;
         console.log(`🔍 Fetching details for defective equipment: ${id}`);

         const equipment = await Equipment.findById(id)
           .populate('assignedTo', 'name');

         if (!equipment) {
           return res.status(404).json({
             success: false,
             message: 'Oprema nije pronađena'
           });
         }

         // Dobijamo sve logove vezane za ovu opremu
         const logs = await Log.find({
           'equipmentDetails.equipmentId': equipment._id
         })
         .populate('performedBy', 'name')
         .populate('workOrderId', 'tisId userName address municipality type')
         .sort({ timestamp: -1 });

         res.json({
           success: true,
           data: {
             equipment,
             logs
           }
         });

       } catch (error) {
         console.error('❌ Error fetching defective equipment details:', error);
         res.status(500).json({
           success: false,
           message: 'Greška pri dobijanju detalja opreme',
           error: error.message
         });
       }
     });

     // Export cache invalidation function for use in other modules
     module.exports = router;
     module.exports.invalidateDefectiveEquipmentCache = invalidateDefectiveEquipmentCache;