// C:\Users\stefa\OneDrive\Desktop\transfer\server\routes\export.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const WorkOrderEvidence = require('../models/WorkOrderEvidence');

const workordersFilePath = path.join(__dirname, '../data/workorders.json');
const techniciansFilePath = path.join(__dirname, '../data/technicians.json');
const materialsFilePath = path.join(__dirname, '../data/materials.json');
const equipmentFilePath = path.join(__dirname, '../data/equipment.json');
const userEquipmentFilePath = path.join(__dirname, '../data/userEquipment.json');

// Helper funkcije za čitanje JSON fajlova
const readJSONFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error(`Greška pri čitanju fajla ${filePath}:`, error);
    return [];
  }
};

// Helper funkcija za filtriranje po datumu
const filterByDateRange = (items, startDate, endDate, dateField = 'date') => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999); // Uključuje ceo krajnji dan
  
  return items.filter(item => {
    const itemDate = new Date(item[dateField]);
    return itemDate >= start && itemDate <= end;
  });
};

// GET - Dohvati statistiku za izabrani period
router.get('/preview', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date i end date su obavezni' });
    }

    const workOrders = readJSONFile(workordersFilePath);
    const userEquipment = readJSONFile(userEquipmentFilePath);
    
    // Filtriranje po datumu
    const filteredWorkOrders = filterByDateRange(workOrders, startDate, endDate);
    const filteredEquipment = userEquipment.filter(item => {
      const installDate = new Date(item.installedAt);
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      return installDate >= start && installDate <= end;
    });

    // Brojanje jedinstvenih tehničara
    const technicians = new Set(filteredWorkOrders.map(wo => wo.technicianId).filter(Boolean)).size;
    
    // Skupljanje materijala
    const materialsCount = filteredWorkOrders.reduce((acc, wo) => {
      if (wo.usedMaterials && Array.isArray(wo.usedMaterials)) {
        return acc + wo.usedMaterials.length;
      }
      return acc;
    }, 0);

    res.json({
      workOrders: filteredWorkOrders.length,
      technicians: technicians,
      materials: materialsCount,
      equipment: filteredEquipment.length
    });
    
  } catch (error) {
    console.error('Greška pri generisanju statistike:', error);
    res.status(500).json({ error: 'Greška pri generisanju statistike' });
  }
});

