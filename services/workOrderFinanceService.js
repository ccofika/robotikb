// Obračun zarade tehničara van redovne verifikacije:
//  - umanjenje zbog vraćanja naloga na ispravku (-10% po vraćanju, 6. vraćanje = ne plaća se)
//  - reklamacija: odbitak tehničaru koji je loše uradio posao i isplata onom koji je ispravio
//  - mesečni obračun po tehničaru (tabela + email)
const FinancialTransaction = require('../models/FinancialTransaction');
const FinancialSettings = require('../models/FinancialSettings');
const WorkOrderEvidence = require('../models/WorkOrderEvidence');
const { WorkOrder, Technician } = require('../models');

const PENALTY_STEP_PERCENT = 10;
const PENALTY_MAX_STEPS = 5;
const ADJUSTMENT_ENTRY_TYPES = ['complaint_deduction', 'complaint_fix'];
// Stari zapisi nemaju entryType, pa se redovna stavka traži kao "nije korekcija"
const STANDARD_ENTRY_FILTER = { entryType: { $nin: ADJUSTMENT_ENTRY_TYPES } };
const NEW_STATUS_SUFFIX = ' sa isporukom materijala';

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

// 1. vraćanje -10%, 2. -20% ... 5. -50%; 6. i svako sledeće vraćanje: nalog se ne plaća
const penaltyPercentForCount = (count) => {
  const n = Number(count) || 0;
  if (n <= 0) return 0;
  if (n > PENALTY_MAX_STEPS) return 100;
  return n * PENALTY_STEP_PERCENT;
};

const applyPenalty = (amount, percent) => {
  const p = Math.min(Math.max(Number(percent) || 0, 0), 100);
  const gross = round2(amount);
  const net = round2(gross * (100 - p) / 100);
  return { gross, net, penaltyAmount: round2(gross - net), percent: p };
};

// Cena tehničara za tip usluge. Stari nazivi statusa (bez sufiksa) su u cenovniku pod novim ključem.
const getTechnicianStatusPrice = (settings, technicianId, customerStatus) => {
  if (!settings || !technicianId || !customerStatus) return 0;
  const pricing = (settings.technicianPrices || []).find(
    tp => tp.technicianId && tp.technicianId.toString() === technicianId.toString()
  );
  if (!pricing || !pricing.pricesByCustomerStatus) return 0;
  const prices = pricing.pricesByCustomerStatus;
  const direct = Number(prices[customerStatus]) || 0;
  if (direct > 0) return direct;
  if (!customerStatus.endsWith(NEW_STATUS_SUFFIX)) {
    return Number(prices[customerStatus + NEW_STATUS_SUFFIX]) || 0;
  }
  return 0;
};

// Koliko je tehničar sa platom zaradio ka plati u mesecu datuma refDate
const getTechnicianMonthlyEarnings = async (technicianId, refDate = new Date()) => {
  const startOfMonth = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
  const endOfMonth = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0, 23, 59, 59, 999);

  const transactions = await FinancialTransaction.find({
    'technicians.technicianId': technicianId,
    verifiedAt: { $gte: startOfMonth, $lte: endOfMonth }
  }).lean();

  let totalEarned = 0;
  transactions.forEach(tx => {
    const techEntry = tx.technicians.find(t => t.technicianId.toString() === technicianId.toString());
    if (techEntry && techEntry.paymentType === 'plata' && techEntry.salaryDetails) {
      totalEarned += techEntry.salaryDetails.earnedTowardsSalary || 0;
    }
  });

  return totalEarned;
};

// Koliko je tehničar do sada dobio za nalog (redovna stavka + ranije isplate za ispravke)
const getPaidAmountForWorkOrder = async (workOrderId, technicianId) => {
  const entries = await FinancialTransaction.find({
    workOrderId,
    entryType: { $ne: 'complaint_deduction' },
    'technicians.technicianId': technicianId
  }).lean();

  let paid = 0;
  entries.forEach(tx => {
    const techEntry = tx.technicians.find(t => t.technicianId.toString() === technicianId.toString());
    if (techEntry && techEntry.earnings > 0) paid += techEntry.earnings;
  });
  return round2(paid);
};

const idOf = (value) => (value && value._id ? value._id : value);
const sameId = (a, b) => !!a && !!b && idOf(a).toString() === idOf(b).toString();

// Stari i novi naziv istog tipa usluge (sa/bez " sa isporukom materijala") su ista kategorija
const categoryVariants = (customerStatus) => {
  if (!customerStatus) return [];
  const base = customerStatus.endsWith(NEW_STATUS_SUFFIX)
    ? customerStatus.slice(0, -NEW_STATUS_SUFFIX.length)
    : customerStatus;
  return [base, base + NEW_STATUS_SUFFIX];
};

