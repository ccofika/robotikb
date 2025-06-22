// Kreirati u direktorijumu: routes/users.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const usersFilePath = path.join(__dirname, '../data/users.json');
const workordersFilePath = path.join(__dirname, '../data/workorders.json');

// Middleware za čitanje users.json fajla
const readUsersFile = () => {
  try {
    if (fs.existsSync(usersFilePath)) {
      const data = fs.readFileSync(usersFilePath, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('Greška pri čitanju korisnika:', error);
    return [];
  }
};

// Middleware za čuvanje users.json fajla
const saveUsersFile = (data) => {
  try {
    fs.writeFileSync(usersFilePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Greška pri čuvanju korisnika:', error);
    return false;
  }
};

// Middleware za čitanje workorders.json fajla
const readWorkordersFile = () => {
  try {
    if (fs.existsSync(workordersFilePath)) {
      const data = fs.readFileSync(workordersFilePath, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('Greška pri čitanju radnih naloga:', error);
    return [];
  }
};

// GET - Dohvati sve korisnike
router.get('/', (req, res) => {
  const users = readUsersFile();
  res.json(users);
});

// GET - Dohvati korisnika po ID-u
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const users = readUsersFile();
  
  const user = users.find(user => user.id === id);
  
  if (!user) {
    return res.status(404).json({ error: 'Korisnik nije pronađen' });
  }
  
  res.json(user);
});

// GET - Dohvati korisnika po TIS ID-u
router.get('/tis/:tisId', (req, res) => {
  const { tisId } = req.params;
  const users = readUsersFile();
  
  const user = users.find(user => user.tisId === tisId);
  
  if (!user) {
    return res.status(404).json({ error: 'Korisnik nije pronađen' });
  }
  
  res.json(user);
});

// GET - Pretraži korisnike po bilo kom polju
router.get('/search/:term', (req, res) => {
  const { term } = req.params;
  const users = readUsersFile();
  
  const filteredUsers = users.filter(user => {
    return (
      user.name.toLowerCase().includes(term.toLowerCase()) ||
      user.address.toLowerCase().includes(term.toLowerCase()) ||
      user.phone.toLowerCase().includes(term.toLowerCase()) ||
      user.tisId.toString().includes(term)
    );
  });
  
  res.json(filteredUsers);
});

// GET - Dohvati radne naloge korisnika
router.get('/:id/workorders', (req, res) => {
  const { id } = req.params;
  const users = readUsersFile();
  const workOrders = readWorkordersFile();
  
  const user = users.find(user => user.id === id);
  
  if (!user) {
    return res.status(404).json({ error: 'Korisnik nije pronađen' });
  }
  
  const userWorkOrders = workOrders.filter(order => user.workOrders.includes(order.id));
  
  res.json(userWorkOrders);
});

// POST - Kreiraj novog korisnika
router.post('/', (req, res) => {
  const { tisId, name, address, phone } = req.body;
  
  if (!tisId || !name || !address) {
    return res.status(400).json({ error: 'TIS ID, ime i adresa su obavezni' });
  }
  
  const users = readUsersFile();
  
  // Provera da li već postoji korisnik sa datim TIS ID-om
  const existingUser = users.find(user => user.tisId === tisId);
  if (existingUser) {
    return res.status(400).json({ error: 'Korisnik sa datim TIS ID-om već postoji' });
  }
  
  const newUser = {
    id: Date.now().toString(),
    tisId,
    name,
    address,
    phone: phone || '',
    workOrders: []
  };
  
  users.push(newUser);
  saveUsersFile(users);
  
  res.status(201).json(newUser);
});

// PUT - Ažuriraj korisnika
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { tisId, name, address, phone } = req.body;
  
  const users = readUsersFile();
  const index = users.findIndex(user => user.id === id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Korisnik nije pronađen' });
  }
  
  // Ako se TIS ID menja, provera da li je jedinstven
  if (tisId && tisId !== users[index].tisId) {
    const duplicateTisId = users.some(user => user.tisId === tisId && user.id !== id);
    if (duplicateTisId) {
      return res.status(400).json({ error: 'TIS ID mora biti jedinstven' });
    }
  }
  
  users[index] = {
    ...users[index],
    tisId: tisId || users[index].tisId,
    name: name || users[index].name,
    address: address || users[index].address,
    phone: phone !== undefined ? phone : users[index].phone
  };
  
  saveUsersFile(users);
  
  res.json(users[index]);
});

// DELETE - Obriši korisnika
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const users = readUsersFile();
  
  const initialLength = users.length;
  const filteredUsers = users.filter(user => user.id !== id);
  
  if (filteredUsers.length === initialLength) {
    return res.status(404).json({ error: 'Korisnik nije pronađen' });
  }
  
  saveUsersFile(filteredUsers);
  
  res.json({ message: 'Korisnik uspešno obrisan' });
});

// POST - Dodaj radni nalog korisniku
router.post('/:id/workorders/:workOrderId', (req, res) => {
  const { id, workOrderId } = req.params;
  const users = readUsersFile();
  const workOrders = readWorkordersFile();
  
  const userIndex = users.findIndex(user => user.id === id);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'Korisnik nije pronađen' });
  }
  
  const workOrderExists = workOrders.some(order => order.id === workOrderId);
  if (!workOrderExists) {
    return res.status(404).json({ error: 'Radni nalog nije pronađen' });
  }
  
  if (!users[userIndex].workOrders.includes(workOrderId)) {
    users[userIndex].workOrders.push(workOrderId);
    saveUsersFile(users);
  }
  
  res.json(users[userIndex]);
});

// DELETE - Ukloni radni nalog sa korisnika
router.delete('/:id/workorders/:workOrderId', (req, res) => {
  const { id, workOrderId } = req.params;
  const users = readUsersFile();
  
  const userIndex = users.findIndex(user => user.id === id);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'Korisnik nije pronađen' });
  }
  
  users[userIndex].workOrders = users[userIndex].workOrders.filter(
    orderId => orderId !== workOrderId
  );
  
  saveUsersFile(users);
  
  res.json(users[userIndex]);
});

module.exports = router;