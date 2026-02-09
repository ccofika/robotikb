const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const FinancialTransactionSchema = new Schema({
  // Referenca na WorkOrder
  workOrderId: {
    type: Schema.Types.ObjectId,
    ref: 'WorkOrder',
    required: true
  },

  // Referenca na WorkOrderEvidence
  evidenceId: {
    type: Schema.Types.ObjectId,
    ref: 'WorkOrderEvidence'
  },

  // Tehničari koji su radili na radnom nalogu
  technicians: [{
    technicianId: {
      type: Schema.Types.ObjectId,
      ref: 'Technician',
      required: true
    },
    name: {
      type: String,
      required: true
    },
    earnings: {
      type: Number,
      required: true,
      min: 0
    },
    // Tip plaćanja tehničara
    paymentType: {
      type: String,
      enum: ['po_statusu', 'plata'],
      default: 'po_statusu'
    },
    // Podaci za tehničare sa platom
    salaryDetails: {
      monthlySalary: { type: Number, default: 0 },
      earnedTowardsSalary: { type: Number, default: 0 }, // Koliko je zaradio ka plati
      previouslyEarned: { type: Number, default: 0 }, // Koliko je prethodno zaradio ovog meseca
      exceededSalary: { type: Boolean, default: false }, // Da li je već prešao platu
      excessAmount: { type: Number, default: 0 } // Višak koji ide u profit
    }
  }],

  // CustomerStatus iz WorkOrderEvidence
  customerStatus: {
    type: String,
    required: true,
    enum: [
      'Priključenje korisnika na HFC KDS mreža u zgradi sa instalacijom CPE opreme (izrada kompletne instalacije od RO do korisnika sa instalacijom kompletne CPE opreme)',
      'Priključenje korisnika na HFC KDS mreža u privatnim kućama sa instalacijom CPE opreme (izrada instalacije od PM-a do korisnika sa instalacijom kompletne CPE opreme)',
      'Priključenje korisnika na GPON mrežu u privatnim kućama (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)',
      'Priključenje korisnika na GPON mrežu u zgradi (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)',
      'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji sa montažnim radovima',
      'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji bez montažnih radova',
      'Nov korisnik',
      'Priključenje novog korisnika WiFi tehnologijom (postavljanje nosača antene, postavljanje i usmeravanje antene ka baznoj stanici sa postavljanjem napajanja za antenu, postavljanje rutera i jednog uređaja za televiziju) - ASTRA TELEKOM',
      'Dodavanje drugog uređaja ili dorada - ASTRA TELEKOM',
      'Demontaža postojeće opreme kod korisnika (po korisniku) - ASTRA TELEKOM',
      'Intervencija kod korisnika - ASTRA TELEKOM',
      'Priključenje korisnika GPON tehnologijom (povezivanje svih uređaja u okviru paketa) - ASTRA TELEKOM'
    ]
  },

  // Opština
  municipality: {
    type: String,
    required: true
  },

  // Osnovne finansijske informacije
  basePrice: {
    type: Number,
    required: true,
    min: 0
  },

  discountPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },

  discountAmount: {
    type: Number,
    default: 0,
    min: 0
  },

  // Finalna cena nakon popusta
  finalPrice: {
    type: Number,
    required: true,
    min: 0
  },

  // Ukupne isplate tehničarima
  totalTechnicianEarnings: {
    type: Number,
    required: true,
    min: 0
  },

  // Profit kompanije
  companyProfit: {
    type: Number,
    required: true
  },

  // Datum verifikacije (kada je transakcija kreirana)
  verifiedAt: {
    type: Date,
    required: true,
    default: Date.now
  },

  // Ko je verifikovao
  verifiedBy: {
    type: Schema.Types.ObjectId,
    ref: 'Technician'
  },

  // Dodatne informacije
  notes: {
    type: String
  },

  // TIS podaci za praćenje
  tisJobId: {
    type: String
  }

}, {
  timestamps: true
});

// Indeksi za optimizaciju
FinancialTransactionSchema.index({ workOrderId: 1 });
FinancialTransactionSchema.index({ 'technicians.technicianId': 1 });
FinancialTransactionSchema.index({ municipality: 1 });
FinancialTransactionSchema.index({ customerStatus: 1 });
FinancialTransactionSchema.index({ verifiedAt: 1 });
FinancialTransactionSchema.index({ createdAt: 1 });

// Kompozitni indeksi
FinancialTransactionSchema.index({ verifiedAt: 1, municipality: 1 });
FinancialTransactionSchema.index({ verifiedAt: 1, 'technicians.technicianId': 1 });

module.exports = mongoose.model('FinancialTransaction', FinancialTransactionSchema);