// GET - Eksport korisničke opreme
router.get('/userequipment', (req, res) => {
  try {
    const equipmentData = readJSONFile(userEquipmentFilePath);
    
    // Kreiranje Workbook objekta
    const wb = xlsx.utils.book_new();
    
    // Priprema podataka za Excel
    const excelData = equipmentData.map(item => ({
      'ID Korisnika': item.userId,
      'Tip opreme': item.equipmentType,
      'Opis opreme': item.equipmentDescription,
      'Serijski broj': item.serialNumber,
      'Status': item.status === 'active' ? 'Aktivno' : 'Uklonjeno',
      'Stanje': item.condition === 'working' ? 'Ispravno' : 
                item.condition === 'defective' ? 'Neispravno' : '-',
      'Datum instalacije': new Date(item.installedAt).toLocaleDateString('sr-RS'),
      'Datum uklanjanja': item.removedAt ? new Date(item.removedAt).toLocaleDateString('sr-RS') : '-',
      'ID Radnog naloga': item.workOrderId,
      'ID Tehničara': item.technicianId,
      'ID Tehničara uklanjanja': item.removalTechnicianId || '-',
      'Razlog uklanjanja': item.removalReason || '-'
    }));
    
    // Kreiranje worksheeta
    const ws = xlsx.utils.json_to_sheet(excelData);
    
    // Dodavanje worksheeta u workbook
    xlsx.utils.book_append_sheet(wb, ws, 'Oprema Korisnika');
    
    // Generisanje Excel fajla i slanje kao response
    const excelBuffer = xlsx.write(wb, { bookType: 'xlsx', type: 'buffer' });
    
    res.setHeader('Content-Disposition', 'attachment; filename=oprema-korisnika.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(excelBuffer);
    
  } catch (error) {
    console.error('Greška pri eksportovanju korisničke opreme:', error);
    res.status(500).json({ error: 'Greška pri eksportovanju korisničke opreme' });
  }
});

// POST - Kreiranje Excel specifikacije
router.post('/specifikacija', (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date i end date su obavezni' });
    }

    const workOrders = readJSONFile(workordersFilePath);
    const technicians = readJSONFile(techniciansFilePath);
    const materials = readJSONFile(materialsFilePath);
    const equipment = readJSONFile(equipmentFilePath);

    // Filtriramo radne naloge po datumu
    const filteredWorkOrders = filterByDateRange(workOrders, startDate, endDate);

    if (filteredWorkOrders.length === 0) {
      return res.status(400).json({ error: 'Nema radnih naloga u izabranom periodu' });
    }

    // Kreiramo novi workbook
    const workbook = xlsx.utils.book_new();

    // ===== SHEET 1: Specifikacija radova =====
    const specRadovaData = [];
    
        // Header
    specRadovaData.push([]);
    specRadovaData.push([null, "Specifikacija radova:", `Instalacije L4 faza - Regija Beograd - Robotik montaža - ${new Date(startDate).toLocaleDateString('sr-RS')} do ${new Date(endDate).toLocaleDateString('sr-RS')}`]);
    specRadovaData.push([]);
    specRadovaData.push(["SAP Br. Usluge", "VRSTA RADA", "Jed. mere", "Količina", "Jed. cena (DIN)", "Ukupno (DIN)", "Napomena"]);
    
    // Grupišemo radne naloge po tipu
    const workOrdersByType = {};
    filteredWorkOrders.forEach(wo => {
      if (!workOrdersByType[wo.type]) {
        workOrdersByType[wo.type] = {
          count: 1,
          sapId: `S${Math.floor(1000 + Math.random() * 9000)}` // Simulacija SAP broja
        };
      } else {
        workOrdersByType[wo.type].count++;
      }
    });
    
    Object.entries(workOrdersByType).forEach(([type, data]) => {
      specRadovaData.push([
        data.sapId,
        type,
        "kom",
        data.count,
        1200.00, // Simulacija cene
        1200.00 * data.count,
        ""
      ]);
    });

    const wsSpecRadova = xlsx.utils.aoa_to_sheet(specRadovaData);
    xlsx.utils.book_append_sheet(workbook, wsSpecRadova, "Specifikacija radova");

    // ===== SHEET 2: Specifikacija instalacija =====
    const specInstalacijaData = [];
    
    // Header
    specInstalacijaData.push(["Specifikacija instalacija:", null, null, null, null, `Instalacije L4 faza - Regija Beograd - Robotik montaža - ${new Date(startDate).toLocaleDateString('sr-RS')} do ${new Date(endDate).toLocaleDateString('sr-RS')}`]);
    specInstalacijaData.push(["Instalater/izvođač:"]);
    specInstalacijaData.push([]);
    specInstalacijaData.push(["ID zahteva", "ID korisnika", "Korisnik", "Adresa", "Vrsta naloga", "Datum instalacije", "Mesto"]);
    
    // Dodajemo radne naloge
    filteredWorkOrders.forEach(wo => {
      const techName = wo.technicianId ? 
        technicians.find(t => t.id === wo.technicianId)?.name || wo.technicianId : '';
      
      specInstalacijaData.push([
        wo.tisJobId || wo.id,
        wo.tisId || '',
        wo.userName || '',
        wo.address || '',
        wo.type || '',
        new Date(wo.date).toLocaleDateString('sr-RS'),
        wo.municipality || ''
      ]);
    });

    const wsSpecInstalacija = xlsx.utils.aoa_to_sheet(specInstalacijaData);
    xlsx.utils.book_append_sheet(workbook, wsSpecInstalacija, "Specifikacija instalacija");

    // ===== SHEET 3: Spec. korisničke opreme =====
    const specKorisnickeOpremeData = [];
    
    // Header
    specKorisnickeOpremeData.push(["Specifikacija korisničke opreme:", null, null, `Instalacije L4 faza - Regija Beograd - Robotik montaža - ${new Date(startDate).toLocaleDateString('sr-RS')} do ${new Date(endDate).toLocaleDateString('sr-RS')}`]);
    specKorisnickeOpremeData.push(["Instalater/izvođač:"]);
    specKorisnickeOpremeData.push([]);
    specKorisnickeOpremeData.push([null, null, "ONT/HFC", "Hybrid", "Hybrid", "STB/CAM"]);
    specKorisnickeOpremeData.push(["ID korisnika", "Napomena", "Serijski broj", "Serijski broj", "Serijski broj", "Serijski broj"]);
    
    // Dodajemo opremu po korisniku
    filteredWorkOrders.forEach(wo => {
      if (wo.usedEquipment && Array.isArray(wo.usedEquipment)) {
        // Grupisanje opreme po kategorijama
        let ontSerial = '';
        let hybridSerial = '';
        let stbSerial = '';
        
        wo.usedEquipment.forEach(serialNumber => {
          const equip = equipment.find(e => e.serialNumber === serialNumber);
          if (equip) {
            if (equip.category === 'modem') {
              ontSerial = serialNumber;
            } else if (equip.category === 'hybrid') {
              hybridSerial = serialNumber;
            } else if (equip.category === 'stb' || equip.category === 'cam') {
              stbSerial = serialNumber;
            }
          }
        });
        
        specKorisnickeOpremeData.push([
          wo.tisId || '',
          wo.comment || '',
          ontSerial,
          'N/R',
          hybridSerial,
          stbSerial
        ]);
      }
    });

    const wsSpecKorisnickeOpreme = xlsx.utils.aoa_to_sheet(specKorisnickeOpremeData);
    xlsx.utils.book_append_sheet(workbook, wsSpecKorisnickeOpreme, "Specifikacija korisničke opreme");

    // ===== SHEET 4: Spec. demontirane opreme =====
    const specDemontiraneOpremeData = [];
    
    // Header
    specDemontiraneOpremeData.push(["Specifikacija demontirane korisničke opreme:", null, null, `Instalacije L4 faza - Regija Beograd - Robotik montaža - ${new Date(startDate).toLocaleDateString('sr-RS')} do ${new Date(endDate).toLocaleDateString('sr-RS')}`]);
    specDemontiraneOpremeData.push(["Instalater/izvođač:"]);
    specDemontiraneOpremeData.push([]);
    specDemontiraneOpremeData.push([null, null, "ONT/HFC", "Hybrid", "Hybrid", "STB/CAM"]);
    specDemontiraneOpremeData.push(["ID korisnika", "Napomena", "Serijski broj", "Serijski broj", "Serijski broj", "Serijski broj"]);
    
    // Dodajemo demontiranu opremu (simulacija - radni nalozi sa statusom zamene)
    filteredWorkOrders.filter(wo => wo.details && wo.details.includes('Zamena')).forEach(wo => {
      specDemontiraneOpremeData.push([
        wo.tisId || '',
        wo.comment || 'Demontirana oprema',
        'ONT_OLD_' + (wo.tisId || ''),
        'HYB_OLD_' + (wo.tisId || ''),
        '',
        'STB_OLD_' + (wo.tisId || '')
      ]);
    });

    const wsSpecDemontiraneOpreme = xlsx.utils.aoa_to_sheet(specDemontiraneOpremeData);
    xlsx.utils.book_append_sheet(workbook, wsSpecDemontiraneOpreme, "Spec. demontirane opreme");

        // ===== SHEET 5: Spec. materijala =====
    const specMaterijalaData = [];
    
    // Header
    specMaterijalaData.push([]);
    specMaterijalaData.push([null, null, "Specifikacija materijala:", `Instalacije L4 faza - Regija Beograd - Robotik montaža - ${new Date(startDate).toLocaleDateString('sr-RS')} do ${new Date(endDate).toLocaleDateString('sr-RS')}`]);
    specMaterijalaData.push([]);
    specMaterijalaData.push([null, "Šifra", "Naziv", "Jedinica mere", "Količina", "Napomena"]);
    
    // Skupljamo sve utrošene materijale
    const materijalStats = {};
    filteredWorkOrders.forEach(wo => {
      if (wo.usedMaterials && Array.isArray(wo.usedMaterials)) {
        wo.usedMaterials.forEach(usedMat => {
          const material = materials.find(m => m.id === usedMat.materialId);
          if (material) {
            const key = material.id;
            if (!materijalStats[key]) {
              materijalStats[key] = {
                sifra: `40${material.id.padStart(5, '0')}`,
                naziv: material.type,
                jedinicaMere: 'kom',
                kolicina: 0
              };
            }
            materijalStats[key].kolicina += usedMat.quantity || 1;
          }
        });
      }
    });

    // Dodajemo materijale u sheet
    Object.values(materijalStats).forEach(mat => {
      specMaterijalaData.push([
        null,
        mat.sifra,
        mat.naziv,
        mat.jedinicaMere,
        mat.kolicina,
        ''
      ]);
    });

    const wsSpecMaterijala = xlsx.utils.aoa_to_sheet(specMaterijalaData);
    xlsx.utils.book_append_sheet(workbook, wsSpecMaterijala, "Spec.materijala");

    // Generišemo Excel fajl
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    // Postavljamo headere za download
    const startDateStr = new Date(startDate).toLocaleDateString('sr-RS').replace(/\./g, '-');
    const endDateStr = new Date(endDate).toLocaleDateString('sr-RS').replace(/\./g, '-');
    const filename = `Specifikacija_${startDateStr}_do_${endDateStr}.xlsx`;
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);

  } catch (error) {
    console.error('Greška pri kreiranju Excel fajla:', error);
    res.status(500).json({ error: 'Greška pri kreiranju Excel fajla: ' + error.message });
  }
});

