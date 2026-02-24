const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const WorkOrder = require('../models/WorkOrder');
const Equipment = require('../models/Equipment');
const Material = require('../models/Material');
const Technician = require('../models/Technician');
const User = require('../models/User');

// ============================================================
// GET /api/search?q=searchTerm - Global search across all data
// ============================================================
router.get('/', auth, async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.json({ workOrders: [], equipment: [], materials: [], technicians: [] });
    }

    const searchTerm = q.trim();
    const regex = new RegExp(searchTerm, 'i');

    const [workOrders, equipment, materials, technicians] = await Promise.all([
      // Work Orders
      WorkOrder.find({
        $or: [
          { tisJobId: regex },
          { tisId: regex },
          { address: regex },
          { municipality: regex },
          { userName: regex },
          { type: regex }
        ]
      })
        .select('tisJobId tisId address municipality userName type status date')
        .sort({ date: -1 })
        .limit(5)
        .lean(),

      // Equipment - with location info
      Equipment.find({
        $or: [
          { serialNumber: regex },
          { description: regex },
          { category: regex }
        ]
      })
        .select('serialNumber description category location status assignedTo assignedToUser')
        .populate('assignedTo', 'name')
        .limit(5)
        .lean(),

      // Materials
      Material.find({
        type: regex
      })
        .select('type quantity')
        .limit(3)
        .lean(),

      // Technicians
      Technician.find({
        $or: [
          { name: regex },
          { phoneNumber: regex }
        ],
        role: 'technician'
      })
        .select('name phoneNumber isActive')
        .limit(3)
        .lean()
    ]);

    // Process equipment to add readable location info
    const processedEquipment = await Promise.all(equipment.map(async (eq) => {
      let locationLabel = 'Nepoznato';
      let locationtype = 'unknown';
      let navigateTo = '/equipment';
      let searchParam = eq.serialNumber;

      if (eq.assignedToUser) {
        // Equipment is with a user/customer
        const user = await User.findOne({ tisId: eq.assignedToUser }).select('name tisId').lean();
        locationLabel = user ? `Kod korisnika: ${user.name}` : `Kod korisnika (TIS: ${eq.assignedToUser})`;
        locationtype = 'user';
        navigateTo = '/users';
        searchParam = user ? user.name : eq.assignedToUser;
      } else if (eq.location === 'magacin') {
        locationLabel = 'Na lageru';
        locationtype = 'warehouse';
      } else if (eq.location && eq.location.startsWith('tehnicar-')) {
        locationLabel = eq.assignedTo ? `Kod tehničara: ${eq.assignedTo.name}` : 'Kod tehničara';
        locationtype = 'technician';
      }

      return {
        _id: eq._id,
        serialNumber: eq.serialNumber,
        description: eq.description,
        category: eq.category,
        status: eq.status,
        locationLabel,
        locationtype,
        navigateTo,
        searchParam
      };
    }));

    res.json({
      workOrders,
      equipment: processedEquipment,
      materials,
      technicians
    });

  } catch (error) {
    console.error('[Search] Greška:', error);
    res.status(500).json({ error: 'Greška pri pretraživanju' });
  }
});

module.exports = router;
