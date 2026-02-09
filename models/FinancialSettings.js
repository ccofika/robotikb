const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const FinancialSettingsSchema = new Schema({
  // Cene po customerStatus opcijama iz WorkOrderEvidence
  pricesByCustomerStatus: {
    'Priključenje korisnika na HFC KDS mreža u zgradi sa instalacijom CPE opreme (izrada kompletne instalacije od RO do korisnika sa instalacijom kompletne CPE opreme)': {
      type: Number,
      default: 0,
      min: 0
    },
    'Priključenje korisnika na HFC KDS mreža u privatnim kućama sa instalacijom CPE opreme (izrada instalacije od PM-a do korisnika sa instalacijom kompletne CPE opreme)': {
      type: Number,
      default: 0,
      min: 0
    },
    'Priključenje korisnika na GPON mrežu u privatnim kućama (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)': {
      type: Number,
      default: 0,
      min: 0
    },
    'Priključenje korisnika na GPON mrežu u zgradi (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)': {
      type: Number,
      default: 0,
      min: 0
    },
    'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji sa montažnim radovima': {
      type: Number,
      default: 0,
      min: 0
    },
    'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji bez montažnih radova': {
      type: Number,
      default: 0,
      min: 0
    },
    'Nov korisnik': {
      type: Number,
      default: 0,
      min: 0
    },
    'Priključenje novog korisnika WiFi tehnologijom (postavljanje nosača antene, postavljanje i usmeravanje antene ka baznoj stanici sa postavljanjem napajanja za antenu, postavljanje rutera i jednog uređaja za televiziju) - ASTRA TELEKOM': {
      type: Number,
      default: 0,
      min: 0
    },
    'Dodavanje drugog uređaja ili dorada - ASTRA TELEKOM': {
      type: Number,
      default: 0,
      min: 0
    },
    'Demontaža postojeće opreme kod korisnika (po korisniku) - ASTRA TELEKOM': {
      type: Number,
      default: 0,
      min: 0
    },
    'Intervencija kod korisnika - ASTRA TELEKOM': {
      type: Number,
      default: 0,
      min: 0
    },
    'Priključenje korisnika GPON tehnologijom (povezivanje svih uređaja u okviru paketa) - ASTRA TELEKOM': {
      type: Number,
      default: 0,
      min: 0
    }
  },

  // Popusti po opštinama
  discountsByMunicipality: [{
    municipality: {
      type: String,
      required: true
    },
    discountPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 0
    }
  }],

  // Cene za tehničare po customerStatus
  technicianPrices: [{
    technicianId: {
      type: Schema.Types.ObjectId,
      ref: 'Technician',
      required: true
    },
    pricesByCustomerStatus: {
      'Priključenje korisnika na HFC KDS mreža u zgradi sa instalacijom CPE opreme (izrada kompletne instalacije od RO do korisnika sa instalacijom kompletne CPE opreme)': {
        type: Number,
        default: 0,
        min: 0
      },
      'Priključenje korisnika na HFC KDS mreža u privatnim kućama sa instalacijom CPE opreme (izrada instalacije od PM-a do korisnika sa instalacijom kompletne CPE opreme)': {
        type: Number,
        default: 0,
        min: 0
      },
      'Priključenje korisnika na GPON mrežu u privatnim kućama (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)': {
        type: Number,
        default: 0,
        min: 0
      },
      'Priključenje korisnika na GPON mrežu u zgradi (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)': {
        type: Number,
        default: 0,
        min: 0
      },
      'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji sa montažnim radovima': {
        type: Number,
        default: 0,
        min: 0
      },
      'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji bez montažnih radova': {
        type: Number,
        default: 0,
        min: 0
      },
      'Nov korisnik': {
        type: Number,
        default: 0,
        min: 0
      },
      'Priključenje novog korisnika WiFi tehnologijom (postavljanje nosača antene, postavljanje i usmeravanje antene ka baznoj stanici sa postavljanjem napajanja za antenu, postavljanje rutera i jednog uređaja za televiziju) - ASTRA TELEKOM': {
        type: Number,
        default: 0,
        min: 0
      },
      'Dodavanje drugog uređaja ili dorada - ASTRA TELEKOM': {
        type: Number,
        default: 0,
        min: 0
      },
      'Demontaža postojeće opreme kod korisnika (po korisniku) - ASTRA TELEKOM': {
        type: Number,
        default: 0,
        min: 0
      },
      'Intervencija kod korisnika - ASTRA TELEKOM': {
        type: Number,
        default: 0,
        min: 0
      },
      'Priključenje korisnika GPON tehnologijom (povezivanje svih uređaja u okviru paketa) - ASTRA TELEKOM': {
        type: Number,
        default: 0,
        min: 0
      }
    }
  }]

}, {
  timestamps: true
});

// Indeksi za optimizaciju
FinancialSettingsSchema.index({ 'technicianPrices.technicianId': 1 });
FinancialSettingsSchema.index({ 'discountsByMunicipality.municipality': 1 });

module.exports = mongoose.model('FinancialSettings', FinancialSettingsSchema);