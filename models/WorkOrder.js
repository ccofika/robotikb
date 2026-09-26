const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const WorkOrderSchema = new Schema({
  date: {
    type: Date,
    required: true
  },
  // Datum naloga kako je unet pri kreiranju — ostaje isti i kada se nalog odloži ili
  // prebaci na ispravku posle reklamacije (koristi se u mesečnom obračunu tehničara)
  originalDate: {
    type: Date
  },
  time: {
    type: String,
    required: true
  },
  municipality: {
    type: String,
    required: true
  },
  address: {
    type: String,
    required: true
  },
  type: {
    type: String,
    required: true
  },
  technicianId: {
    type: Schema.Types.ObjectId,
    ref: 'Technician'
  },
  technician2Id: {
    type: Schema.Types.ObjectId,
    ref: 'Technician'
  },
  details: {
    type: String
  },
  comment: {
    type: String
  },
  status: {
    type: String,
    enum: ['zavrsen', 'nezavrsen', 'otkazan', 'odlozen'],
    default: 'nezavrsen'
  },
  statusChangedBy: {
    type: Schema.Types.ObjectId,
    ref: 'Technician'
  },
  statusChangedAt: {
    type: Date
  },
  prvoMenjanjeStatusa: {
    type: Date
  },
  postponedUntil: {
    type: Date
  },
  postponeHistory: [{
    postponedAt: {
      type: Date,
      default: Date.now
    },
    fromDate: {
      type: Date
    },
    fromTime: {
      type: String
    },
    toDate: {
      type: Date
    },
    toTime: {
      type: String
    },
    comment: {
      type: String,
      required: true
    },
    postponedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Technician'
    }
  }],
  cancelHistory: [{
    canceledAt: {
      type: Date,
      default: Date.now
    },
    comment: {
      type: String,
      required: true
    },
    canceledBy: {
      type: Schema.Types.ObjectId,
      ref: 'Technician'
    }
  }],
  technology: {
    type: String,
    enum: ['HFC', 'GPON', 'VDSL', 'other'],
    default: 'other'
  },
  // Tim u koji je radni nalog svrstan (iz "Tim" kolone u Excel importu)
  tim: {
    type: String,
    enum: ['robotik', 'mtel', null],
    default: null
  },
  tisId: {
    type: String
  },
  userName: {
    type: String
  },
  userPhone: {
    type: String
  },
  customerEmail: {
    type: String
  },
  tisJobId: {
    type: String
  },
  additionalJobs: {
    type: String
  },
  images: [{
    url: {
      type: String,
      required: true
    },
    originalName: {
      type: String,
      required: true
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Technician'
    }
  }],
  verified: {
    type: Boolean,
    default: false
  },
  verifiedAt: {
    type: Date
  },
  reviewEmailSentAt: {
    type: Date,
    default: null
  },
  adminComment: {
    type: String
  },
  // Komentar tehničara: zašto neka od obaveznih fotografija nedostaje
  missingPhotosComment: {
    type: String,
    default: ''
  },
  // Vraćanja naloga tehničaru na ispravku (odbijanja pri verifikaciji).
  // Vraćanje sa umanjenjem podiže minus za 10%, a 6. takvo vraćanje znači da se nalog ne plaća.
  rejectionHistory: [{
    rejectedAt: {
      type: Date,
      default: Date.now
    },
    rejectedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Technician'
    },
    rejectedByName: {
      type: String,
      default: ''
    },
    comment: {
      type: String,
      default: ''
    },
    source: {
      type: String,
      enum: ['manual', 'ai'],
      default: 'manual'
    },
    penaltyApplied: {
      type: Boolean,
      default: false
    },
    penaltyPercentBefore: {
      type: Number,
      default: 0
    },
    penaltyPercentAfter: {
      type: Number,
      default: 0
    },
    // Ciklus umanjenja: reklamacija sa novim tehničarem počinje novi ciklus od 0%
    cycle: {
      type: Number,
      default: 0
    },
    technicianIds: [{
      type: Schema.Types.ObjectId,
      ref: 'Technician'
    }],
    technicianNames: [String]
  }],
  // Broj vraćanja sa umanjenjem u tekućem ciklusu i trenutni minus na zaradu (0–100%)
  rejectionPenaltyCount: {
    type: Number,
    default: 0
  },
  rejectionPenaltyPercent: {
    type: Number,
    default: 0
  },
  penaltyCycle: {
    type: Number,
    default: 0
  },
  // Ručne izmene minusa (superadmin utvrdi da tehničar nije kriv pa minus poništi ili promeni)
  penaltyAdjustments: [{
    adjustedAt: {
      type: Date,
      default: Date.now
    },
    adjustedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Technician'
    },
    adjustedByName: {
      type: String,
      default: ''
    },
    percentBefore: {
      type: Number,
      default: 0
    },
    percentAfter: {
      type: Number,
      default: 0
    },
    reason: {
      type: String,
      default: ''
    },
    cycle: {
      type: Number,
      default: 0
    },
    // Da li je izmena preračunala već obračunatu zaradu (nalog je bio plaćen)
    financeUpdated: {
      type: Boolean,
      default: false
    }
  }],
  // Reklamacije: radovi kod korisnika loše izvedeni, nalog se dodeljuje drugom tehničaru
  complaints: [{
    createdAt: {
      type: Date,
      default: Date.now
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'Technician'
    },
    createdByName: {
      type: String,
      default: ''
    },
    reason: {
      type: String,
      default: ''
    },
    // Da li je nalog bio verifikovan (plaćen) u trenutku reklamacije
    wasVerified: {
      type: Boolean,
      default: false
    },
    removedTechnicians: [{
      technicianId: {
        type: Schema.Types.ObjectId,
        ref: 'Technician'
      },
      name: String,
      // Koliko je tehničar već bio plaćen za ovaj nalog (0 ako nalog nije bio plaćen)
      paidAmount: {
        type: Number,
        default: 0
      },
      // Ukupan odbitak = reklamirani nalog se ne plaća + još jedan nalog iste kategorije
      deductionAmount: {
        type: Number,
        default: 0
      },
      // Poništena isplata za reklamirani nalog
      orderDeductionAmount: {
        type: Number,
        default: 0
      },
      deductionTransactionId: {
        type: Schema.Types.ObjectId,
        ref: 'FinancialTransaction'
      },
      // Dodatno skinut nalog: poslednji plaćeni nalog iste kategorije ('complaint_extra'),
      // ili iznos jednog takvog naloga kada drugog nema ('complaint_extra_fallback')
      extraDeductionKind: {
        type: String
      },
      extraDeductionAmount: {
        type: Number,
        default: 0
      },
      extraDeductionTransactionId: {
        type: Schema.Types.ObjectId,
        ref: 'FinancialTransaction'
      },
      extraWorkOrderId: {
        type: Schema.Types.ObjectId,
        ref: 'WorkOrder'
      },
      extraTisId: String,
      extraTisJobId: String,
      extraAddress: String,
      note: String
    }],
    keptTechnicians: [{
      technicianId: {
        type: Schema.Types.ObjectId,
        ref: 'Technician'
      },
      name: String
    }],
    newTechnicianId: {
      type: Schema.Types.ObjectId,
      ref: 'Technician'
    },
    newTechnicianName: {
      type: String,
      default: ''
    },
    fixDate: {
      type: Date
    },
    fixTime: {
      type: String
    },
    // Isplata novom tehničaru za ispravku: 'pending' (čeka verifikaciju ispravke), 'paid',
    // 'included' (nalog nije bio plaćen pa ulazi u redovan obračun), 'not_applicable'
    fixStatus: {
      type: String,
      enum: ['pending', 'paid', 'included', 'not_applicable'],
      default: 'pending'
    },
    fixAmount: {
      type: Number,
      default: 0
    },
    fixTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'FinancialTransaction'
    },
    fixNote: String,
    penaltyPercentBefore: {
      type: Number,
      default: 0
    }
  }],
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  equipment: [{
    type: Schema.Types.ObjectId,
    ref: 'Equipment'
  }],
  materials: [{
    material: {
      type: Schema.Types.ObjectId,
      ref: 'Material'
    },
    quantity: {
      type: Number,
      default: 1
    },
    technicianId: {
      type: Schema.Types.ObjectId,
      ref: 'Technician'
    }
  }],
  installedEquipment: [{
    equipmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Equipment',
      required: true
    },
    installedAt: {
      type: Date,
      default: Date.now
    },
    technicianId: {
      type: Schema.Types.ObjectId,
      ref: 'Technician'
    },
    notes: {
      type: String
    }
  }],
  // Admin edit log - tracks equipment changes made through the edit page
  adminEditLog: [{
    action: {
      type: String,
      enum: ['added', 'removed', 'material_added', 'material_removed'],
      required: true
    },
    equipmentCategory: String,
    equipmentDescription: String,
    equipmentSerialNumber: String,
    materialType: String,
    materialQuantity: Number,
    technicianName: String,
    technicianId: {
      type: Schema.Types.ObjectId,
      ref: 'Technician'
    },
    adminName: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  // Voice recordings from calls
  voiceRecordings: [{
    url: {
      type: String,
      required: true
    },
    fileName: {
      type: String,
      required: true
    },
    originalFileName: {
      type: String // Originalno ime fajla sa telefona
    },
    fileUniqueId: {
      type: String // Jedinstveni ID: phoneFolder/fileName za duplikat check
    },
    phoneNumber: {
      type: String,
      required: true
    },
    duration: {
      type: Number // in seconds
    },
    recordedAt: {
      type: Date,
      required: true
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Technician'
    },
    fileSize: {
      type: Number // in bytes
    }
  }],
  // Overdue fields
  isOverdue: {
    type: Boolean,
    default: false
  },
  overdueMarkedAt: {
    type: Date
  },
  appointmentDateTime: {
    type: Date
  },
  // Podsetnik 30 min pre termina: čuva appointmentDateTime za koji je podsetnik
  // poslat, pa se pri promeni termina podsetnik automatski šalje ponovo
  reminderSentForAppointment: {
    type: Date,
    default: null
  },
  reminderSentAt: {
    type: Date,
    default: null
  },
  // Praćenje kontakta sa korisnikom: kada je tehničar kliknuo "pozovi korisnika"
  // u aplikaciji (notifikacija/baner/kartica naloga). Ne garantuje obavljen poziv.
  customerCallAttemptedAt: {
    type: Date,
    default: null
  },
  customerCallSource: {
    type: String,
    default: ''
  },
  // Alert adminima "korisnik nije kontaktiran" 15 min pre termina — dedup po terminu
  uncontactedAlertSentForAppointment: {
    type: Date,
    default: null
  },
  // Provera pri importu: da li na istoj adresi postoji ranije OTKAZAN nalog.
  // checkedAt sprečava ponovnu proveru/notifikaciju za isti nalog.
  duplicateAddressFlagged: {
    type: Boolean,
    default: false
  },
  duplicateAddressCanceledCount: {
    type: Number,
    default: 0
  },
  duplicateAddressCheckedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

// Dodavanje indeksa za optimizaciju performansi
WorkOrderSchema.index({ status: 1 });
WorkOrderSchema.index({ technicianId: 1 });
WorkOrderSchema.index({ technician2Id: 1 });
WorkOrderSchema.index({ date: 1 });
WorkOrderSchema.index({ municipality: 1 });
WorkOrderSchema.index({ statusChangedAt: 1 }); // Za cancellation analysis
WorkOrderSchema.index({ status: 1, statusChangedAt: 1 }); // Za cancellation analysis sa vremenskim opsegom
WorkOrderSchema.index({ status: 1, technicianId: 1 }); // Kompozitni indeks za filtriranje po statusu i tehničaru
WorkOrderSchema.index({ date: 1, status: 1 }); // Kompozitni indeks za sortiranje po datumu i statusu
WorkOrderSchema.index({ status: 1, appointmentDateTime: 1 }); // Za scheduler (podsetnici + overdue)

module.exports = mongoose.model('WorkOrder', WorkOrderSchema); 