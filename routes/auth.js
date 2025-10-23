const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Technician } = require('../models');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET environment variable is not set!');
  process.exit(1);
}

// POST - Login za tehničara
router.post('/login', async (req, res) => {
  try {
    console.log('Login attempt:', req.body);
    const { name, password } = req.body;
    
    if (!name || !password) {
      return res.status(400).json({ error: 'Korisničko ime i lozinka su obavezni' });
    }
    
    // SuperAdmin login - proveri da li postoji superadmin u bazi
    if (name.toLowerCase() === 'superadmin' && password === 'Robotik2024!') {
      // Pokušaj da nađeš superadmin korisnika u bazi
      let superadmin = await Technician.findOne({
        $or: [
          { name: 'SuperAdministrator', role: 'superadmin' },
          { name: 'SuperAdministrator' } // Fallback za slučaj da superadmin postoji bez role
        ]
      });

      // Ako ne postoji, kreiraj ga
      if (!superadmin) {
        // Dodatno proveri da li postoji SuperAdministrator sa bilo kojom ulogom
        const existingSuperAdmin = await Technician.findOne({ name: 'SuperAdministrator' });

        if (existingSuperAdmin) {
          // Ako postoji SuperAdministrator ali nije superadmin, ažuriraj ga
          existingSuperAdmin.role = 'superadmin';
          existingSuperAdmin.isAdmin = true;
          if (!await bcrypt.compare('Robotik2024!', existingSuperAdmin.password)) {
            existingSuperAdmin.password = await bcrypt.hash('Robotik2024!', 10);
          }
          superadmin = await existingSuperAdmin.save();
          console.log('Updated existing SuperAdministrator to superadmin role');
        } else {
          // Kreiraj novog superadmin korisnika
          const hashedPassword = await bcrypt.hash('Robotik2024!', 10);

          superadmin = new Technician({
            name: 'SuperAdministrator',
            password: hashedPassword,
            role: 'superadmin',
            isAdmin: true,
            gmail: '',
            profileImage: '',
            materials: [],
            equipment: []
          });

          await superadmin.save();
          console.log('Created superadmin user');
        }
      }

      const token = jwt.sign(
        { _id: superadmin._id, name: superadmin.name, role: 'superadmin' },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      console.log('SuperAdmin login successful');

      return res.json({
        message: 'Uspešno prijavljivanje',
        user: {
          _id: superadmin._id,
          name: superadmin.name,
          role: 'superadmin',
          gmail: superadmin.gmail,
          profileImage: superadmin.profileImage
        },
        token
      });
    }

    // Supervisor login - proveri da li postoji supervisor u bazi
    if (name.toLowerCase() === 'ccofika' && password === 'maksimgej') {
      // Pokušaj da nađeš supervisor korisnika u bazi
      let supervisor = await Technician.findOne({
        $or: [
          { name: 'Supervisor', role: 'supervisor' },
          { name: 'Supervisor' } // Fallback za slučaj da supervisor postoji bez role
        ]
      });

      // Ako ne postoji, kreiraj ga
      if (!supervisor) {
        // Dodatno proveri da li postoji Supervisor sa bilo kojom ulogom
        const existingSupervisor = await Technician.findOne({ name: 'Supervisor' });

        if (existingSupervisor) {
          // Ako postoji Supervisor ali nije supervisor, ažuriraj ga
          existingSupervisor.role = 'supervisor';
          existingSupervisor.isAdmin = true;
          if (!await bcrypt.compare('maksimgej', existingSupervisor.password)) {
            existingSupervisor.password = await bcrypt.hash('maksimgej', 10);
          }
          supervisor = await existingSupervisor.save();
          console.log('Updated existing Supervisor to supervisor role');
        } else {
          // Kreiraj novog supervisor korisnika
          const hashedPassword = await bcrypt.hash('maksimgej', 10);

          supervisor = new Technician({
            name: 'Supervisor',
            password: hashedPassword,
            role: 'supervisor',
            isAdmin: true,
            gmail: '',
            profileImage: '',
            materials: [],
            equipment: []
          });

          await supervisor.save();
          console.log('Created supervisor user');
        }
      }

      const token = jwt.sign(
        { _id: supervisor._id, name: supervisor.name, role: 'supervisor' },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      console.log('Supervisor login successful');

      return res.json({
        message: 'Uspešno prijavljivanje',
        user: {
          _id: supervisor._id,
          name: supervisor.name,
          role: 'supervisor',
          gmail: supervisor.gmail,
          profileImage: supervisor.profileImage
        },
        token
      });
    }

    // Admin login - proveri da li postoji admin u bazi
    if (name.toLowerCase() === 'admin' && password === 'Robotik2023!') {
      // Pokušaj da nađeš admin korisnika u bazi
      let admin = await Technician.findOne({
        $or: [
          { name: 'Administrator', role: 'admin' },
          { name: 'Administrator' } // Fallback za slučaj da admin postoji bez role
        ]
      });

      // Ako ne postoji, kreiraj ga
      if (!admin) {
        // Dodatno proveri da li postoji Administrator sa bilo kojom ulogom
        const existingAdmin = await Technician.findOne({ name: 'Administrator' });

        if (existingAdmin) {
          // Ako postoji Administrator ali nije admin, ažuriraj ga
          existingAdmin.role = 'admin';
          existingAdmin.isAdmin = true;
          if (!await bcrypt.compare('Robotik2023!', existingAdmin.password)) {
            existingAdmin.password = await bcrypt.hash('Robotik2023!', 10);
          }
          admin = await existingAdmin.save();
          console.log('Updated existing Administrator to admin role');
        } else {
          // Kreiraj novog admin korisnika
          const hashedPassword = await bcrypt.hash('Robotik2023!', 10);

          admin = new Technician({
            name: 'Administrator',
            password: hashedPassword,
            role: 'admin',
            isAdmin: true,
            gmail: '',
            profileImage: '',
            materials: [],
            equipment: []
          });

          await admin.save();
          console.log('Created admin user');
        }
      }

      const token = jwt.sign(
        { _id: admin._id, name: admin.name, role: 'admin' },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      console.log('Admin login successful');

      return res.json({
        message: 'Uspešno prijavljivanje',
        user: {
          _id: admin._id,
          name: admin.name,
          role: 'admin',
          gmail: admin.gmail,
          profileImage: admin.profileImage
        },
        token
      });
    }
    
    // Traženje tehničara u bazi
    const technician = await Technician.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });

    if (!technician) {
      console.log('Technician not found');
      return res.status(401).json({ error: 'Neispravno korisničko ime ili lozinka' });
    }

    // Provera lozinke
    const validPassword = await bcrypt.compare(password, technician.password);
    if (!validPassword) {
      console.log('Invalid password');
      return res.status(401).json({ error: 'Neispravno korisničko ime ili lozinka' });
    }

    // Određivanje role iz baze podataka
    const userRole = technician.role || 'technician';

    // Kreiranje JWT tokena - koristi _id za admin/superadmin/supervisor, id za tehničare
    const tokenPayload = (userRole === 'admin' || userRole === 'superadmin' || userRole === 'supervisor')
      ? { _id: technician._id, name: technician.name, role: userRole }
      : { id: technician._id, name: technician.name, role: userRole };

    const token = jwt.sign(
      tokenPayload,
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Ne vraćamo lozinku
    const technicianResponse = technician.toObject();
    delete technicianResponse.password;

    console.log(`Login successful for ${technician.name} with role: ${userRole}`);

    res.json({
      message: 'Uspešno prijavljivanje',
      user: {
        ...technicianResponse,
        role: userRole
      },
      token
    });
  } catch (error) {
    console.error('Greška pri prijavljivanju:', error);
    res.status(500).json({ error: 'Greška pri prijavljivanju' });
  }
});

// POST - Refresh token endpoint (NO AUTH MIDDLEWARE - handles expired tokens internally)
router.post('/refresh-token', async (req, res) => {
  console.log('🔄 REFRESH TOKEN endpoint called at', new Date().toISOString());
  console.log('🔄 Request path:', req.path);
  console.log('🔄 Request originalUrl:', req.originalUrl);
  console.log('🔄 User-Agent:', req.get('User-Agent')?.substring(0, 50) + '...');

  try {
    const authHeader = req.header('Authorization');
    const token = authHeader && authHeader.replace('Bearer ', '');
    console.log('🔄 Token received:', token ? `${token.substring(0, 20)}...${token.substring(token.length - 10)}` : 'NO TOKEN');

    if (!token) {
      return res.status(401).json({ error: 'Token nije obezbeđen' });
    }

    // Pokušaj da verifikuješ token čak i ako je expired
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        // Dekodira expired token bez verifikacije
        decoded = jwt.decode(token);
      } else {
        return res.status(401).json({ error: 'Neispravan token' });
      }
    }

    if (!decoded) {
      return res.status(401).json({ error: 'Token se ne može dekodirati' });
    }

    let newToken;
    let userData;

    // SuperAdmin refresh
    if (decoded.role === 'superadmin') {
      const superadmin = await Technician.findById(decoded._id);
      if (!superadmin || superadmin.role !== 'superadmin') {
        return res.status(401).json({ error: 'SuperAdmin nije pronađen' });
      }

      newToken = jwt.sign(
        { _id: superadmin._id, name: superadmin.name, role: 'superadmin' },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      userData = {
        _id: superadmin._id,
        name: superadmin.name,
        role: 'superadmin',
        gmail: superadmin.gmail,
        profileImage: superadmin.profileImage
      };
    }
    // Supervisor refresh
    else if (decoded.role === 'supervisor') {
      const supervisor = await Technician.findById(decoded._id);
      if (!supervisor || supervisor.role !== 'supervisor') {
        return res.status(401).json({ error: 'Supervisor nije pronađen' });
      }

      newToken = jwt.sign(
        { _id: supervisor._id, name: supervisor.name, role: 'supervisor' },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      userData = {
        _id: supervisor._id,
        name: supervisor.name,
        role: 'supervisor',
        gmail: supervisor.gmail,
        profileImage: supervisor.profileImage
      };
    }
    // Admin refresh
    else if (decoded.role === 'admin') {
      const admin = await Technician.findById(decoded._id);
      if (!admin || admin.role !== 'admin') {
        return res.status(401).json({ error: 'Admin nije pronađen' });
      }

      newToken = jwt.sign(
        { _id: admin._id, name: admin.name, role: 'admin' },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      userData = {
        _id: admin._id,
        name: admin.name,
        role: 'admin',
        gmail: admin.gmail,
        profileImage: admin.profileImage
      };
    }
    // Technician refresh (or any other role not explicitly handled above)
    else {
      // Try to find by id first (for technicians), then by _id (for other roles)
      const technician = await Technician.findById(decoded.id || decoded._id);
      if (!technician) {
        return res.status(401).json({ error: 'Korisnik nije pronađen' });
      }

      // Use actual role from database
      const userRole = technician.role || 'technician';

      // Create token with appropriate ID field based on role
      const tokenPayload = (userRole === 'admin' || userRole === 'superadmin' || userRole === 'supervisor')
        ? { _id: technician._id, name: technician.name, role: userRole }
        : { id: technician._id, name: technician.name, role: userRole };

      newToken = jwt.sign(
        tokenPayload,
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      const technicianResponse = technician.toObject();
      delete technicianResponse.password;
      userData = {
        ...technicianResponse,
        role: userRole
      };
    }

    console.log('✅ Token successfully refreshed for user:', userData.name, 'role:', userData.role);

    res.json({
      message: 'Token je uspešno obnovljen',
      user: userData,
      token: newToken
    });

  } catch (error) {
    console.error('Greška pri obnovi tokena:', error);
    res.status(500).json({ error: 'Greška pri obnovi tokena' });
  }
});

// POST - Legacy refresh token endpoint (backward compatibility)
router.post('/refresh', async (req, res) => {
  // Redirect to new endpoint
  req.url = '/refresh-token';
  return router.handle(req, res);
});

module.exports = router;