// POST - Kreiranje Excel tabele sa radnim nalozima
router.post('/tabela', async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date i end date su obavezni' });
    }

    // Učitavanje podataka
    const workOrders = readJSONFile(workordersFilePath);
    const technicians = readJSONFile(techniciansFilePath);
    const equipment = readJSONFile(equipmentFilePath);
    const userEquipment = readJSONFile(userEquipmentFilePath);

    // Filtriramo radne naloge po datumu
    const filteredWorkOrders = filterByDateRange(workOrders, startDate, endDate);

    if (filteredWorkOrders.length === 0) {
      return res.status(400).json({ error: 'Nema radnih naloga u izabranom periodu' });
    }

    // Kreiramo novi workbook
    const workbook = xlsx.utils.book_new();

    // Kreiranje tabelarnog prikaza
    const tabelaData = [];
    
    // Dodajemo header
    tabelaData.push(["Datum", "STATUS", "Napomena", "ID zahteva", "ID korisnika", "Vrsta Naloga", "Mesto", "Adresa", "Korisnik", "Napomena", "Status korisnika", "Tehničar 1", "Tehničar 2"]);

    // Za svaki radni nalog, dodajemo red u tabelu
    for (const workOrder of filteredWorkOrders) {
      // Formatiranje datuma
      let dateStr = '';
      try {
        const woDate = new Date(workOrder.date);
        if (!isNaN(woDate.getTime())) {
          const day = woDate.getDate().toString().padStart(2, '0');
          const month = (woDate.getMonth() + 1).toString().padStart(2, '0');
          const year = woDate.getFullYear();
          dateStr = `${day}.${month}.${year}`;
        }
      } catch (error) {
        console.error('Greška pri formatiranju datuma:', error);
        dateStr = workOrder.date || '';
      }
      
      // Nalazimo imena tehničara umesto ID-ova
      let tehnicar1 = '';
      if (workOrder.technicianId) {
        const tech = technicians.find(t => t.id === workOrder.technicianId);
        tehnicar1 = tech ? tech.name : workOrder.technicianId;
      }
      
      // Osnovne informacije o radnom nalogu
      const row = [
        dateStr,
        workOrder.status || '',
        workOrder.comment || '',
        workOrder.tisJobId || '',
        workOrder.tisId || '',
        workOrder.type || '',
        workOrder.municipality || '',
        workOrder.address || '',
        workOrder.userName || '',
        workOrder.additionalJobs || '',
        workOrder.details || '',
        tehnicar1,
        '' // Tehničar 2 (trenutno nemamo podatke)
      ];
      
            // Dodavanje opreme - koristimo funkciju za proveru trenutnog statusa
      // Povezujemo svaki radni nalog sa opremom koja je instalirana kroz njega
      const installedEquipment = userEquipment.filter(ue => ue.workOrderId === workOrder.id);
      
      // Definisanje kategorija opreme koje ćemo prikazati u tabelarnom pregledu
      const categories = ['modem', 'hybrid', 'stb', 'kartica', 'fiksni telefon'];
      
      // Za svaku kategoriju dodajemo kolone za serijski broj i N/R (ispravno/neispravno)
      for (const category of categories) {
        // Filtriramo opremu po kategoriji
        const categoryEquipment = installedEquipment.filter(ue => ue.equipmentType === category);
        
        if (categoryEquipment.length > 0) {
          // Pronalazimo prvi uređaj u ovoj kategoriji
          const item = categoryEquipment[0];
          
          // Proveravamo aktuelni status ovog uređaja
          const currentStatus = getEquipmentCurrentStatus(userEquipment, workOrder.tisId, item.serialNumber);
          
          // Dodajemo podatke u red samo ako je uređaj trenutno aktivan
          if (currentStatus && currentStatus.status === 'active') {
            row.push(item.serialNumber); // Serijski broj
            row.push(item.condition === 'working' ? 'N' : 'R'); // N/R (ispravno/neispravno)
          } else {
            row.push(''); // Nema serijskog broja
            row.push(''); // Nema statusa
          }
        } else {
          row.push(''); // Nema serijskog broja za ovu kategoriju
          row.push(''); // Nema statusa za ovu kategoriju
        }
      }
      
      // Dodavanje demontirane opreme
      // Oprema uklonjena kroz ovaj radni nalog
      const removedEquipment = userEquipment.filter(ue => ue.removalWorkOrderId === workOrder.id);
      
      // Pronalazimo prvi uklonjeni uređaj koji je STVARNO uklonjen (nije kasnije ponovo instaliran)
      let showRemovedItem = false;
      let removedItem = null;
      
      for (const item of removedEquipment) {
        // Proveravamo aktuelno stanje ovog uređaja
        const currentStatus = getEquipmentCurrentStatus(userEquipment, workOrder.tisId, item.serialNumber);
        
        // Ako je uređaj stvarno uklonjen (nema novijeg zapisa sa 'active' statusom)
        if (currentStatus && currentStatus.status === 'removed') {
          removedItem = item;
          showRemovedItem = true;
          break; // Uzimamo samo prvi koji je stvarno uklonjen
        }
      }
      
      // Dodajemo demontiranu opremu samo ako je stvarno uklonjena
      if (showRemovedItem && removedItem) {
        row.push(removedItem.serialNumber); // Serijski broj
        row.push(removedItem.condition === 'working' ? 'N' : 'R'); // N/R (ispravno/neispravno)
      } else {
        row.push(''); // Nema demontirane opreme
        row.push(''); // Nema statusa demontirane opreme
      }
      
      // Dodajemo red u tabelu
      tabelaData.push(row);
    }

    // Kreiranje worksheeta i dodavanje podataka
    const wsTabelarni = xlsx.utils.aoa_to_sheet([]);
    
    // Dodavanje praznih redova za specifikaciju i header-e
    xlsx.utils.sheet_add_aoa(wsTabelarni, [[]], { origin: "A1" });
    xlsx.utils.sheet_add_aoa(wsTabelarni, [[null, null, null, null, null, null, null, "Specifikacija instalala"]], { origin: "A2" });
    xlsx.utils.sheet_add_aoa(wsTabelarni, [[null, null, null, null, null, null, null, "#REF!"]], { origin: "A3" });
    
    // Dodavanje header-a za kategorije opreme
    xlsx.utils.sheet_add_aoa(wsTabelarni, [[null, null, null, null, null, null, null, null, null, null, null, null, null, "ONT/HFC", null, "Hybrid", null, "STB/CAM", null, "STB/CAM", null, "STB/CAM", null, "Kartica", null, "Kartica", null, "DEMONT. N-ispravno,R-neispravno", null]], { origin: "A4" });
    
    // Dodavanje podheader-a za serijske brojeve i N/R
    const subHeader = [null, null, null, null, null, null, null, null, null, null, null, null, null, "Serijski broj", "N/R", "Serijski broj", "N/R", "Serijski broj", "N/R", "Serijski broj", "N/R", "Serijski broj", "N/R", "Serijski broj", "N/R", "Serijski broj", "N/R"];
    xlsx.utils.sheet_add_aoa(wsTabelarni, [subHeader], { origin: "A5" });
    
    // Dodavanje glavnih podataka
    xlsx.utils.sheet_add_aoa(wsTabelarni, tabelaData, { origin: "A6" });

    // Spajanje ćelija za zaglavlje kategorija
    if (!wsTabelarni['!merges']) wsTabelarni['!merges'] = [];
    
    // Spajanje ćelija za kategorije opreme
    // ONT/HFC
    wsTabelarni['!merges'].push({ s: { r: 3, c: 13 }, e: { r: 3, c: 14 } });
    // Hybrid
    wsTabelarni['!merges'].push({ s: { r: 3, c: 15 }, e: { r: 3, c: 16 } });
    // STB/CAM (3 kolone)
    wsTabelarni['!merges'].push({ s: { r: 3, c: 17 }, e: { r: 3, c: 18 } });
    wsTabelarni['!merges'].push({ s: { r: 3, c: 19 }, e: { r: 3, c: 20 } });
    wsTabelarni['!merges'].push({ s: { r: 3, c: 21 }, e: { r: 3, c: 22 } });
    // Kartica (2 kolone)
    wsTabelarni['!merges'].push({ s: { r: 3, c: 23 }, e: { r: 3, c: 24 } });
    wsTabelarni['!merges'].push({ s: { r: 3, c: 25 }, e: { r: 3, c: 26 } });
    // Demontirana oprema
        // Demontirana oprema
    wsTabelarni['!merges'].push({ s: { r: 3, c: 27 }, e: { r: 3, c: 28 } });
    
    // Dodajemo boje redovima prema statusu
    const colsInRow = 30; // Procenjeni broj kolona u redu
    
    for (let i = 0; i < tabelaData.length; i++) {
      const rowIndex = i + 6; // Redovi podataka počinju od A6
      const status = tabelaData[i][1]; // STATUS je druga kolona
      
      if (status === 'ZAVRŠENO' || status === 'zavrsen') {
        // Zelena boja za završene naloge
        for (let j = 0; j < colsInRow; j++) {
          const cellAddress = xlsx.utils.encode_cell({ r: rowIndex - 1, c: j });
          if (!wsTabelarni[cellAddress]) wsTabelarni[cellAddress] = { v: '' };
          if (!wsTabelarni[cellAddress].s) wsTabelarni[cellAddress].s = {};
          wsTabelarni[cellAddress].s.fill = { fgColor: { rgb: '90EE90' } }; // Svetlo zelena
        }
      }
      else if (status === 'NIJE ZAVRŠENO' || status === 'nezavrsen') {
        // Crvena boja za nezavršene naloge
        for (let j = 0; j < colsInRow; j++) {
          const cellAddress = xlsx.utils.encode_cell({ r: rowIndex - 1, c: j });
          if (!wsTabelarni[cellAddress]) wsTabelarni[cellAddress] = { v: '' };
          if (!wsTabelarni[cellAddress].s) wsTabelarni[cellAddress].s = {};
          wsTabelarni[cellAddress].s.fill = { fgColor: { rgb: 'FF6347' } }; // Tomato crvena
        }
      }
    }

    // Postavljanje širine kolona
    const defaultColWidth = 15;
    wsTabelarni['!cols'] = Array(colsInRow).fill({ width: defaultColWidth });
    
    // Dodavanje worksheeta u workbook
    xlsx.utils.book_append_sheet(workbook, wsTabelarni, "Tabelarni pregled");

    // Generisanje Excel fajla
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    // Postavljamo headere za download
    const startDateStr = new Date(startDate).toLocaleDateString('sr-RS').replace(/\./g, '-');
    const endDateStr = new Date(endDate).toLocaleDateString('sr-RS').replace(/\./g, '-');
    const filename = `Tabela_${startDateStr}_do_${endDateStr}.xlsx`;
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
    
  } catch (error) {
    console.error('Greška pri generisanju tabelarnog prikaza:', error);
    res.status(500).json({ 
      error: 'Greška pri generisanju tabelarnog prikaza: ' + error.message
    });
  }
});