// Poslednji plaćeni nalog tehničara iz iste kategorije (tip usluge), koji se skida zbog reklamacije.
// Preskaču se nalozi koji su već skinuti ili poništeni zbog neke reklamacije.
const findLastSameCategoryOrder = async (technicianId, customerStatus, excludeWorkOrderIds = []) => {
  const variants = categoryVariants(customerStatus);
  if (variants.length === 0) return null;

  const alreadyDeducted = await FinancialTransaction.find({
    entryType: 'complaint_deduction',
    'technicians.technicianId': technicianId
  }).select('workOrderId').lean();
  const excluded = new Set([
    ...excludeWorkOrderIds.map(id => idOf(id).toString()),
    ...alreadyDeducted.map(tx => tx.workOrderId.toString())
  ]);

  const candidates = await FinancialTransaction.find({
    entryType: { $ne: 'complaint_deduction' },
    'technicians.technicianId': technicianId,
    customerStatus: { $in: variants }
  })
    .sort({ verifiedAt: -1 })
    .limit(100)
    .populate('workOrderId', 'tisId tisJobId address municipality date originalDate')
    .lean();

  for (const tx of candidates) {
    const wo = tx.workOrderId && typeof tx.workOrderId === 'object' ? tx.workOrderId : null;
    if (!wo || excluded.has(wo._id.toString())) continue;
    const entry = tx.technicians.find(t => t.technicianId.toString() === technicianId.toString());
    if (!entry || !(entry.earnings > 0)) continue;
    return {
      workOrderId: wo._id.toString(),
      tisId: wo.tisId || '',
      tisJobId: wo.tisJobId || tx.tisJobId || '',
      address: wo.address || '',
      municipality: wo.municipality || tx.municipality || '',
      workOrderDate: wo.originalDate || wo.date || null,
      customerStatus: tx.customerStatus,
      amount: round2(entry.earnings)
    };
  }
  return null;
};

// Plan reklamacije (koristi se i za pregled u modalu pre potvrde i za samu primenu)
const buildComplaintPlan = async (workOrder, removeTechnicianIds = [], newTechnicianId = null) => {
  const currentTechs = [
    { slot: 'technicianId', id: idOf(workOrder.technicianId) },
    { slot: 'technician2Id', id: idOf(workOrder.technician2Id) }
  ].filter(t => t.id);

  const techDocs = await Technician.find({ _id: { $in: currentTechs.map(t => t.id) } })
    .select('name paymentType monthlySalary')
    .lean();
  const techById = new Map(techDocs.map(t => [t._id.toString(), t]));

  const [evidence, settings, standardTx] = await Promise.all([
    WorkOrderEvidence.findOne({ workOrderId: workOrder._id }).select('customerStatus').lean(),
    FinancialSettings.findOne().lean(),
    FinancialTransaction.findOne({ workOrderId: workOrder._id, ...STANDARD_ENTRY_FILTER }).lean()
  ]);
  const customerStatus = standardTx?.customerStatus || evidence?.customerStatus || '';

  const technicians = [];
  for (const t of currentTechs) {
    const doc = techById.get(t.id.toString());
    const name = doc?.name || 'Nepoznat tehničar';
    const paymentType = doc?.paymentType || 'po_statusu';
    const paidAmount = await getPaidAmountForWorkOrder(workOrder._id, t.id);
    const willBeRemoved = removeTechnicianIds.some(rid => sameId(rid, t.id));

    // 1) Reklamirani nalog se ne plaća: poništava se isplata ako je bio plaćen
    //    (ako nije bio plaćen, tehničar ga neće ni dobiti jer se sklanja sa naloga)
    const orderDeductionAmount = paidAmount;

    // 2) Skida se i još jedan nalog: poslednji plaćeni nalog iste kategorije tog tehničara
    let extraDeduction = null;
    const lastOrder = await findLastSameCategoryOrder(t.id, customerStatus, [workOrder._id]);
    if (lastOrder) {
      extraDeduction = { kind: 'complaint_extra', ...lastOrder };
    } else {
      // Nema drugog plaćenog naloga iste kategorije — skida se iznos jednog takvog naloga
      const amount = paidAmount > 0
        ? paidAmount
        : (paymentType === 'po_statusu' ? getTechnicianStatusPrice(settings, t.id, customerStatus) : 0);
      extraDeduction = { kind: 'complaint_extra_fallback', amount: round2(amount) };
    }

    const totalDeduction = round2(orderDeductionAmount + (extraDeduction.amount || 0));
    let note;
    if (extraDeduction.kind === 'complaint_extra') {
      note = `Skida se i poslednji nalog iste kategorije: ${extraDeduction.tisJobId || extraDeduction.tisId || 'nalog'} (${extraDeduction.amount} RSD).`;
    } else if (extraDeduction.amount > 0) {
      note = `Nema drugog plaćenog naloga iste kategorije — skida se iznos jednog takvog naloga (${extraDeduction.amount} RSD).`;
    } else {
      note = paymentType === 'plata'
        ? 'Tehničar je na platu i nema drugog naloga iste kategorije — dodatni odbitak nije moguće obračunati.'
        : 'Nema drugog naloga iste kategorije, a cena tehničara za ovaj tip usluge nije postavljena — dodatni odbitak nije obračunat.';
    }

    technicians.push({
      technicianId: t.id.toString(),
      slot: t.slot,
      name,
      paymentType,
      paidAmount,
      willBeRemoved,
      orderDeductionAmount,
      extraDeduction,
      deductionAmount: willBeRemoved ? totalDeduction : 0,
      potentialDeductionAmount: totalDeduction,
      note
    });
  }

  let newTechnician = null;
  if (newTechnicianId) {
    const doc = await Technician.findById(newTechnicianId).select('name paymentType').lean();
    if (doc) {
      const price = getTechnicianStatusPrice(settings, doc._id, customerStatus);
      newTechnician = {
        technicianId: doc._id.toString(),
        name: doc.name,
        paymentType: doc.paymentType || 'po_statusu',
        expectedPay: (doc.paymentType || 'po_statusu') === 'po_statusu' ? price : null
      };
    }
  }

  return {
    workOrderId: workOrder._id.toString(),
    wasVerified: !!standardTx,
    customerStatus,
    penaltyPercent: workOrder.rejectionPenaltyPercent || 0,
    technicians,
    newTechnician
  };
};

