# 🔄 Robotik Mobile - OTA Update System (Backend)

## Pregled

Ovaj sistem omogućava automatsko ažuriranje mobilne aplikacije bez potrebe za ponovnom instalacijom APK fajla.

---

## 📂 Struktura

```
robotikb/
├── models/
│   └── AppUpdate.js           # MongoDB model za update-e
├── routes/
│   └── updates.js             # API endpoints za update sistem
├── scripts/
│   └── publishUpdate.js       # Skripta za objavljivanje update-a
├── bundles/                   # Folder za čuvanje bundle fajlova
│   ├── android-1.0.1.bundle
│   ├── android-1.0.2.bundle
│   └── ...
└── server.js                  # Registracija update ruta
```

---

## 🚀 Kako funkcioniše

### 1. Aplikacija se pokreće

- `AppUpdater` komponenta proverava `/api/updates/check`
- Šalje trenutnu verziju aplikacije

### 2. Backend proverava

- Pronalazi najnoviju verziju u MongoDB
- Upoređuje sa verzijom aplikacije
- Vraća `updateAvailable: true/false`

### 3. Ako postoji update

- Aplikacija poziva `/api/updates/manifest`
- Preuzima bundle fajl sa `/api/updates/assets/:updateId/bundle`
- Primenjuje update i restartuje se

---

## 📝 API Endpoints

### GET /api/updates/check

Provera da li postoji novi update.

**Query parametri:**
- `currentVersion` (obavezno) - Trenutna verzija aplikacije (npr. "1.0.0")
- `platform` (opciono) - Platforma ("android" ili "ios", default: "android")

**Response:**
```json
{
  "updateAvailable": true,
  "latestVersion": "1.0.1",
  "currentVersion": "1.0.0",
  "isMandatory": false,
  "changelog": "Dodato novo dugme za izvoz",
  "publishedAt": "2025-01-17T10:30:00Z"
}
```

### GET /api/updates/manifest

Expo manifest sa informacijama o bundle-u.

**Query parametri:**
- `platform` (opciono) - Platforma
- `runtimeVersion` (opciono) - Runtime verzija

**Response:**
```json
{
  "manifest": {
    "id": "65a1b2c3d4e5f6g7h8i9j0k1",
    "createdAt": "2025-01-17T10:30:00Z",
    "runtimeVersion": "1.0.1",
    "launchAsset": {
      "url": "http://192.168.1.100:5000/api/updates/assets/65a1b2c3d4e5f6g7h8i9j0k1/bundle",
      "contentType": "application/javascript"
    },
    "assets": [],
    "extra": {
      "changelog": "Dodato novo dugme za izvoz"
    }
  }
}
```

### GET /api/updates/assets/:updateId/bundle

Preuzimanje bundle fajla.

**Response:** JavaScript bundle fajl

### POST /api/updates/create

Kreiranje novog update-a (admin endpoint).

**Body:**
```json
{
  "version": "1.0.1",
  "runtimeVersion": "1.0.1",
  "platform": "android",
  "bundlePath": "bundles/android-1.0.1.bundle",
  "changelog": "Bug fixes and improvements",
  "isMandatory": false
}
```

### GET /api/updates/list

Lista svih update-a (admin).

---

## 🔧 Objavljivanje Update-a

### Automatski način (Preporučeno)

```bash
cd robotikb
npm run publish-update
```

Ili sa custom changelog-om:
```bash
npm run publish-update "Dodato novo dugme za izvoz podataka"
```

### Skripta radi sledeće:

1. **Čita trenutnu verziju** iz `robotikm/app.json`
2. **Povećava verziju** (npr. 1.0.0 → 1.0.1)
3. **Ažurira app.json** sa novom verzijom
4. **Exportuje bundle:**
   ```bash
   cd robotikm && npx expo export --platform android --output-dir dist
   ```
5. **Kopira bundle** u `robotikb/bundles/`
6. **Kreira unos u MongoDB** sa svim informacijama

### Manualni način

Ako želiš manualno:

```bash
# 1. Export bundle-a
cd robotikm
npx expo export --platform android --output-dir dist

# 2. Kopiraj bundle
cp dist/_expo/static/js/android/index-*.js ../robotikb/bundles/android-1.0.1.bundle

# 3. Kreiraj unos u bazi
curl -X POST http://localhost:5000/api/updates/create \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.0.1",
    "runtimeVersion": "1.0.1",
    "platform": "android",
    "bundlePath": "bundles/android-1.0.1.bundle",
    "changelog": "Bug fixes",
    "isMandatory": false
  }'
```

