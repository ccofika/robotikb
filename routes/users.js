const express = require('express');
const router = express.Router();
const { User, WorkOrder, Equipment } = require('../models');
const mongoose = require('mongoose');
const { logActivity } = require('../middleware/activityLogger');

// Simple in-memory cache for user list queries (1 minute TTL)
const cache = {
  data: new Map(),
  set(key, value, ttl = 60000) { // Default 1 minute TTL
    const expiresAt = Date.now() + ttl;
    this.data.set(key, { value, expiresAt });
  },
  get(key) {
    const item = this.data.get(key);
    if (!item) return null;

    if (Date.now() > item.expiresAt) {
      this.data.delete(key);
      return null;
    }

    return item.value;
  },
  clear() {
    this.data.clear();
  }
};

// Clear cache every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, item] of cache.data.entries()) {
    if (now > item.expiresAt) {
      cache.data.delete(key);
    }
  }
}, 5 * 60 * 1000);

// GET - Server-side paginated users endpoint with search and filters
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      search = '',
      hasWorkOrders = '',
      hasEquipment = '',
      sortBy = 'name',
      sortOrder = 'asc',
      // Legacy support for old optimization endpoints
      statsOnly,
      withRecentActivity,
      withoutRecentActivity,
      days = 7
    } = req.query;

    const startTime = Date.now();
    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 200); // Max 200 per page
    const skip = (pageNum - 1) * limitNum;

    // Create cache key for this specific query
    const cacheKey = `users_${JSON.stringify({
      page: pageNum,
      limit: limitNum,
      search,
      hasWorkOrders,
      hasEquipment,
      sortBy,
      sortOrder,
      withRecentActivity,
      withoutRecentActivity,
      days
    })}`;

    // Check cache first
    const cached = cache.get(cacheKey);
    if (cached && !statsOnly) {
      console.log(`📦 Cache hit for users query: ${Date.now() - startTime}ms`);
      return res.json(cached);
    }

    // Stats only - fastest response for dashboard
    if (statsOnly === 'true') {
      const [totalUsers, usersWithWorkOrders, usersWithEquipment] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ 'workOrders.0': { $exists: true } }),
        Equipment.aggregate([
          {
            $match: {
              location: { $regex: /^user-/ },
              status: 'installed'
            }
          },
          {
            $group: {
              _id: '$location'
            }
          },
          {
            $count: 'count'
          }
        ])
      ]);

      return res.json({
        total: totalUsers,
        withWorkOrders: usersWithWorkOrders,
        withEquipment: usersWithEquipment[0]?.count || 0
      });
    }

    // Build search condition with text search (including equipment and work orders)
    let searchCondition = {};
    if (search) {
      // If searching for equipment or work order data, we need to use aggregation
      if (search.length > 1) {
        // First check if search might be for equipment S/N or work order data
        const [equipmentUsers, workOrderUsers] = await Promise.all([
          // Find users by equipment serial numbers
          Equipment.distinct('location', {
            serialNumber: { $regex: search, $options: 'i' },
            location: { $regex: /^user-/ }
          }),
          // Find users by work order data (using correct field names)
          WorkOrder.distinct('user', {
            $or: [
              { tisJobId: { $regex: search, $options: 'i' } },
              { details: { $regex: search, $options: 'i' } },
              { tisId: { $regex: search, $options: 'i' } }
            ]
          })
        ]);

        // Extract user tisIds from equipment locations (user-{tisId} format)
        const equipmentTisIds = equipmentUsers
          .filter(loc => loc && loc.startsWith('user-'))
          .map(loc => loc.substring(5));

        // Build comprehensive search condition
        const searchConditions = [
          // Direct user field searches
          { name: { $regex: search, $options: 'i' } },
          { address: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } },
          { tisId: { $regex: search, $options: 'i' } }
        ];

        // Add equipment-based search
        if (equipmentTisIds.length > 0) {
          searchConditions.push({ tisId: { $in: equipmentTisIds } });
        }

        // Add work order-based search
        if (workOrderUsers.length > 0) {
          searchConditions.push({ _id: { $in: workOrderUsers } });
        }

        searchCondition = { $or: searchConditions };
      } else {
        // Short search - only direct fields
        searchCondition = {
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { address: { $regex: search, $options: 'i' } },
            { phone: { $regex: search, $options: 'i' } },
            { tisId: { $regex: search, $options: 'i' } }
          ]
        };
      }
    }

    // Build filters condition
    let filtersCondition = {};

    // Work orders filter - simplified without lookups
    if (hasWorkOrders === 'has') {
      filtersCondition['workOrders.0'] = { $exists: true };
    } else if (hasWorkOrders === 'no') {
      filtersCondition.$or = [
        { workOrders: { $exists: false } },
        { workOrders: { $size: 0 } }
      ];
    }

    // Legacy recent activity support - keep for compatibility but optimize
    if (withRecentActivity === 'true' || withoutRecentActivity === 'true') {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(days));

      if (withRecentActivity === 'true') {
        filtersCondition = {
          'workOrders': {
            $elemMatch: {
              'date': { $gte: daysAgo }
            }
          }
        };
      } else if (withoutRecentActivity === 'true') {
        filtersCondition = {
          $or: [
            { 'workOrders': { $exists: false } },
            { 'workOrders': { $size: 0 } },
            {
              'workOrders': {
                $not: {
                  $elemMatch: {
                    'date': { $gte: daysAgo }
                  }
                }
              }
            }
          ]
        };
      }
    }

    // Combine conditions
    const matchCondition = {
      ...searchCondition,
      ...filtersCondition
    };

    // Build sort condition
    const sortCondition = {};
    sortCondition[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // OPTIMIZED: Use simple queries with proper indexes instead of expensive aggregation
    const [totalCount, users] = await Promise.all([
      User.countDocuments(matchCondition),
      User.find(matchCondition)
        .select('tisId name address phone createdAt') // Only select needed fields
        .sort(sortCondition)
        .skip(skip)
        .limit(limitNum)
        .lean() // Use lean() for faster queries
    ]);

    // Get work orders and equipment counts for current page users (optimized batch queries)
    const userIds = users.map(u => u._id);
    const userTisIds = users.map(u => u.tisId);


    const [workOrderCounts, equipmentCounts] = await Promise.all([
      // Aggregate work orders count by user (field is 'user', not 'userId')
      WorkOrder.aggregate([
        { $match: { user: { $in: userIds } } },
        { $group: { _id: '$user', count: { $sum: 1 } } }
      ]),
      // Aggregate equipment count by location (user-{tisId})
      Equipment.aggregate([
        {
          $match: {
            location: { $in: userTisIds.map(tisId => `user-${tisId}`) },
            status: 'installed'
          }
        },
        {
          $group: {
            _id: { $substr: ['$location', 5, -1] }, // Extract tisId from 'user-{tisId}'
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    // Create lookup maps for O(1) access
    const workOrderMap = new Map();
    workOrderCounts.forEach(item => {
      workOrderMap.set(item._id.toString(), item.count);
    });

    const equipmentMap = new Map();
    equipmentCounts.forEach(item => {
      equipmentMap.set(item._id, item.count);
    });

    // Add counts to users
    const usersWithBasicInfo = users.map(user => ({
      ...user,
      workOrdersCount: workOrderMap.get(user._id.toString()) || 0,
      equipmentCount: equipmentMap.get(user.tisId) || 0,
      workOrders: [] // Empty for list view
    }));

    const totalPages = Math.ceil(totalCount / limitNum);

    const duration = Date.now() - startTime;
    console.log(`⚙️ Users paginated query: ${duration}ms | Page ${pageNum}/${totalPages} | ${users.length}/${totalCount} users`);

    const responseData = {
      users: usersWithBasicInfo,
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
        resultsPerPage: users.length
      }
    };

    // Cache the response for 1 minute (only if not stats-only query)
    if (!statsOnly) {
      cache.set(cacheKey, responseData, 60000);
    }

    res.json(responseData);

  } catch (error) {
    console.error('Greška pri dohvatanju korisnika:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju korisnika' });
  }
});

// GET - Dohvati korisnika po ID-u sa detaljnim podacima
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { includeDetails = 'true' } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    const user = await User.findById(id).lean();

    if (!user) {
      return res.status(404).json({ error: 'Korisnik nije pronađen' });
    }

    // If details are requested, load work orders and equipment count
    if (includeDetails === 'true') {
      const [workOrders, equipmentCount] = await Promise.all([
        WorkOrder.find({ userId: id })
          .sort({ date: -1 })
          .limit(10)
          .select('status date type')
          .lean(),
        Equipment.countDocuments({
          location: `user-${user.tisId}`,
          status: 'installed'
        })
      ]);

      user.workOrders = workOrders;
      user.workOrdersCount = workOrders.length;
      user.equipmentCount = equipmentCount;
    }

    res.json(user);
  } catch (error) {
    console.error('Greška pri dohvatanju korisnika:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju korisnika' });
  }
});

