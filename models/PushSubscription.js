const mongoose = require('mongoose');

// Web Push pretplata jednog browsera/uređaja za jednog korisnika (admina).
// Jedan korisnik može imati više pretplata (posao, laptop, telefon...).
const PushSubscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true,
  },
  userName: {
    type: String,
    default: '',
  },
  // Jedinstveni endpoint browsera — ključ za upsert/brisanje
  endpoint: {
    type: String,
    required: true,
    unique: true,
  },
  // Kompletan PushSubscription JSON (endpoint + keys.p256dh + keys.auth)
  subscription: {
    type: Object,
    required: true,
  },
  userAgent: {
    type: String,
    default: '',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastUsedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('PushSubscription', PushSubscriptionSchema);
