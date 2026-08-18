const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Trajni događaji kontakta sa korisnikom po radnom nalogu — hrane objedinjeni
// timeline na webu (zajedno sa SupportCall zapisima):
//  - customer_call:      tehničar kliknuo "Pozovi korisnika" u aplikaciji
//  - reminder_sent:      poslat podsetnik tehničaru (30 min pre termina)
//  - uncontacted_alert:  poslat alert adminima "korisnik nije kontaktiran" (15 min pre)
// Za razliku od polja na WorkOrder (koja čuvaju samo POSLEDNJI događaj i
// prepisuju se), ovde svaki događaj ostaje zauvek.
const ContactEventSchema = new Schema({
  workOrderId: {
    type: Schema.Types.ObjectId,
    ref: 'WorkOrder',
    required: true
  },
  eventType: {
    type: String,
    enum: ['customer_call', 'reminder_sent', 'uncontacted_alert'],
    required: true
  },
  // Vreme događaja
  at: {
    type: Date,
    required: true,
    default: Date.now
  },
  // Za customer_call: ko je zvao; za reminder_sent: kome je poslato
  technicianId: {
    type: Schema.Types.ObjectId,
    ref: 'Technician'
  },
  // Snapshot imena — otporan na kasnije promene imena tehničara
  technicianName: {
    type: String,
    default: ''
  },
  // Za customer_call: odakle je kliknuto (banner, order_card, detail_screen, notification_action)
  source: {
    type: String,
    default: ''
  },
  // true za zapise kreirane backfill skriptom iz postojećih polja (istorija od pre uvođenja kolekcije)
  backfilled: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

// Timeline po nalogu
ContactEventSchema.index({ workOrderId: 1, at: 1 });

module.exports = mongoose.model('ContactEvent', ContactEventSchema);
