const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Technician } = require('../models');

const JWT_SECRET = process.env.JWT_SECRET || 'telco-super-secret-key';

// POST - Login za tehničara
router.post('/login', async (req, res) => {
  try {
    console.log('Login attempt:', req.body);
    const { name, password } = req.body;
    
    if (!name || !password) {
      return res.status(400).json({ error: 'Korisničko ime i lozinka su obavezni' });
    }
    
    // Admin login - proveri da li postoji admin u bazi
    if (name.toLowerCase() === 'admin' && password === 'Robotik2023!') {
      // Pokušaj da nađeš admin korisnika u bazi
      let admin = await Technician.findOne({ name: 'Administrator', isAdmin: true });
      
      // Ako ne postoji, kreiraj ga
      if (!admin) {
        const hashedPassword = await bcrypt.hash('Robotik2023!', 10);
        
        admin = new Technician({
          name: 'Administrator',
          password: hashedPassword,
          isAdmin: true,
          gmail: '',
          profileImage: '',
          materials: [],
          equipment: []
        });
        
        await admin.save();
        console.log('Created admin user');
      }
      
      const token = jwt.sign(
        { _id: admin._id, name: admin.name, role: 'admin' },
        JWT_SECRET,
        { expiresIn: '365d' }
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
    
    // Kreiranje JWT tokena
    const token = jwt.sign(
      { id: technician._id, name: technician.name, role: 'technician' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    
    // Ne vraćamo lozinku
    const technicianResponse = technician.toObject();
    delete technicianResponse.password;
    
    console.log('Technician login successful');
    
    res.json({
      message: 'Uspešno prijavljivanje',
      user: {
        ...technicianResponse,
        role: 'technician'
      },
      token
    });
  } catch (error) {
    console.error('Greška pri prijavljivanju:', error);
    res.status(500).json({ error: 'Greška pri prijavljivanju' });
  }
});

module.exports = router;