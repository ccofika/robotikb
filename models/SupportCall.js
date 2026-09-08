const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Beleži klik tehničara na dugme za poziv (podrška ili kontakt osoba)
// iz mobilne aplikacije.
// Dedup pravilo: ponovljeni klik na ISTO dugme za ISTI nalog unutar 60s
// se ne upisuje (sprovodi ga ruta, ne šema).
const SupportCallSchema = new Schema({
  technicianId: {
    type: Schema.Types.ObjectId,
    ref: 'Technician',
    required: true
  },
  // Snapshot imena u trenutku poziva — prikaz bez join-a i otporan na
  // kasnije promene/brisanje tehničara
  technicianName: {
    type: String,
    default: ''
  },
  workOrderId: {
    type: Schema.Types.ObjectId,
    ref: 'WorkOrder',
    required: true
  },
  supportType: {
    type: String,
    enum: ['administrative', 'super', 'marko', 'ana'],
    required: true
  },
  phoneNumber: {
    type: String,
    default: ''
  },
  // Odakle je kliknuto (detail_screen, order_card, banner, overdue_card...)
  source: {
    type: String,
    default: ''
  },
  // Tačno vreme klika na uređaju; kod offline sinhronizacije se razlikuje
  // od createdAt (vremena upisa u bazu)
  calledAt: {
    type: Date,
    required: true,
    default: Date.now
  }
}, { timestamps: true });

// Timeline po radnom nalogu
SupportCallSchema.index({ workOrderId: 1, calledAt: 1 });
// Dedup upit i summary po tehničaru
SupportCallSchema.index({ technicianId: 1, workOrderId: 1, supportType: 1, calledAt: -1 });

module.exports = mongoose.model('SupportCall', SupportCallSchema);