// Opis odbitka za reklamaciju (tabela obračuna, mejl, finansije)
const complaintDeductionLabel = (kind, relatedJob) => {
  if (kind === 'complaint_order') return 'Reklamacija — nalog se ne plaća';
  if (kind === 'complaint_extra') return `Skinut zbog reklamacije naloga ${relatedJob || ''}`.trim();
  if (kind === 'complaint_extra_fallback') {
    return `Dodatni odbitak zbog reklamacije${relatedJob ? ` naloga ${relatedJob}` : ''} (nema drugog naloga iste kategorije)`;
  }
  return 'Reklamacija — odbitak';
};

// Odbitak za reklamaciju kao posebna finansijska stavka (datirana danom reklamacije).
// workOrder je nalog na koji se odbitak odnosi (kod 'complaint_extra' to je dodatno skinuti nalog),
// relatedWorkOrder je reklamirani nalog.
const createComplaintDeductionEntry = async ({ kind, workOrder, relatedWorkOrder, customerStatus, technician, amount, grossEarnings, createdBy }) => {
  const relatedJob = relatedWorkOrder?.tisJobId || relatedWorkOrder?.tisId || '';
  const entry = new FinancialTransaction({
    workOrderId: workOrder._id,
    entryType: 'complaint_deduction',
    deductionKind: kind,
    relatedWorkOrderId: relatedWorkOrder?._id,
    relatedTisJobId: relatedWorkOrder?.tisJobId || '',
    relatedTisId: relatedWorkOrder?.tisId || '',
    customerStatus,
    municipality: workOrder.municipality || 'Nepoznata opština',
    basePrice: 0,
    discountPercent: 0,
    discountAmount: 0,
    finalPrice: 0,
    technicians: [{
      technicianId: technician.technicianId,
      name: technician.name,
      earnings: -amount,
      grossEarnings,
      penaltyPercent: 0,
      penaltyAmount: 0,
      paymentType: technician.paymentType
    }],
    totalTechnicianEarnings: -amount,
    companyProfit: amount,
    verifiedAt: new Date(),
    verifiedBy: createdBy,
    tisJobId: workOrder.tisJobId,
    notes: complaintDeductionLabel(kind, relatedJob)
  });
  await entry.save();
  return entry;
};