// GET - Preuzimanje šablona za upload radnih naloga
router.get('/template', (req, res) => {
  try {
    const templatePath = path.join(__dirname, '../templates/workorders-template.xlsx');
    
    // Ako šablon ne postoji, kreiramo ga
    if (!fs.existsSync(templatePath)) {
      const workbook = xlsx.utils.book_new();
      const data = [
        {
          "Tehnicar 1": "Ime tehničara",
          "Tehnicar 2": "",
          "Područje": "BORČA",
          "Početak instalacije": "31/05/2023 12:00",
          "Tehnologija": "HFC",
          "TIS ID korisnika": "904317",
          "Adresa korisnika": "Beograd,BORČA,OBROVAČKA 9",
          "Ime korisnika": "PETAR ĐUKIĆ",
          "Kontakt telefon 1": "0642395394",
          "TIS Posao ID": "629841530",
          "Paket": "Dodatni STB/CA - Kabl TV",
          "Dodatni poslovi": "629841530,Dodatni STB/CA - Kabl TV",
          "Tip zahteva": "Zamena uređaja"
        }
      ];
      
      const worksheet = xlsx.utils.json_to_sheet(data);
      xlsx.utils.book_append_sheet(workbook, worksheet, "Radni Nalozi");
      
      // Kreiramo direktorijum ako ne postoji
      const dir = path.dirname(templatePath);
      if (!fs.existsSync(dir)){
        fs.mkdirSync(dir, { recursive: true });
      }
      
      xlsx.writeFile(workbook, templatePath);
    }
    
    res.download(templatePath, 'radni-nalozi-sablon.xlsx');
  } catch (error) {
    console.error('Greška pri preuzimanju šablona:', error);
    res.status(500).json({ error: 'Greška pri preuzimanju šablona: ' + error.message });
  }
});

