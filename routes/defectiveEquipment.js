const express = require('express');
     const router = express.Router();
     const { Equipment, Log, WorkOrder, Technician } = require('../models');

     // Cache for defective equipment (5 minute TTL)
     let defectiveEquipmentCache = null;
     let defectiveEquipmentCacheTimestamp = 0;
     const DEFECTIVE_EQUIPMENT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

     // Function to invalidate defective equipment cache
     const invalidateDefectiveEquipmentCache = () => {
       console.log('🗑️ Invalidating defective equipment cache due to equipment change');
       defectiveEquipmentCache = null;
       defectiveEquipmentCacheTimestamp = 0;
     };

     // GET /api/defective-equipment - Dobijanje neispravne opreme (optimized)
     router.get('/', async (req, res) => {
       try {
         const { statsOnly } = req.query;
         const now = Date.now();
         console.log('📊 Fetching defective equipment...');

         // Check cache first (for full data requests)
         if (!statsOnly && defectiveEquipmentCache && (now - defectiveEquipmentCacheTimestamp) < DEFECTIVE_EQUIPMENT_CACHE_TTL) {
           console.log('📦 Returning cached defective equipment data');
           return res.json(defectiveEquipmentCache);
         }

         // Za dashboard, vraćaj samo osnovne statistike
         if (statsOnly === 'true') {
           console.log('📊 Fetching defective equipment stats only...');
           const startTime = Date.now();

           const stats = await Equipment.aggregate([
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
                 _id: null,
                 total: { $sum: 1 },
                 byCategory: {
                   $push: {
                     category: '$category',
                     count: 1
                   }
                 }
               }
             }
           ]);

           const result = {
             total: stats[0]?.total || 0,
             byCategory: {}
           };

           // Group by category
           if (stats[0]?.byCategory) {
             stats[0].byCategory.forEach(item => {
               if (!result.byCategory[item.category]) {
                 result.byCategory[item.category] = 0;
               }
               result.byCategory[item.category]++;
             });
           }

           const endTime = Date.now();
           console.log(`📊 Defective equipment stats fetched in ${endTime - startTime}ms`);

           return res.json({
             success: true,
             stats: result
           });
         }

         // Dobijamo svu opremu sa statusom ili lokacijom "defective"
         const defectiveEquipment = await Equipment.find({
           $or: [
             { status: 'defective' },
             { location: 'defective' }
           ]
         })
         .populate('assignedTo', 'name')
         .sort({ removedAt: -1, updatedAt: -1 })
         .lean(); // Performance optimization

         console.log(`📋 Found ${defectiveEquipment.length} defective equipment items`);

         // Za svaku opremu, pronađemo log koji pokazuje ko ju je uklonio
         const enrichedEquipment = await Promise.all(
           defectiveEquipment.map(async (equipment) => {
             try {
               // Tražimo log kada je oprema uklonjena
               const removalLog = await Log.findOne({
                 'equipmentDetails.equipmentId': equipment._id,
                 action: 'equipment_removed'
               })
               .populate('performedBy', 'name')
               .populate('workOrderId', 'tisId userName address municipality type')
               .sort({ timestamp: -1 });

               // Ako nema log, možda je oprema označena kao defective direktno
               let defectiveLog = null;
               if (!removalLog) {
                 // Tražimo bilo koji log koji spominje ovu opremu
                 defectiveLog = await Log.findOne({
                   'equipmentDetails.equipmentId': equipment._id
                 })
                 .populate('performedBy', 'name')
                 .populate('workOrderId', 'tisId userName address municipality type')
                 .sort({ timestamp: -1 });
               }

               const relevantLog = removalLog || defectiveLog;

               return {
                 _id: equipment._id,
                 category: equipment.category,
                 description: equipment.description,
                 serialNumber: equipment.serialNumber,
                 location: equipment.location,
                 status: equipment.status,
                 assignedTo: equipment.assignedTo,
                 removedAt: equipment.removedAt,
                 createdAt: equipment.createdAt,
                 updatedAt: equipment.updatedAt,
                 // Informacije o uklanjanju/označavanju kao defective
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
             } catch (error) {
               console.error(`❌ Error processing equipment ${equipment._id}:`, error);
               return {
                 _id: equipment._id,
                 category: equipment.category,
                 description: equipment.description,
                 serialNumber: equipment.serialNumber,
                 location: equipment.location,
                 status: equipment.status,
                 assignedTo: equipment.assignedTo,
                 removedAt: equipment.removedAt,
                 createdAt: equipment.createdAt,
                 updatedAt: equipment.updatedAt,
                 removalInfo: null
               };
             }
           })
         );

         // Statistike
         const stats = {
           total: enrichedEquipment.length,
           withRemovalInfo: enrichedEquipment.filter(eq => eq.removalInfo).length,
           withoutRemovalInfo: enrichedEquipment.filter(eq => !eq.removalInfo).length,
           byCategory: {}
         };

         // Grupišemo po kategorijama
         enrichedEquipment.forEach(eq => {
           if (!stats.byCategory[eq.category]) {
             stats.byCategory[eq.category] = 0;
           }
           stats.byCategory[eq.category]++;
         });

         console.log('📈 Defective equipment stats:', stats);

         const result = {
           success: true,
           data: enrichedEquipment,
           stats: stats
         };

         // Cache the result for future requests
         defectiveEquipmentCache = result;
         defectiveEquipmentCacheTimestamp = now;

         res.json(result);

       } catch (error) {
         console.error('❌ Error fetching defective equipment:', error);
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