// GET - Dohvati korisnika po TIS ID-u
router.get('/tis/:tisId', async (req, res) => {
  try {
    const { tisId } = req.params;
    const user = await User.findOne({ tisId }).lean();

    if (!user) {
      return res.status(404).json({ error: 'Korisnik nije pronađen' });
    }

    res.json(user);
  } catch (error) {
    console.error('Greška pri dohvatanju korisnika:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju korisnika' });
  }
});

// GET - Pretraži korisnike po bilo kom polju
router.get('/search/:term', async (req, res) => {
  try {
    const { term } = req.params;

    const filteredUsers = await User.find({
      $or: [
        { name: { $regex: term, $options: 'i' } },
        { address: { $regex: term, $options: 'i' } },
        { phone: { $regex: term, $options: 'i' } },
        { tisId: { $regex: term, $options: 'i' } }
      ]
    }).lean();

    res.json(filteredUsers);
  } catch (error) {
    console.error('Greška pri pretraživanju korisnika:', error);
    res.status(500).json({ error: 'Greška pri pretraživanju korisnika' });
  }
});

// GET - Dohvati radne naloge korisnika
router.get('/:id/workorders', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({ error: 'Korisnik nije pronađen' });
    }

    const userWorkOrders = await WorkOrder.find({ user: id })
      .populate('technicianId', 'name _id')
      .sort({ date: -1 })
      .lean();

    res.json(userWorkOrders);
  } catch (error) {
    console.error('Greška pri dohvatanju radnih naloga korisnika:', error);
    res.status(500).json({ error: 'Greška pri dohvatanju radnih naloga korisnika' });
  }
});