// POST - Kreiranje Excel evidencije (na osnovu primera evidencija.xlsx)
router.post('/evidencija', (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date i end date su obavezni' });
    }

    const workOrders = readJSONFile(workordersFilePath);
    const technicians = readJSONFile(techniciansFilePath);
    const equipment = readJSONFile(equipmentFilePath);
    const userEquipment = readJSONFile(userEquipmentFilePath);

    // Filtriramo radne naloge po datumu
    const filteredWorkOrders = filterByDateRange(workOrders, startDate, endDate);

    if (filteredWorkOrders.length === 0) {
      return res.status(400).json({ error: 'Nema radnih naloga u izabranom periodu' });
    }

    // Kreiramo novi workbook
    const workbook = xlsx.utils.book_new();

    // Priprema podataka za evidenciju
    const evidencijaData = [];
    
    // Header red 1 - prazan
    evidencijaData.push([]);
    
    // Header red 2 - naslov i kategorije opreme
    evidencijaData.push([
      null, null, null, null, null, null,
      'Spcifikacija instalacija:',
      'Instalacije - Regija Beograd',
      null, null, null, null, null,
      'ONT/HFC', null,
      'Hybrid', null,
      'STB/CAM', null,
      'STB/CAM', null,
      'STB/CAM', null,
      'Kartica', null,
      'Kartica', null,
      'Kartica', null,
      'Mini node', null,
      'DEMONT, N-ispravno,R-neispravno'
    ]);
    
    // Header red 3 - prazan
    evidencijaData.push([]);
    
    // Header red 4 - kolone
    evidencijaData.push([
      'Datum', 'STATUS', 'Napomena', 'ID zahteva', 'ID korisnika', 'Vrsta Naloga',
      'Mesto', 'Adresa', 'Korisnik', 'Napomena', 'Status korisnika',
      'Tehnicar 1', 'Tehnicar 2',
      'Serijski broj', 'N/R',  // ONT/HFC
      'Serijski broj', 'N/R',  // Hybrid
      'Serijski broj', 'N/R',  // STB/CAM 1
      'Serijski broj', 'N/R',  // STB/CAM 2
      'Serijski broj', 'N/R',  // STB/CAM 3
      'Serijski broj', 'N/R',  // Kartica 1
      'Serijski broj', 'N/R',  // Kartica 2
      'Serijski broj', 'N/R',  // Kartica 3
      'Serijski broj', 'N/R',  // Mini node
      'Serijski broj', 'N/R'   // Demontaža
    ]);

    // Dodavanje podataka za svaki radni nalog
    filteredWorkOrders.forEach(workOrder => {
      // Konvertujemo datum u Excel format (broj dana od 1900-01-01)
      const excelDate = Math.floor((new Date(workOrder.date) - new Date('1900-01-01')) / (24 * 60 * 60 * 1000)) + 1;
      
      // Pronalaženje tehničara po ID-u
      const technician1 = workOrder.technicianId ? technicians.find(t => t.id === workOrder.technicianId) : null;
      const technician2 = workOrder.technicianId2 ? technicians.find(t => t.id === workOrder.technicianId2) : null;
      
      // Izvlačenje prvе reči iz adrese za mesto
      const mesto = workOrder.address ? workOrder.address.split(' ')[0] : '';
      
      // Osnovni podaci
      const row = [
        excelDate,                                    // Datum
        workOrder.status === 'completed' ? 'ZAVRŠENO' : 'NIJE ZAVRŠENO', // STATUS
        workOrder.comment || '',                     // Napomena (workOrder.comment)
        workOrder.tisId || '',                       // ID zahteva (workOrder.tisId) 
        workOrder.tisId || '',                       // ID korisnika (workOrder.tisId)
        '',                                          // Vrsta Naloga (prazno)
        mesto,                                       // Mesto (prva reč iz address)
        workOrder.address || '',                     // Adresa
        workOrder.userName || '',                    // Korisnik (workOrder.userName)
        workOrder.type || '',                        // Napomena (workOrder.type)
        workOrder.details || '',                     // Status korisnika (workOrder.details)
        technician1 ? technician1.name : '',         // Tehnicar 1 (iz technicians tabele)
        technician2 ? technician2.name : ''          // Tehnicar 2 (iz technicians tabele)
      ];

      // Pronalaženje instalirane opreme za ovaj radni nalog
      const installedEquipment = userEquipment.filter(ue => 
        ue.workOrderId === workOrder.id && ue.status === 'active'
      );

      // Mapiranje kategorija opreme prema evidenciji
      const equipmentCategories = {
        'modem': { columns: [13, 14], name: 'ONT/HFC' },
        'hybrid': { columns: [15, 16], name: 'Hybrid' },
        'stb': { columns: [[17, 18], [19, 20], [21, 22]], name: 'STB/CAM' },
        'cam': { columns: [[23, 24], [25, 26], [27, 28]], name: 'Kartica' },
        'mini nod': { columns: [29, 30], name: 'Mini node' }
      };

      // Dodavanje opreme u odgovarajuće kolone
      Object.keys(equipmentCategories).forEach(category => {
        const categoryEquipment = installedEquipment.filter(ue => ue.equipmentType === category);

        const categoryConfig = equipmentCategories[category];
        
        if (Array.isArray(categoryConfig.columns[0])) {
          // Više kolona za kategoriju (STB/CAM, Kartica)
          categoryConfig.columns.forEach((colPair, index) => {
            if (categoryEquipment[index]) {
              row[colPair[0]] = categoryEquipment[index].serialNumber || '';
              row[colPair[1]] = categoryEquipment[index].condition === 'working' ? 'N' : 'R';
            } else {
              row[colPair[0]] = '';
              row[colPair[1]] = '';
            }
          });
        } else {
          // Jedna kolona za kategoriju (ONT/HFC, Hybrid, Mini node)
          if (categoryEquipment[0]) {
            row[categoryConfig.columns[0]] = categoryEquipment[0].serialNumber || '';
            row[categoryConfig.columns[1]] = categoryEquipment[0].condition === 'working' ? 'N' : 'R';
          } else {
            row[categoryConfig.columns[0]] = '';
            row[categoryConfig.columns[1]] = '';
          }
        }
      });

      // Dodavanje demontirane opreme
      const removedEquipment = userEquipment.filter(ue => 
        ue.removalWorkOrderId === workOrder.id && ue.status === 'removed'
      );
      
      if (removedEquipment[0]) {
        row[31] = removedEquipment[0].serialNumber || '';
        row[32] = removedEquipment[0].condition === 'working' ? 'N' : 'R';
      } else {
        row[31] = '';
        row[32] = '';
      }

      evidencijaData.push(row);
    });

    // Kreiranje worksheeta
    const ws = xlsx.utils.aoa_to_sheet(evidencijaData);

    // Spajanje ćelija za zaglavlje
    if (!ws['!merges']) ws['!merges'] = [];
    
    // Spajanje ćelija za "Specifikacija instalacija"
    ws['!merges'].push({ s: { r: 1, c: 6 }, e: { r: 1, c: 7 } });
    
    // Spajanje ćelija za kategorije opreme
    ws['!merges'].push({ s: { r: 1, c: 13 }, e: { r: 1, c: 14 } }); // ONT/HFC
    ws['!merges'].push({ s: { r: 1, c: 15 }, e: { r: 1, c: 16 } }); // Hybrid
    ws['!merges'].push({ s: { r: 1, c: 17 }, e: { r: 1, c: 18 } }); // STB/CAM 1
    ws['!merges'].push({ s: { r: 1, c: 19 }, e: { r: 1, c: 20 } }); // STB/CAM 2
    ws['!merges'].push({ s: { r: 1, c: 21 }, e: { r: 1, c: 22 } }); // STB/CAM 3
    ws['!merges'].push({ s: { r: 1, c: 23 }, e: { r: 1, c: 24 } }); // Kartica 1
    ws['!merges'].push({ s: { r: 1, c: 25 }, e: { r: 1, c: 26 } }); // Kartica 2
    ws['!merges'].push({ s: { r: 1, c: 27 }, e: { r: 1, c: 28 } }); // Kartica 3
    ws['!merges'].push({ s: { r: 1, c: 29 }, e: { r: 1, c: 30 } }); // Mini node
    ws['!merges'].push({ s: { r: 1, c: 31 }, e: { r: 1, c: 32 } }); // Demontaža

    // Postavljanje širine kolona
    const colWidths = [
      { width: 12 }, // Datum
      { width: 15 }, // STATUS
      { width: 30 }, // Napomena
      { width: 12 }, // ID zahteva
      { width: 12 }, // ID korisnika
      { width: 15 }, // Vrsta Naloga
      { width: 15 }, // Mesto
      { width: 40 }, // Adresa
      { width: 25 }, // Korisnik
      { width: 40 }, // Napomena
      { width: 15 }, // Status korisnika
      { width: 15 }, // Tehnicar 1
      { width: 15 }, // Tehnicar 2
      // Oprema kolone
      ...Array(20).fill({ width: 18 }) // 20 kolona za opremu
    ];
    ws['!cols'] = colWidths;

    // Dodavanje worksheeta u workbook
    xlsx.utils.book_append_sheet(workbook, ws, "SPECIFIKACIJA RADOVA");

    // Generisanje Excel fajla
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    // Postavljamo headere za download
    const startDateStr = new Date(startDate).toLocaleDateString('sr-RS');
    const filename = `${startDateStr}.evidencija.xlsx`;
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
    
  } catch (error) {
    console.error('Greška pri generisanju evidencije:', error);
    res.status(500).json({ 
      error: 'Greška pri generisanju evidencije: ' + error.message
    });
  }
});

