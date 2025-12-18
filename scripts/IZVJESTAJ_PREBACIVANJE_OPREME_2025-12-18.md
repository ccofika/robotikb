# Izvještaj: Prebacivanje viška opreme u Virtuelni Magacin

**Datum:** 2025-12-18
**Izvršio:** Automatska skripta `moveExcessEquipmentToVirtualWarehouse.js`

---

## Sažetak

Izvršeno je prebacivanje viška opreme sa tehničara u virtuelni magacin. Oprema koja je prebačena je ona koja:
- Ima status `assigned` (fizički kod tehničara, nije instalirana kod korisnika)
- Nema `assignedToUser` (nije kod korisnika)
- Ima `updatedAt` datum **stariji** od 16., 17., 18. decembra 2025.

**Oprema koja je OSTALA kod tehničara:**
- Sva oprema sa statusom `installed` (instalirana kod korisnika)
- Sva oprema sa `assignedToUser` (kod korisnika)
- Oprema ažurirana 16., 17., ili 18. decembra 2025.

---

## Rezultati po tehničarima

| Tehničar | Pre | Posle | Prebačeno | Installed (ostalo) |
|----------|-----|-------|-----------|-------------------|
| Nenad Ocokoljić | 1237 | 891 | 346 | 855 |
| Miloš Jablan | 669 | 468 | 201 | 450 |
| Igor Kruzija | 431 | 313 | 118 | 313 |
| Vladimir Mojsilović | 878 | 772 | 106 | 758 |
| Nemanja Lazarević | 738 | 660 | 78 | 623 |
| Srećko Bogdanović | 578 | 531 | 47 | 516 |
| SM | 232 | 192 | 40 | 188 |
| Milan Pešić | 129 | 120 | 9 | 106 |
| Milivoje Leković | 66 | 58 | 8 | 40 |
| Vladimir Milovanović | 557 | 554 | 3 | 523 |
| **UKUPNO** | **5515** | **4559** | **956** | **4372** |

---

## Stanje posle prebacivanja

### Tehničari - Finalno stanje

| Tehničar | Ukupno | Assigned | Installed |
|----------|--------|----------|-----------|
| Nemanja Lazarević | 660 | 37 | 623 |
| Milan Pešić | 120 | 14 | 106 |
| Vladimir Mojsilović | 772 | 14 | 758 |
| Vladimir Milovanović | 554 | 31 | 523 |
| Igor Kruzija | 313 | 0 | 313 |
| Nenad Ocokoljić | 891 | 36 | 855 |
| Srećko Bogdanović | 531 | 15 | 516 |
| Miloš Jablan | 468 | 18 | 450 |
| Milivoje Leković | 58 | 18 | 40 |
| SM | 192 | 4 | 188 |

### Virtuelni Magacin

- **Ukupno opreme:** 1252 komada
- **Lokacija u bazi:** `location: 'virtuelni_magacin'`
- **JSON fajl:** `robotikf/src/data/virtual_warehouse_equipment.json`

---

## Backup fajlovi

Svi backup fajlovi su sačuvani u `robotikb/scripts/`:

- `backup_Milivoje_Leković_*.json`
- `backup_SM_*.json`
- `backup_Nenad_Ocokoljić_*.json`
- `backup_Miloš_Jablan_*.json`
- `backup_Vladimir_Mojsilović_*.json`
- `backup_Igor_Kruzija_*.json`
- `backup_Nemanja_Lazarević_*.json`
- `backup_Srećko_Bogdanović_*.json`
- `backup_Vladimir_Milovanović_*.json`
- `backup_Milan_Pešić_*.json`

---

## Tehnički detalji

### Polja ažurirana u MongoDB (Equipment kolekcija)

Za svaku prebačenu opremu:
```javascript
{
  location: 'virtuelni_magacin',
  status: 'available',
  assignedTo: null,
  previousAssignedTo: <ObjectId tehničara>,
  movedToVirtualWarehouseAt: <Date>
}
```

### JSON format (virtual_warehouse_equipment.json)

```json
{
  "_id": "123",
  "category": "Smart Card",
  "description": "SIM Kartica",
  "serialNumber": "00240191762190",
  "location": "tehnicar-<ObjectId>",
  "originalUpdatedAt": "2025-10-18T...",
  "movedAt": "2025-12-18T..."
}
```

---

## Skripta za buduće prebacivanje

```bash
cd robotikb

# Lista tehničara
node scripts/moveExcessEquipmentToVirtualWarehouse.js --list

# Dry-run (pregled bez promena)
node scripts/moveExcessEquipmentToVirtualWarehouse.js --dry-run "Ime Tehničara"

# Izvršavanje
node scripts/moveExcessEquipmentToVirtualWarehouse.js --execute "Ime Tehničara"

# Backup
node scripts/moveExcessEquipmentToVirtualWarehouse.js --backup "Ime Tehničara"
```

---

## Napomene

1. **Instalirana oprema** (status `installed`, sa `assignedToUser`) NIKADA nije prebacivana - ta oprema je kod korisnika i mora ostati povezana sa tehničarem.

2. **Restauracija** je moguća korišćenjem backup fajlova i skripte `restoreEquipment.js`.

3. **Dozvoljeni datumi** za zadržavanje opreme kod tehničara su hardkodirani u skripti:
   - 2025-12-16
   - 2025-12-17
   - 2025-12-18

   Za promenu ovih datuma, editovati `KEEP_DATES` array u skripti.
