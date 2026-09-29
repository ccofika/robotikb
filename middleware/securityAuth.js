// Uloge u Security modulu:
//  - admin / superadmin / supervisor (Technician kolekcija): vide i menjaju sve
//  - coordinator (SecurityWorker): samo svoje objekte, pravi raspored i zadaje zadatke
//  - guard (SecurityWorker): samo svoje smene, iz Android aplikacije
const SecurityWorker = require('../models/SecurityWorker');

const ADMIN_ROLES = ['admin', 'superadmin', 'supervisor'];
const isAdminRole = (role) => ADMIN_ROLES.includes(role);

const deny = (res, msg = 'Nemate dozvolu za ovu radnju.') => res.status(403).json({ error: msg });

// Admin ili koordinator (svi web korisnici Security dela)
const isSecurityStaff = (req, res, next) => {
  if (req.user && (isAdminRole(req.user.role) || req.user.role === 'coordinator')) return next();
  return deny(res);
};

// Samo administratori (tagovi, pravila, radnici, objekti)
const isSecurityAdmin = (req, res, next) => {
  if (req.user && isAdminRole(req.user.role)) return next();
  return deny(res, 'Ovo mogu samo administrator i superadmin.');
};

const isGuard = (req, res, next) => {
  if (req.user && req.user.role === 'guard') return next();
  return deny(res, 'Ovo je samo za radnike obezbeđenja.');
};

// Objekti koje korisnik sme da vidi: null = svi (admin), inače niz id-jeva (string)
async function facilityScope(req) {
  if (!req.user) return [];
  if (isAdminRole(req.user.role)) return null;
  if (req._facilityScope) return req._facilityScope;
  const w = await SecurityWorker.findById(req.user.id).select('facilityIds');
  req._facilityScope = w ? w.facilityIds.map((f) => f.toString()) : [];
  return req._facilityScope;
}

async function canAccessFacility(req, facilityId) {
  const scope = await facilityScope(req);
  if (scope === null) return true;
  return !!facilityId && scope.includes(facilityId.toString());
}

// Mongo filter za kolekcije sa facilityId poljem
async function facilityFilter(req, field = 'facilityId') {
  const scope = await facilityScope(req);
  if (scope === null) return {};
  return { [field]: { $in: scope } };
}

module.exports = {
  ADMIN_ROLES, isAdminRole, isSecurityStaff, isSecurityAdmin, isGuard,
  facilityScope, canAccessFacility, facilityFilter
};
