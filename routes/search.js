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
    // Escape korisnickog unosa — bez ovoga unos poput "(061" ili "[abc" obori
    // konstrukciju RegExp-a i ruta vrati 500.
    const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');

    // Za numericke pojmove dopusti razdvajace i srpski pozivni broj u
    // sacuvanoj vrednosti ("0611655593" nalazi "(061) 165-55-93", "+381...")
    const digits = searchTerm.replace(/\D/g, '');
    const looseRegexes = [];
    if (digits.length >= 6) {
      const forms = new Set([digits]);
      if (digits.startsWith('381')) forms.add('0' + digits.slice(3));
      else if (digits.startsWith('0')) forms.add('381' + digits.slice(1));
      forms.forEach(d => looseRegexes.push(new RegExp(d.split('').join('[^0-9]*'))));
    }

    const [workOrders, equipment, materials, technicians] = await Promise.all([
      // Work Orders
      WorkOrder.find({
        $or: [
          { tisJobId: regex },
          { tisId: regex },
          { address: regex },
          { municipality: regex },
          { userName: regex },
          { userPhone: regex },
          { type: regex },
          ...looseRegexes.flatMap(r => [
            { userPhone: r }, { tisId: r }, { tisJobId: r }
          ])
        ]
      })
        .select('tisJobId tisId address municipality userName type status date tim')
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

      if (eq.status === 'defective' || eq.location === 'defective') {
        locationLabel = 'Neispravno';
        locationtype = 'defective';
        navigateTo = '/defective-equipment';
        searchParam = eq.serialNumber;
      } else if (eq.assignedToUser) {
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
