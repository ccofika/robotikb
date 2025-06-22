const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const techniciansFilePath = path.join(__dirname, '../data/technicians.json');

const JWT_SECRET = process.env.JWT_SECRET || 'telco-super-secret-key';

const readTechniciansFile = () => {
  try {
    const data = fs.readFileSync(techniciansFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Greška pri čitanju tehničara:', error);
    return [];
  }
};

const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Pristup odbijen. Token nije prosleđen.' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Neispravan ili istekao token.' });
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
  
  if (req.user.role === 'technician' && req.user.id === requestedTechId) {
    return next();
  }
  
  return res.status(403).json({ error: 'Nemate dozvolu za pristup tuđim podacima.' });
};

module.exports = {
  authenticateToken,
  isAdmin,
  isTechnicianOrAdmin,
  isTechnicianOwner
};