// Isplata tehničaru koji je ispravio nalog posle reklamacije, kada je nalog već bio plaćen.
// Poziva se iz createFinancialTransaction kada redovna stavka već postoji.
// Vraća { ok: true } ili { ok: false, reason, message, field }.
const processPendingComplaintFixes = async (workOrderId) => {
  const workOrder = await WorkOrder.findById(workOrderId);
  if (!workOrder || !Array.isArray(workOrder.complaints)) return { ok: true, created: 0 };

  const pending = workOrder.complaints.filter(c => c.fixStatus === 'pending');
  if (pending.length === 0) return { ok: true, created: 0 };

  const standardTx = await FinancialTransaction.findOne({ workOrderId, ...STANDARD_ENTRY_FILTER }).lean();
  if (!standardTx) return { ok: true, created: 0 };

  const [evidence, settings] = await Promise.all([
    WorkOrderEvidence.findOne({ workOrderId }).select('customerStatus').lean(),
    FinancialSettings.findOne().lean()
  ]);
  const customerStatus = evidence?.customerStatus || standardTx.customerStatus;
  const penaltyPercent = workOrder.rejectionPenaltyPercent || 0;
  const assigned = [idOf(workOrder.technicianId), idOf(workOrder.technician2Id)].filter(Boolean);

  let created = 0;
  for (const complaint of pending) {
    const fixTechId = complaint.newTechnicianId;

    if (!assigned.some(id => sameId(id, fixTechId))) {
      complaint.fixStatus = 'not_applicable';
      complaint.fixNote = 'Tehničar kome je dodeljena ispravka više nije na nalogu — isplata nije kreirana.';
      continue;
    }

    const techDoc = await Technician.findById(fixTechId).lean();
    if (!techDoc) {
      complaint.fixStatus = 'not_applicable';
      complaint.fixNote = 'Tehničar kome je dodeljena ispravka ne postoji u sistemu.';
      continue;
    }

    const paymentType = techDoc.paymentType || 'po_statusu';
    let grossEarnings = 0;
    let salaryDetails;

    if (paymentType === 'po_statusu') {
      grossEarnings = getTechnicianStatusPrice(settings, techDoc._id, customerStatus);
      if (!grossEarnings) {
        await workOrder.save({ validateModifiedOnly: true });
        return {
          ok: false,
          reason: 'MISSING_TECHNICIAN_PRICING',
          message: `Ispravka po reklamaciji: cena za tehničara "${techDoc.name}" nije postavljena za tip usluge: ${customerStatus}`,
          field: { field: 'technicianPrices', description: `Potrebno je postaviti cenu za tehničara "${techDoc.name}" za tip usluge "${customerStatus}" u Finansije sekciji` }
        };
      }
    } else {
      // Plata: ispravka se računa ka mesečnoj plati kao i redovan nalog (osnovica = prihod naloga)
      const monthlySalary = techDoc.monthlySalary || 0;
      const previouslyEarned = await getTechnicianMonthlyEarnings(techDoc._id, new Date());
      const remainingToSalary = monthlySalary - previouslyEarned;
      const revenue = standardTx.finalPrice || 0;
      const toSalary = remainingToSalary > 0 ? Math.min(remainingToSalary, revenue) : 0;
      grossEarnings = round2(toSalary);
      salaryDetails = {
        monthlySalary,
        earnedTowardsSalary: grossEarnings,
        previouslyEarned,
        exceededSalary: remainingToSalary <= 0,
        excessAmount: 0
      };
    }

    const { net, penaltyAmount } = applyPenalty(grossEarnings, penaltyPercent);
    if (salaryDetails) salaryDetails.earnedTowardsSalary = net;

    const fixDate = workOrder.status === 'zavrsen' && workOrder.statusChangedAt ? workOrder.statusChangedAt : new Date();
    const entry = new FinancialTransaction({
      workOrderId,
      entryType: 'complaint_fix',
      customerStatus: standardTx.customerStatus,
      municipality: workOrder.municipality || standardTx.municipality,
      basePrice: 0,
      discountPercent: 0,
      discountAmount: 0,
      finalPrice: 0,
      technicians: [{
        technicianId: techDoc._id,
        name: techDoc.name,
        earnings: net,
        grossEarnings,
        penaltyPercent,
        penaltyAmount,
        paymentType,
        salaryDetails
      }],
      totalTechnicianEarnings: net,
      companyProfit: -net,
      rejectionPenaltyPercent: penaltyPercent,
      rejectionCount: workOrder.rejectionPenaltyCount || 0,
      verifiedAt: fixDate,
      tisJobId: workOrder.tisJobId,
      notes: 'Ispravka po reklamaciji'
    });
    await entry.save();

    complaint.fixStatus = 'paid';
    complaint.fixAmount = net;
    complaint.fixTransactionId = entry._id;
    complaint.fixNote = penaltyPercent > 0 ? `Umanjeno ${penaltyPercent}% zbog vraćanja naloga.` : '';
    created++;
  }

  await workOrder.save({ validateModifiedOnly: true });
  return { ok: true, created };
};

