const jwt = require('jsonwebtoken');
const { Technician } = require('../models');

const JWT_SECRET = process.env.JWT_SECRET || 'telco-super-secret-key';

const auth = async (req, res, next) => {
  try {
    console.log('=== AUTH MIDDLEWARE ===');
    
    // Dohvati token iz header-a
    const token = req.header('Authorization')?.replace('Bearer ', '');
    console.log('Token received:', token ? 'YES' : 'NO');
    
    if (!token) {
      console.log('No token provided');
      return res.status(401).json({ error: 'Pristup odbijen. Token nije obezbeđen.' });
    }
    
    // Verifikuj token
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('Token decoded:', decoded);
    
    // Ako je admin, propusti dalje
    if (decoded.role === 'admin') {
      req.user = {
        _id: decoded._id,
        id: decoded._id.toString(), // Dodaj id za konsistentnost
        name: decoded.name,
        role: 'admin'
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
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  
  return res.status(403).json({ error: 'Nemate dozvolu za pristup ovom resursu.' });
};

const isTechnicianOrAdmin = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'technician')) {
    return next();
  }
  
  return res.status(403).json({ error: 'Nemate dozvolu za pristup ovom resursu.' });
};

const isTechnicianOwner = (req, res, next) => {
  const requestedTechId = req.params.id || req.params.technicianId;
  
  if (req.user.role === 'admin') {
    return next();
  }
  
  if (req.user.role === 'technician' && (req.user._id === requestedTechId || req.user.id === requestedTechId)) {
    return next();
  }
  
  return res.status(403).json({ error: 'Nemate dozvolu za pristup tuđim podacima.' });
};

module.exports = {
  auth,
  isAdmin,
  isTechnicianOrAdmin,
  isTechnicianOwner
};