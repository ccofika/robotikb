// Kreirati u direktorijumu: routes/users.js
const express = require('express');
const router = express.Router();
const { User, WorkOrder } = require('../models');
const mongoose = require('mongoose');

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

    // Stats only - fastest response for dashboard
    if (statsOnly === 'true') {
      const [totalUsers, usersWithWorkOrders, usersWithEquipment] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ 'workOrders.0': { $exists: true } }),
        User.aggregate([
          {
            $lookup: {
              from: 'equipment',
              let: { tisId: '$tisId' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ['$location', { $concat: ['user-', { $toString: '$$tisId' }] }] },
                        { $eq: ['$status', 'installed'] }
                      ]
                    }
                  }
                }
              ],
              as: 'equipment'
            }
          },
          {
            $match: {
              'equipment.0': { $exists: true }
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

    // Build search condition
    let searchCondition = {};
    if (search) {
      searchCondition = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { address: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } },
          { tisId: { $regex: search, $options: 'i' } }
        ]
      };
    }

    // Build filters condition
    let filtersCondition = {};

    // Work orders filter
    if (hasWorkOrders === 'has') {
      filtersCondition['workOrders.0'] = { $exists: true };
    } else if (hasWorkOrders === 'no') {
      filtersCondition.$or = [
        { workOrders: { $exists: false } },
        { workOrders: { $size: 0 } }
      ];
    }

    // Legacy recent activity support
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

    // Get total count with simple query (much faster than aggregation)
    const [totalCount, users] = await Promise.all([
      User.countDocuments(matchCondition),
      User.find(matchCondition)
        .select('tisId name address phone createdAt') // Only select needed fields
        .sort(sortCondition)
        .skip(skip)
        .limit(limitNum)
        .lean() // Use lean() for faster queries
    ]);

    // For the basic user list, we don't need work orders or equipment counts
    // These will be loaded on-demand when user clicks on a specific user
    const usersWithBasicInfo = users.map(user => ({
      ...user,
      workOrdersCount: 0, // Placeholder - will load on demand
      equipmentCount: 0,  // Placeholder - will load on demand
      workOrders: []      // Empty array - will load on demand
    }));

    // totalCount is already available from the parallel query above
    const totalPages = Math.ceil(totalCount / limitNum);

    const duration = Date.now() - startTime;
    console.log(`\u2699\ufe0f Users paginated query: ${duration}ms | Page ${pageNum}/${totalPages} | ${users.length}/${totalCount} users`);

    res.json({
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
    });

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
    const user = await User.findOne({ tisId });
    
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
    });
    
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
router.post('/', async (req, res) => {
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
    res.status(201).json(savedUser);
  } catch (error) {
    console.error('Greška pri kreiranju korisnika:', error);
    res.status(500).json({ error: 'Greška pri kreiranju korisnika' });
  }
});

// PUT - Ažuriraj korisnika
router.put('/:id', async (req, res) => {
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
    res.json(updatedUser);
  } catch (error) {
    console.error('Greška pri ažuriranju korisnika:', error);
    res.status(500).json({ error: 'Greška pri ažuriranju korisnika' });
  }
});

// DELETE - Obriši korisnika
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Neispravan ID format' });
    }
    
    const deletedUser = await User.findByIdAndDelete(id);
    
    if (!deletedUser) {
      return res.status(404).json({ error: 'Korisnik nije pronađen' });
    }
    
    // Možemo razmotriti brisanje i povezanih workOrders
    
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