const jwt = require('jsonwebtoken');
const { Technician } = require('../models');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET environment variable is not set!');
  process.exit(1);
}

const auth = async (req, res, next) => {
  try {
    // Dohvati token iz header-a
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Pristup odbijen. Token nije obezbeđen.' });
    }

    // Verifikuj token - za refresh endpoint dopusti i expired token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError' && (req.path === '/refresh' || req.originalUrl === '/api/auth/refresh')) {
        // Za refresh endpoint, dekodira expired token bez verifikacije
        decoded = jwt.decode(token);
        if (!decoded) {
          return res.status(401).json({ error: 'Token se ne može dekodirati.' });
        }
        // Nastavi sa obrađivanjem kao da je token važeći
      } else {
        console.error('Greška pri autentifikaciji:', error);
        return res.status(401).json({ error: 'Pristup odbijen. Neispravan token.' });
      }
    }
    
    // Ako je admin ili superadmin, propusti dalje
    if (decoded.role === 'admin' || decoded.role === 'superadmin') {
      req.user = {
        _id: decoded._id,
        id: decoded._id.toString(), // Dodaj id za konsistentnost
        name: decoded.name,
        role: decoded.role
      };
      return next();
    }
    
    // Ako je tehničar, proveri da li postoji u bazi
    const technician = await Technician.findById(decoded.id).select('-password');
    
    if (!technician) {
      return res.status(401).json({ error: 'Pristup odbijen. Tehničar nije pronađen.' });
    }
    
    // Dodaj tehničara u request
    req.user = {
      _id: technician._id.toString(),
      id: technician._id.toString(),
      name: technician.name,
      role: 'technician'
    };
    
    next();
  } catch (error) {
    console.error('Greška pri autentifikaciji:', error);
    res.status(401).json({ error: 'Pristup odbijen. Neispravan token.' });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'superadmin')) {
    return next();
  }

  return res.status(403).json({ error: 'Nemate dozvolu za pristup ovom resursu.' });
};

const isTechnicianOrAdmin = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'superadmin' || req.user.role === 'technician')) {
    return next();
  }

  return res.status(403).json({ error: 'Nemate dozvolu za pristup ovom resursu.' });
};

const isTechnicianOwner = (req, res, next) => {
  const requestedTechId = req.params.id || req.params.technicianId;

  if (req.user.role === 'admin' || req.user.role === 'superadmin') {
    return next();
  }

  if (req.user.role === 'technician' && (req.user._id === requestedTechId || req.user.id === requestedTechId)) {
    return next();
  }

  return res.status(403).json({ error: 'Nemate dozvolu za pristup tuđim podacima.' });
};

const isSuperAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'superadmin') {
    return next();
  }

  return res.status(403).json({ error: 'Pristup dozvoljen samo SuperAdmin korisnicima.' });
};

module.exports = {
  auth,
  isAdmin,
  isTechnicianOrAdmin,
  isTechnicianOwner,
  isSuperAdmin
};