// POST - Kreiraj novog korisnika
router.post('/', logActivity('users', 'user_add', {
  getEntityName: (req, responseData) => responseData?.name || responseData?.tisId
}), async (req, res) => {
  try {
    const { tisId, name, address, phone } = req.body;

    if (!tisId || !name || !address) {
      return res.status(400).json({ error: 'TIS ID, ime i adresa su obavezni' });
    }

    // Provera da li već postoji korisnik sa datim TIS ID-om
    const existingUser = await User.findOne({ tisId });
    if (existingUser) {
      return res.status(400).json({ error: 'Korisnik sa datim TIS ID-om već postoji' });
    }

    const newUser = new User({
      tisId,
      name,
      address,
      phone: phone || '',
      workOrders: []
    });

    const savedUser = await newUser.save();

    // Clear cache when new user is created
    cache.clear();

    res.status(201).json(savedUser);
  } catch (error) {
    console.error('Greška pri kreiranju korisnika:', error);
    res.status(500).json({ error: 'Greška pri kreiranju korisnika' });
  }
});

// PUT - Ažuriraj korisnika
router.put('/:id', logActivity('users', 'user_edit', {
  getEntityId: (req) => req.params.id,
  getEntityName: (req, responseData) => responseData?.name || responseData?.tisId
}), async (req, res) => {
  try {
    const { id } = req.params;
    const { tisId, name, address, phone } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({ error: 'Korisnik nije pronađen' });
    }

    // Ako se TIS ID menja, provera da li je jedinstven
    if (tisId && tisId !== user.tisId) {
      const duplicateTisId = await User.findOne({ tisId, _id: { $ne: id } });
      if (duplicateTisId) {
        return res.status(400).json({ error: 'TIS ID mora biti jedinstven' });
      }
    }

    user.tisId = tisId || user.tisId;
    user.name = name || user.name;
    user.address = address || user.address;
    user.phone = phone !== undefined ? phone : user.phone;

    const updatedUser = await user.save();

    // Clear cache when user is updated
    cache.clear();

    res.json(updatedUser);
  } catch (error) {
    console.error('Greška pri ažuriranju korisnika:', error);
    res.status(500).json({ error: 'Greška pri ažuriranju korisnika' });
  }
});

// DELETE - Obriši korisnika
router.delete('/:id', logActivity('users', 'user_delete', {
  getEntityId: (req) => req.params.id
}), async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    const deletedUser = await User.findByIdAndDelete(id);

    if (!deletedUser) {
      return res.status(404).json({ error: 'Korisnik nije pronađen' });
    }

    // Clear cache when user is deleted
    cache.clear();

    res.json({ message: 'Korisnik uspešno obrisan' });
  } catch (error) {
    console.error('Greška pri brisanju korisnika:', error);
    res.status(500).json({ error: 'Greška pri brisanju korisnika' });
  }
});

// POST - Dodaj radni nalog korisniku
router.post('/:id/workorders/:workOrderId', async (req, res) => {
  try {
    const { id, workOrderId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(workOrderId)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'Korisnik nije pronađen' });
    }

    const workOrder = await WorkOrder.findById(workOrderId);
    if (!workOrder) {
      return res.status(404).json({ error: 'Radni nalog nije pronađen' });
    }

    // Proveri da li radni nalog već postoji kod korisnika
    if (!user.workOrders.includes(workOrderId)) {
      user.workOrders.push(workOrderId);
      await user.save();
    }

    res.json(user);
  } catch (error) {
    console.error('Greška pri dodavanju radnog naloga korisniku:', error);
    res.status(500).json({ error: 'Greška pri dodavanju radnog naloga korisniku' });
  }
});

// DELETE - Ukloni radni nalog sa korisnika
router.delete('/:id/workorders/:workOrderId', async (req, res) => {
  try {
    const { id, workOrderId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(workOrderId)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'Korisnik nije pronađen' });
    }

    // Ukloni radni nalog iz niza workOrders
    user.workOrders = user.workOrders.filter(
      orderId => orderId.toString() !== workOrderId
    );

    await user.save();
    res.json(user);
  } catch (error) {
    console.error('Greška pri uklanjanju radnog naloga sa korisnika:', error);
    res.status(500).json({ error: 'Greška pri uklanjanju radnog naloga sa korisnika' });
  }
});

module.exports = router;