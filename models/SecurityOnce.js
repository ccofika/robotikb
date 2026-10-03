// Jednokratne radnje Security modula (npr. "admin je danas već obavešten o ovom nepoznatom tagu").
// Ključ je jedinstven, pa prvi upis pobeđuje i kad dva zahteva stignu u istoj sekundi. Brišu se same posle 3 dana.
const mongoose = require('mongoose');

const SecurityOnceSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  at: { type: Date, default: Date.now, expires: 3 * 24 * 3600 }
});

module.exports = mongoose.models.SecurityOnce || mongoose.model('SecurityOnce', SecurityOnceSchema);