// Funkcija koja proverava aktuelni status opreme kod korisnika
const getEquipmentCurrentStatus = (userEquipment, userId, serialNumber) => {
  if (!userId || !serialNumber) return null;
  
  // Pronalazimo sve zapise za ovaj uređaj kod korisnika
  const equipmentHistory = userEquipment
    .filter(ue => ue.userId === userId && ue.serialNumber === serialNumber)
    .sort((a, b) => {
      // Za aktivne uređaje koristimo installedAt, za uklonjene removedAt
      const dateA = a.status === 'active' ? new Date(a.installedAt) : new Date(a.removedAt || 0);
      const dateB = b.status === 'active' ? new Date(b.installedAt) : new Date(b.removedAt || 0);
      return dateB - dateA; // Sortiranje po datumu, najnoviji prvi
    });
  
  // Ako nema istorije, vraćamo null
  if (equipmentHistory.length === 0) return null;
  
  // Vraćamo najnoviji zapis
  return equipmentHistory[0];
};

// GET - Dohvati statistiku za izabrani period iz WorkOrderEvidence
router.get('/evidence-preview', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date i end date su obavezni' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // Filtriranje WorkOrderEvidence po datumu
    const evidenceRecords = await WorkOrderEvidence.find({
      executionDate: {
        $gte: start,
        $lte: end
      }
    });

    // Brojanje jedinstvenih tehničara
    const technicians = new Set();
    evidenceRecords.forEach(record => {
      if (record.technician1) technicians.add(record.technician1);
      if (record.technician2) technicians.add(record.technician2);
    });
    
    // Skupljanje instalirane opreme
    const totalInstalledEquipment = evidenceRecords.reduce((acc, record) => {
      return acc + (record.installedEquipment ? record.installedEquipment.length : 0);
    }, 0);

    // Skupljanje uklonjene opreme
    const totalRemovedEquipment = evidenceRecords.reduce((acc, record) => {
      return acc + (record.removedEquipment ? record.removedEquipment.length : 0);
    }, 0);

    res.json({
      workOrders: evidenceRecords.length,
      technicians: technicians.size,
      materials: 0, // Nema direktno materijale u WorkOrderEvidence
      equipment: totalInstalledEquipment + totalRemovedEquipment
    });
    
  } catch (error) {
    console.error('Greška pri generisanju WorkOrderEvidence statistike:', error);
    res.status(500).json({ error: 'Greška pri generisanju statistike' });
  }
});

