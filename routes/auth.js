const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const techniciansFilePath = path.join(__dirname, '../data/technicians.json');
const JWT_SECRET = process.env.JWT_SECRET || 'telco-super-secret-key';

// Middleware za čitanje technicians.json fajla
const readTechniciansFile = () => {
  try {
    const data = fs.readFileSync(techniciansFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Greška pri čitanju tehničara:', error);
    return [];
  }
};

// POST - Login za tehničara
router.post('/login', async (req, res) => {
  const { name, password } = req.body;
  
  if (!name || !password) {
    return res.status(400).json({ error: 'Korisničko ime i lozinka su obavezni' });
  }
  
  // Admin login za demo (u produkciji bi bio u bazi)
  if (name === 'admin' && password === 'admin') {
    const token = jwt.sign(
      { id: 'admin', name: 'Administrator', role: 'admin' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    return res.json({
      message: 'Uspešno prijavljivanje',
      user: {
        id: 'admin',
        name: 'Administrator',
        role: 'admin'
      },
      token
    });
  }
  
  const technicians = readTechniciansFile();
  const technician = technicians.find(tech => tech.name.toLowerCase() === name.toLowerCase());
  
  if (!technician) {
    return res.status(401).json({ error: 'Neispravno korisničko ime ili lozinka' });
  }
  
  // Provera lozinke
  const validPassword = await bcrypt.compare(password, technician.password);
  if (!validPassword) {
    return res.status(401).json({ error: 'Neispravno korisničko ime ili lozinka' });
  }
  
  // Kreiranje JWT tokena
  const token = jwt.sign(
    { id: technician.id, name: technician.name, role: 'technician' },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  
  // Ne vraćamo lozinku
  const { password: _, ...technicianWithoutPassword } = technician;
  
  res.json({
    message: 'Uspešno prijavljivanje',
    user: {
      ...technicianWithoutPassword,
      role: 'technician'
    },
    token
  });
});

module.exports = router;