// Mesečni obračun tehničara za period (datumi 'YYYY-MM-DD', isti filter kao na stranici Finansije)
const buildTechnicianStatement = async (technicianId, dateFrom, dateTo) => {
  const technician = await Technician.findById(technicianId)
    .select('name gmail paymentType monthlySalary')
    .lean();
  if (!technician) return null;

  const transactions = await FinancialTransaction.find({
    'technicians.technicianId': technician._id,
    verifiedAt: {
      $gte: new Date(dateFrom + 'T00:00:00.000Z'),
      $lte: new Date(dateTo + 'T23:59:59.999Z')
    }
  })
    .populate('workOrderId', 'tisId tisJobId date originalDate address municipality')
    .lean();

  const rows = transactions.map(tx => {
    const techEntry = tx.technicians.find(t => t.technicianId.toString() === technician._id.toString()) || {};
    const wo = tx.workOrderId && typeof tx.workOrderId === 'object' ? tx.workOrderId : null;
    const entryType = tx.entryType || 'standard';
    const relatedJob = tx.relatedTisJobId || tx.relatedTisId || '';
    let label = '';
    if (entryType === 'complaint_deduction') label = complaintDeductionLabel(tx.deductionKind, relatedJob);
    if (entryType === 'complaint_fix') label = 'Ispravka po reklamaciji';
    return {
      transactionId: tx._id,
      workOrderId: wo?._id || tx.workOrderId || null,
      entryType,
      deductionKind: tx.deductionKind || null,
      relatedTisJobId: tx.relatedTisJobId || '',
      relatedTisId: tx.relatedTisId || '',
      label,
      tisId: wo?.tisId || '',
      tisJobId: wo?.tisJobId || tx.tisJobId || '',
      workOrderDate: wo?.originalDate || wo?.date || null,
      address: wo?.address || '',
      municipality: wo?.municipality || tx.municipality || '',
      customerStatus: tx.customerStatus,
      earnings: round2(techEntry.earnings),
      grossEarnings: techEntry.grossEarnings !== undefined && techEntry.grossEarnings !== null
        ? round2(techEntry.grossEarnings)
        : round2(techEntry.earnings),
      penaltyPercent: techEntry.penaltyPercent || 0,
      penaltyAmount: round2(techEntry.penaltyAmount),
      paymentType: techEntry.paymentType || 'po_statusu',
      transactionDate: tx.verifiedAt,
      note: entryType === 'standard' ? '' : (tx.notes || '')
    };
  });

  rows.sort((a, b) => {
    const da = a.workOrderDate ? new Date(a.workOrderDate).getTime() : 0;
    const db = b.workOrderDate ? new Date(b.workOrderDate).getTime() : 0;
    if (da !== db) return da - db;
    return new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime();
  });

  const summary = {
    ordersCount: rows.filter(r => r.entryType !== 'complaint_deduction').length,
    totalEarnings: round2(rows.reduce((sum, r) => sum + r.earnings, 0)),
    totalPenalties: round2(rows.reduce((sum, r) => sum + (r.penaltyAmount || 0), 0)),
    penalizedCount: rows.filter(r => r.penaltyPercent > 0).length,
    complaintDeductions: round2(rows.filter(r => r.entryType === 'complaint_deduction').reduce((sum, r) => sum + r.earnings, 0)),
    complaintDeductionsCount: rows.filter(r => r.entryType === 'complaint_deduction').length
  };

  return {
    technician: {
      _id: technician._id,
      name: technician.name,
      gmail: technician.gmail || '',
      paymentType: technician.paymentType || 'po_statusu',
      monthlySalary: technician.monthlySalary || 0
    },
    period: { dateFrom, dateTo },
    rows,
    summary
  };
};

module.exports = {
  PENALTY_STEP_PERCENT,
  PENALTY_MAX_STEPS,
  ADJUSTMENT_ENTRY_TYPES,
  STANDARD_ENTRY_FILTER,
  round2,
  penaltyPercentForCount,
  applyPenalty,
  getTechnicianStatusPrice,
  getTechnicianMonthlyEarnings,
  getPaidAmountForWorkOrder,
  findLastSameCategoryOrder,
  complaintDeductionLabel,
  buildComplaintPlan,
  createComplaintDeductionEntry,
  processPendingComplaintFixes,
  buildTechnicianStatement
};
