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

  // Vrsta stavke: 'standard' = redovan obračun pri verifikaciji (jedan po nalogu),
  // 'complaint_deduction' = odbitak tehničaru zbog reklamacije (negativna zarada),
  // 'complaint_fix' = isplata tehničaru koji je ispravio nalog posle reklamacije
  entryType: {
    type: String,
    enum: ['standard', 'complaint_deduction', 'complaint_fix'],
    default: 'standard'
  },

  // Vrsta odbitka za reklamaciju:
  // 'complaint_order' = reklamirani nalog se ne plaća (poništava se isplata za njega),
  // 'complaint_extra' = skida se i poslednji plaćeni nalog iste kategorije (workOrderId je taj nalog),
  // 'complaint_extra_fallback' = nema drugog naloga iste kategorije, skida se iznos jednog takvog naloga
  deductionKind: {
    type: String,
    enum: ['complaint_order', 'complaint_extra', 'complaint_extra_fallback', null],
    default: null
  },

  // Reklamirani nalog zbog kog je nastao odbitak (kod 'complaint_extra' se razlikuje od workOrderId)
  relatedWorkOrderId: {
    type: Schema.Types.ObjectId,
    ref: 'WorkOrder'
  },
  relatedTisJobId: {
    type: String
  },
  relatedTisId: {
    type: String
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
    // Neto zarada za ovu stavku (posle umanjenja). Negativna je samo kod odbitka za reklamaciju.
    earnings: {
      type: Number,
      required: true
    },
    // Zarada pre umanjenja zbog vraćanja naloga
    grossEarnings: {
      type: Number
    },
    // Umanjenje zbog vraćanja naloga na ispravku (procenat i iznos)
    penaltyPercent: {
      type: Number,
      default: 0
    },
    penaltyAmount: {
      type: Number,
      default: 0
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
      // Stari statusi (zadržani za postojeće zapise - backward compatibility)
      'Priključenje korisnika na HFC KDS mreža u zgradi sa instalacijom CPE opreme (izrada kompletne instalacije od RO do korisnika sa instalacijom kompletne CPE opreme)',
      'Priključenje korisnika na HFC KDS mreža u privatnim kućama sa instalacijom CPE opreme (izrada instalacije od PM-a do korisnika sa instalacijom kompletne CPE opreme)',
      'Priključenje korisnika na GPON mrežu u privatnim kućama (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)',
      'Priključenje korisnika na GPON mrežu u zgradi (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)',
      'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji sa montažnim radovima',
      'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji bez montažnih radova',
      // Novi statusi sa "sa isporukom materijala"
      'Priključenje korisnika na HFC KDS mreža u zgradi sa instalacijom CPE opreme (izrada kompletne instalacije od RO do korisnika sa instalacijom kompletne CPE opreme) sa isporukom materijala',
      'Priključenje korisnika na HFC KDS mreža u privatnim kućama sa instalacijom CPE opreme (izrada instalacije od PM-a do korisnika sa instalacijom kompletne CPE opreme) sa isporukom materijala',
      'Priključenje korisnika na GPON mrežu u privatnim kućama (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme) sa isporukom materijala',
      'Priključenje korisnika na GPON mrežu u zgradi (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme) sa isporukom materijala',
      'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji sa montažnim radovima sa isporukom materijala',
      'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji bez montažnih radova sa isporukom materijala',
      'Nov korisnik',
      // ASTRA TELEKOM statusi (nepromenjeni)
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

  // Ukupne isplate tehničarima (negativne kod odbitka za reklamaciju)
  totalTechnicianEarnings: {
    type: Number,
    required: true
  },

  // Minus zbog vraćanja naloga u trenutku obračuna (0–100%) i broj vraćanja u tom ciklusu
  rejectionPenaltyPercent: {
    type: Number,
    default: 0
  },
  rejectionCount: {
    type: Number,
    default: 0
  },
  // Superadmin je naknadno promenio minus (npr. poništio umanjenje): minus u trenutku obračuna i ko je menjao
  penaltyPercentOriginal: {
    type: Number
  },
  penaltyAdjustedAt: {
    type: Date
  },
  penaltyAdjustedByName: {
    type: String
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
FinancialTransactionSchema.index({ workOrderId: 1, entryType: 1 });
FinancialTransactionSchema.index({ 'technicians.technicianId': 1 });
FinancialTransactionSchema.index({ municipality: 1 });
FinancialTransactionSchema.index({ customerStatus: 1 });
FinancialTransactionSchema.index({ verifiedAt: 1 });
FinancialTransactionSchema.index({ createdAt: 1 });

// Kompozitni indeksi
FinancialTransactionSchema.index({ verifiedAt: 1, municipality: 1 });
FinancialTransactionSchema.index({ verifiedAt: 1, 'technicians.technicianId': 1 });

module.exports = mongoose.model('FinancialTransaction', FinancialTransactionSchema);