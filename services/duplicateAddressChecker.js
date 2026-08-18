const WorkOrder = require('../models/WorkOrder');
const Technician = require('../models/Technician');
const Notification = require('../models/Notification');

// Provera pri importu: da li na istoj adresi postoji ranije OTKAZAN nalog.
// Radi ASINHRONO u pozadini posle importa — sekvencijalno, sa pauzom između
// naloga, da masovni import ne optereti bazu i ne blokira platformu.

// Pauza između obrade dva naloga (namerno "polako lagano")
const PACE_MS = 300;
// Ako import flaguje više od ovoliko naloga, šalje se JEDNA zbirna notifikacija
// umesto bombardovanja admina pojedinačnim
const PER_ORDER_NOTIFICATION_LIMIT = 10;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Adrese iz Excela variraju u velikim/malim slovima i razmacima — poređenje je
// case-insensitive sa tolerancijom na višestruke razmene (regex sa \s+)
function addressPattern(address) {
  const collapsed = (address || '').trim().replace(/\s+/g, ' ');
  if (!collapsed) return null;
  const pattern = collapsed.split(' ').map(escapeRegex).join('\\s+');
  return new RegExp(`^\\s*${pattern}\\s*$`, 'i');
}

/**
 * Proveri jedan nalog: postoji li OTKAZAN nalog na istoj adresi (bez njega samog).
 * Vraća broj pronađenih otkazanih ili null ako je provera preskočena.
 */
async function checkSingleOrder(orderId) {
  const order = await WorkOrder.findById(orderId)
    .select('address tisId duplicateAddressCheckedAt')
    .lean();
  if (!order) return null;
  // Već proveren (npr. ponovljen import istog fajla) — ne diraj, ne notifikuj ponovo
  if (order.duplicateAddressCheckedAt) return null;

  const pattern = addressPattern(order.address);
  let canceledCount = 0;
  if (pattern) {
    canceledCount = await WorkOrder.countDocuments({
      _id: { $ne: order._id },
      status: 'otkazan',
      address: pattern
    });
  }

  await WorkOrder.updateOne(
    { _id: order._id },
    {
      $set: {
        duplicateAddressFlagged: canceledCount > 0,
        duplicateAddressCanceledCount: canceledCount,
        duplicateAddressCheckedAt: new Date()
      }
    }
  );

  return { orderId: order._id, tisId: order.tisId || '', address: order.address || '', canceledCount };
}

/**
 * Pozadinska obrada liste naloga posle importa. NE await-ovati iz rute —
 * poziva se fire-and-forget, odgovor importa ne čeka na ovo.
 */
async function checkOrdersInBackground(orderIds) {
  try {
    if (!Array.isArray(orderIds) || orderIds.length === 0) return;
    console.log(`[DuplicateAddress] Pozadinska provera ${orderIds.length} importovanih naloga...`);

    const flagged = [];
    for (const id of orderIds) {
      try {
        const result = await checkSingleOrder(id);
        if (result && result.canceledCount > 0) flagged.push(result);
      } catch (err) {
        console.error(`[DuplicateAddress] Greška za nalog ${id}:`, err.message);
      }
      await sleep(PACE_MS);
    }

    console.log(`[DuplicateAddress] Gotovo: ${flagged.length}/${orderIds.length} naloga na adresama otkazanih.`);
    if (flagged.length === 0) return;

    // Notifikacije adminima (Notification post-save hook automatski šalje i web push)
    const admins = await Technician.find({ isAdmin: true }).select('_id');
    if (flagged.length > PER_ORDER_NOTIFICATION_LIMIT) {
      for (const admin of admins) {
        await Notification.createDuplicateAddressSummary(flagged.length, admin._id)
          .catch(err => console.error('[DuplicateAddress] Zbirna notifikacija nije kreirana:', err.message));
        await sleep(100);
      }
    } else {
      for (const f of flagged) {
        for (const admin of admins) {
          await Notification.createDuplicateAddress(f.orderId, f.tisId, f.address, f.canceledCount, admin._id)
            .catch(err => console.error('[DuplicateAddress] Notifikacija nije kreirana:', err.message));
          await sleep(100);
        }
      }
    }
  } catch (error) {
    console.error('[DuplicateAddress] Pozadinska provera pala:', error.message);
  }
}

module.exports = { checkOrdersInBackground, checkSingleOrder, addressPattern };
