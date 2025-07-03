# Database Migration Scripts

## Image Data Migration

### Opis

Ova migracija ažurira postojeće radne naloge da slike budu čuvane u novom formatu koji uključuje originalne nazive fajlova. Ovo omogućava sprečavanje duplikata slika na osnovu originalnih naziva.

### Stara struktura:
```javascript
images: ["https://cloudinary.com/image1.jpg", "https://cloudinary.com/image2.jpg"]
```

### Nova struktura:
```javascript
images: [
  {
    url: "https://cloudinary.com/image1.jpg",
    originalName: "original_file_name.jpg",
    uploadedAt: "2024-01-01T00:00:00.000Z",
    uploadedBy: "technicianId"
  }
]
```

## Pokretanje Migracije

### 1. Pre migracije
- **OBAVEZNO napravite backup baze podataka!**
- Zaustavite aplikaciju da izbegnete konflikte

```bash
# Backup MongoDB baze
mongodump --db telco_inventory --out ./backup
```

### 2. Pokretanje migracije

```bash
# Iz robotikb direktorijuma
cd robotikb

# Instalirajte dependencies ako nisu installirane
npm install

# Pokrenite migraciju
node scripts/migrateImageData.js
```

### 3. Rezultat

Skripta će ispisati rezultate migracije:

```
🚀 Pokretanje migracije slika...
📋 Pronađeno 150 radnih naloga sa slikama
✅ Migriran radni nalog 64f1a1b2c3d4e5f6g7h8i9j0 sa 3 slika
⏭️  Radni nalog 64f1a1b2c3d4e5f6g7h8i9j1 je već migriran
...

🎉 Migracija završena!
📊 Rezultati:
   ✅ Migrirano: 145
   ⏭️  Već migrirano: 3
   ❌ Greške: 2
   📋 Ukupno: 150
```

### 4. Verifikacija

Nakon migracije možete proveriti da li su podaci ispravno migrirani:

```javascript
// U MongoDB shell-u
db.workorders.findOne({images: {$exists: true, $not: {$size: 0}}})

// Trebalo bi da vidite novu strukturu sa url, originalName, uploadedAt, uploadedBy
```

## Sigurnost

- ✅ Skripta automatski detektuje već migrirane podatke
- ✅ Može se pokrenuti više puta bez problema
- ✅ Ne briše postojeće podatke, samo ih konvertuje
- ✅ Podržava i staru i novu strukturu tokom prelaznog perioda

## Troubleshooting

### Problem: "Cannot connect to MongoDB"
```bash
# Proverite da li je MongoDB pokrenut
sudo systemctl status mongod

# Proverite connection string u .env fajlu
echo $MONGODB_URI
```

### Problem: "Permission denied"
```bash
# Dajte execute dozvole skripti
chmod +x scripts/migrateImageData.js

# Ili pokrenite sa node eksplicitno
node scripts/migrateImageData.js
```

### Problem: Greška tokom migracije određenih dokumenata
- Proverite log poruke za specifične greške
- Možete pokrenuti migraciju ponovo - preskočiće već migrirane dokumente
- Ako problem persists, kontaktirajte developera

## Rollback (vraćanje nazad)

Ako je potrebno da se vrati na staru strukturu:

```bash
# Restore iz backup-a
mongorestore --db telco_inventory ./backup/telco_inventory --drop
```

⚠️ **PAŽNJA**: Rollback će obrisati sve nove podatke kreirane nakon backup-a!

## Testiranje Funkcionalnosti

### Pre produkcije

Pre puštanja u produkciju možete testirati funkcionalnost duplikata:

```bash
# Pokrenite test skriptu
node scripts/testImageDuplicates.js
```

Test skripta će:
- ✅ Kreirati test radni nalog sa test slikama
- ✅ Testirati duplikate (trebaju biti odbačeni)
- ✅ Testirati neduplikate (trebaju biti prihvaćeni)
- ✅ Testirati kompatibilnost sa starim formatom
- ✅ Obrisati test podatke

### Ručno testiranje u browseru

1. Otvorite aplikaciju i idite na radni nalog
2. Uploadujte sliku (npr. `test_image.jpg`)
3. Pokušajte da uploadujete istu sliku ponovo
4. Trebalo bi da vidite poruku: `"test_image.jpg - slika sa istim nazivom već postoji"`

### Debug Mode

Za debug informacije u browseru:
1. Otvorite Developer Tools (F12)
2. Idite na Console tab
3. Pokušajte upload duplikata
4. Videćete debug poruke o procesu provere duplikata 