// POST - Kreiranje Excel evidencije iz WorkOrderEvidence podataka
router.post('/evidencija-new', async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date i end date su obavezni' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // Dohvatanje WorkOrderEvidence podataka
    const evidenceRecords = await WorkOrderEvidence.find({
      executionDate: {
        $gte: start,
        $lte: end
      }
    }).sort({ executionDate: 1 });

    if (evidenceRecords.length === 0) {
      return res.status(400).json({ error: 'Nema radnih naloga u izabranom periodu' });
    }

    // Kreiramo novi workbook
    const workbook = xlsx.utils.book_new();

    // Priprema podataka za evidenciju
    const evidencijaData = [];
    
    // Header red 1 - prazan
    evidencijaData.push([]);
    
    // Header red 2 - naslov i kategorije opreme
    evidencijaData.push([
      null, null, null, null, null, null,
      'Spcifikacija instalacija:',
      'Instalacije - Regija Beograd',
      null, null, null, null, null,
      'ONT/HFC', null,
      'Hybrid', null,
      'STB/CAM', null,
      'STB/CAM', null,
      'STB/CAM', null,
      'Kartica', null,
      'Kartica', null,
      'Kartica', null,
      'Mini node', null,
      'DEMONT, N-ispravno,R-neispravno'
    ]);
    
    // Header red 3 - prazan
    evidencijaData.push([]);
    
    // Header red 4 - kolone
    evidencijaData.push([
      'Datum', 'STATUS', 'Napomena', 'ID zahteva', 'ID korisnika', 'Vrsta Naloga',
      'Mesto', 'Adresa', 'Korisnik', 'Napomena', 'Status korisnika',
      'Tehnicar 1', 'Tehnicar 2',
      'Serijski broj', 'N/R',  // ONT/HFC
      'Serijski broj', 'N/R',  // Hybrid
      'Serijski broj', 'N/R',  // STB/CAM 1
      'Serijski broj', 'N/R',  // STB/CAM 2
      'Serijski broj', 'N/R',  // STB/CAM 3
      'Serijski broj', 'N/R',  // Kartica 1
      'Serijski broj', 'N/R',  // Kartica 2
      'Serijski broj', 'N/R',  // Kartica 3
      'Serijski broj', 'N/R',  // Mini node
      'Serijski broj', 'N/R'   // Demontaža
    ]);

    // Dodavanje podataka za svaki WorkOrderEvidence zapis
    evidenceRecords.forEach(evidence => {
      // Konvertujemo datum u Excel format (broj dana od 1900-01-01)
      const excelDate = Math.floor((new Date(evidence.executionDate) - new Date('1900-01-01')) / (24 * 60 * 60 * 1000)) + 1;
      
      // Osnovni podaci
      const row = [
        excelDate,                                    // Datum
        evidence.status || 'U TOKU',                  // STATUS
        evidence.notes || '',                         // Napomena
        evidence.tisJobId || '',                      // ID zahteva
        evidence.tisId || '',                         // ID korisnika
        evidence.orderType || '',                     // Vrsta Naloga
        evidence.municipality || '',                  // Mesto
        evidence.address || '',                       // Adresa
        evidence.customerName || '',                  // Korisnik
        evidence.servicePackage || '',                // Napomena (servicePackage)
        evidence.customerStatus || '',                // Status korisnika
        evidence.technician1 || '',                   // Tehnicar 1
        evidence.technician2 || ''                    // Tehnicar 2
      ];

      // Kreiranje mapiranja za kategorije opreme sa više slotova
      const equipmentSlots = {
        'ONT/HFC': { startIndex: 13, maxSlots: 1, equipment: [] },
        'Hybrid': { startIndex: 15, maxSlots: 1, equipment: [] },
        'STB/CAM': { startIndex: 17, maxSlots: 3, equipment: [] },
        'Kartica': { startIndex: 23, maxSlots: 3, equipment: [] },
        'Mini node': { startIndex: 29, maxSlots: 1, equipment: [] }
      };

      // Popunjavanje instaliranih uređaja
      if (evidence.installedEquipment && evidence.installedEquipment.length > 0) {
        evidence.installedEquipment.forEach(equipment => {
          const category = equipment.equipmentType;
          if (equipmentSlots[category]) {
            equipmentSlots[category].equipment.push({
              serialNumber: equipment.serialNumber || '',
              condition: equipment.condition || 'N'
            });
          }
        });
      }

      // Dodavanje uređaja u odgovarajuće kolone
      Object.keys(equipmentSlots).forEach(category => {
        const slot = equipmentSlots[category];
        for (let i = 0; i < slot.maxSlots; i++) {
          const equipmentIndex = slot.startIndex + (i * 2);
          const conditionIndex = equipmentIndex + 1;
          
          if (slot.equipment[i]) {
            row[equipmentIndex] = slot.equipment[i].serialNumber;
            row[conditionIndex] = slot.equipment[i].condition;
          } else {
            row[equipmentIndex] = '';
            row[conditionIndex] = '';
          }
        }
      });

      // Dodavanje demontirane opreme (samo prva stavka)
      if (evidence.removedEquipment && evidence.removedEquipment.length > 0) {
        const firstRemoved = evidence.removedEquipment[0];
        row[31] = firstRemoved.serialNumber || '';
        row[32] = firstRemoved.condition || 'R';
      } else {
        row[31] = '';
        row[32] = '';
      }

      evidencijaData.push(row);
    });

    // Kreiranje worksheeta
    const ws = xlsx.utils.aoa_to_sheet(evidencijaData);

    // Spajanje ćelija za zaglavlje
    if (!ws['!merges']) ws['!merges'] = [];
    
    // Spajanje ćelija za "Specifikacija instalacija"
    ws['!merges'].push({ s: { r: 1, c: 6 }, e: { r: 1, c: 7 } });
    
    // Spajanje ćelija za kategorije opreme
    ws['!merges'].push({ s: { r: 1, c: 13 }, e: { r: 1, c: 14 } }); // ONT/HFC
    ws['!merges'].push({ s: { r: 1, c: 15 }, e: { r: 1, c: 16 } }); // Hybrid
    ws['!merges'].push({ s: { r: 1, c: 17 }, e: { r: 1, c: 18 } }); // STB/CAM 1
    ws['!merges'].push({ s: { r: 1, c: 19 }, e: { r: 1, c: 20 } }); // STB/CAM 2
    ws['!merges'].push({ s: { r: 1, c: 21 }, e: { r: 1, c: 22 } }); // STB/CAM 3
    ws['!merges'].push({ s: { r: 1, c: 23 }, e: { r: 1, c: 24 } }); // Kartica 1
    ws['!merges'].push({ s: { r: 1, c: 25 }, e: { r: 1, c: 26 } }); // Kartica 2
    ws['!merges'].push({ s: { r: 1, c: 27 }, e: { r: 1, c: 28 } }); // Kartica 3
    ws['!merges'].push({ s: { r: 1, c: 29 }, e: { r: 1, c: 30 } }); // Mini node
    ws['!merges'].push({ s: { r: 1, c: 31 }, e: { r: 1, c: 32 } }); // Demontaža

    // Postavljanje širine kolona
    const colWidths = [
      { width: 12 }, // Datum
      { width: 15 }, // STATUS
      { width: 30 }, // Napomena
      { width: 12 }, // ID zahteva
      { width: 12 }, // ID korisnika
      { width: 15 }, // Vrsta Naloga
      { width: 15 }, // Mesto
      { width: 40 }, // Adresa
      { width: 25 }, // Korisnik
      { width: 40 }, // Napomena
      { width: 15 }, // Status korisnika
      { width: 15 }, // Tehnicar 1
      { width: 15 }, // Tehnicar 2
      // Oprema kolone
      ...Array(20).fill({ width: 18 }) // 20 kolona za opremu
    ];
    ws['!cols'] = colWidths;

    // Dodavanje worksheeta u workbook
    xlsx.utils.book_append_sheet(workbook, ws, "SPECIFIKACIJA RADOVA");

    // Generisanje Excel fajla
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    // Postavljamo headere za download
    const startDateStr = new Date(startDate).toLocaleDateString('sr-RS');
    const filename = `${startDateStr}.evidencija.xlsx`;
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
    
  } catch (error) {
    console.error('Greška pri generisanju WorkOrderEvidence evidencije:', error);
    res.status(500).json({ 
      error: 'Greška pri generisanju evidencije: ' + error.message
    });
  }
});

module.exports = router;