---

## 🗄️ MongoDB Model

```javascript
{
  _id: ObjectId,
  version: "1.0.1",              // App verzija
  runtimeVersion: "1.0.1",       // Runtime verzija (mora biti veća od trenutne)
  platform: "android",           // android | ios | all
  bundlePath: "bundles/...",     // Lokacija bundle fajla
  assets: [],                    // Lista asset fajlova
  changelog: "...",              // Opis izmena
  isMandatory: false,            // Da li je update obavezan
  isActive: true,                // Da li je update aktivan
  createdAt: Date,
  publishedAt: Date
}
```

---

## 📊 Monitoring

### Provera dostupnih update-a

```bash
curl http://localhost:5000/api/updates/list
```

### Provera da li aplikacija može preuzeti update

```bash
curl "http://localhost:5000/api/updates/check?currentVersion=1.0.0&platform=android"
```

### MongoDB queries

```javascript
// Pronađi sve update-e
db.appupdates.find().sort({ runtimeVersion: -1 })

// Pronađi najnoviji update za Android
db.appupdates.findOne({ platform: { $in: ["android", "all"] }, isActive: true }).sort({ runtimeVersion: -1 })

// Deaktiviraj stari update
db.appupdates.updateOne({ _id: ObjectId("...") }, { $set: { isActive: false } })
```

---

## 🔐 Sigurnost

### Preporuke:

1. **Zaštiti admin endpoints** sa JWT autentikacijom
2. **Rate limiting** za update endpoints
3. **Validacija bundle fajlova** pre serviranja
4. **HTTPS** u produkciji (ne HTTP)
5. **Backup bundle-ova** pre brisanja

### Dodavanje autentikacije:

```javascript
// U routes/updates.js
const { verifyAdmin } = require('../middleware/auth');

router.post('/create', verifyAdmin, async (req, res) => {
  // ...
});
```

---

## 🚨 Troubleshooting

### Problem: "Bundle fajl nije pronađen"

```bash
# Proveri da li bundle postoji
ls robotikb/bundles/

# Proveri MongoDB unos
db.appupdates.find({ bundlePath: /bundles/ })
```

### Problem: "Update se ne primenjuje"

```bash
# Proveri backend logove
# Traži:
# - "Checking for updates: current=..."
# - "Fetching manifest: platform=..."

# Proveri MongoDB
db.appupdates.find({ isActive: true }).sort({ runtimeVersion: -1 })

# Proveri da li je nova verzija VEĆA od trenutne
# 1.0.1 > 1.0.0 ✅
# 1.0.0 > 1.0.1 ❌
```

### Problem: "Aplikacija pada nakon update-a"

```bash
# Proveri da li bundle odgovara verziji u app.json
# Proveri expo export logove za greške
cd robotikm
npx expo export --platform android --output-dir dist
```

---

## 📈 Best Practices

### Verzionisanje

```
MAJOR.MINOR.PATCH

1.0.0 → 1.0.1  (Patch: Bug fix)
1.0.1 → 1.1.0  (Minor: Nova feature)
1.1.0 → 2.0.0  (Major: Breaking change ili novi APK)
```

### Changelog

Dobri primeri:
- ✅ "Popravljeno padanje aplikacije pri otvaranju radnih naloga"
- ✅ "Dodato dugme za izvoz PDF-a"
- ✅ "Poboljšana brzina učitavanja"

Loši primeri:
- ❌ "Update"
- ❌ "Bug fixes"
- ❌ "Improvements"

### Retention Policy

Čuvaj samo poslednje 3-5 bundle verzija:

```javascript
// U publishUpdate.js, dodaj:
const oldUpdates = await AppUpdate.find({ isActive: true })
  .sort({ runtimeVersion: -1 })
  .skip(5);

for (const update of oldUpdates) {
  await fs.unlink(path.join(__dirname, '..', update.bundlePath));
  await update.deleteOne();
}
```

---

## 🎯 Production Checklist

Pre deploy-a u produkciju:

- [ ] HTTPS konfigurisan
- [ ] Admin endpoints zaštićeni
- [ ] Rate limiting dodat
- [ ] Backup strategija za bundle-ove
- [ ] Monitoring setup (npr. Sentry)
- [ ] CDN za bundle serviranje (opciono)
- [ ] Automatski cleanup starih bundle-ova
- [ ] Rollback procedura testirana

---

**Napomena:** Ovaj sistem radi samo za JavaScript izmene. Za native izmene (novi paketi, permissions), mora se napraviti novi APK.
