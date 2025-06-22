const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const materialsFilePath = path.join(__dirname, '../data/materials.json');

// Middleware za čitanje materials.json fajla
const readMaterialsFile = () => {
  try {
    const data = fs.readFileSync(materialsFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Greška pri čitanju materijala:', error);
    return [];
  }
};

// Middleware za čuvanje materials.json fajla
const saveMaterialsFile = (data) => {
  try {
    fs.writeFileSync(materialsFilePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
    } catch (error) {
    console.error('Greška pri čuvanju materijala:', error);
    return false;
  }
};

// GET - Dohvati sve materijale
router.get('/', (req, res) => {
  const materials = readMaterialsFile();
  res.json(materials);
});

// GET - Dohvati materijal po ID-u
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const materials = readMaterialsFile();
  const material = materials.find(material => material.id === id);
  
  if (!material) {
    return res.status(404).json({ error: 'Materijal nije pronađen' });
  }
  
  res.json(material);
});

// POST - Dodaj novi materijal
router.post('/', (req, res) => {
  const { type, quantity } = req.body;
  
  if (!type || quantity === undefined) {
    return res.status(400).json({ error: 'Vrsta i količina materijala su obavezna polja' });
  }
  
  const materials = readMaterialsFile();
  
  // Provera da li materijal već postoji
  const existingMaterial = materials.find(material => 
    material.type.toLowerCase() === type.toLowerCase()
  );
  
  if (existingMaterial) {
    return res.status(400).json({ error: 'Materijal sa ovim nazivom već postoji' });
  }
  
  const newMaterial = {
    id: Date.now().toString(),
    type,
    quantity: parseInt(quantity, 10)
  };
  
  materials.push(newMaterial);
  saveMaterialsFile(materials);
  
  res.status(201).json(newMaterial);
});

// PUT - Ažuriranje materijala
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { type, quantity } = req.body;
  
  if ((!type && quantity === undefined) || parseInt(quantity, 10) < 0) {
    return res.status(400).json({ error: 'Neispravni podaci za ažuriranje' });
  }
  
  const materials = readMaterialsFile();
  const index = materials.findIndex(material => material.id === id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Materijal nije pronađen' });
  }
  
  // Provera da li drugi materijal već koristi ovaj naziv
  if (type && type !== materials[index].type) {
    const duplicateType = materials.find(material => 
      material.id !== id && material.type.toLowerCase() === type.toLowerCase()
    );
    
    if (duplicateType) {
      return res.status(400).json({ error: 'Materijal sa ovim nazivom već postoji' });
    }
  }
  
  materials[index] = { 
    ...materials[index],
    type: type || materials[index].type,
    quantity: quantity !== undefined ? parseInt(quantity, 10) : materials[index].quantity
  };
  
  saveMaterialsFile(materials);
  
  res.json(materials[index]);
});

// DELETE - Brisanje materijala
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const materials = readMaterialsFile();
  
  const filteredMaterials = materials.filter(material => material.id !== id);
  
  if (filteredMaterials.length === materials.length) {
    return res.status(404).json({ error: 'Materijal nije pronađen' });
  }
  
  saveMaterialsFile(filteredMaterials);
  
  res.json({ message: 'Materijal uspešno obrisan' });
});

module.exports = router;