const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const AdminActivityLogSchema = new Schema({
  // Ko je izvršio akciju
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'Technician',
    required: true
  },
  userName: {
    type: String,
    required: true
  },
  userRole: {
    type: String,
    enum: ['admin', 'superadmin', 'supervisor'],
    required: true
  },

  // Detalji akcije
  action: {
    type: String,
    required: true,
    enum: [
      // Equipment actions
      'equipment_add', 'equipment_edit', 'equipment_delete',
      'equipment_assign', 'equipment_unassign', 'equipment_upload',
      'equipment_bulk_add',

      // Material actions
      'material_add', 'material_edit', 'material_delete',
      'material_assign', 'material_unassign',

      // Technician actions
      'technician_add', 'technician_edit', 'technician_delete',
      'equipment_assign_to_tech', 'equipment_unassign_from_tech',
      'material_assign_to_tech', 'material_unassign_from_tech',
      'basic_equipment_assign_to_tech',

      // WorkOrder actions
      'workorder_add', 'workorder_create', 'workorder_assign', 'workorder_edit', 'workorder_update',
      'workorder_delete', 'workorder_upload', 'workorder_bulk_add', 'workorder_return_incorrect',

      // User actions
      'user_add', 'user_edit', 'user_delete',

      // Settings actions
      'settings_update', 'permissions_change',
      'financial_settings_update',

      // Vehicle actions
      'vehicle_add', 'vehicle_edit', 'vehicle_delete',

      // Basic Equipment actions
      'basic_equipment_add', 'basic_equipment_edit', 'basic_equipment_delete',

      // Edit page actions (admin/superadmin/supervisor editing work orders)
      'edit_equipment_add', 'edit_equipment_remove',
      'edit_material_add', 'edit_material_remove'
    ]
  },

  category: {
    type: String,
    required: true,
    enum: ['equipment', 'materials', 'technicians', 'workorders', 'users', 'settings', 'vehicles', 'basic_equipment', 'finances', 'edit']
  },

  // Entitet koji je promenjen
  entityType: {
    type: String
  },
  entityId: {
    type: Schema.Types.ObjectId
  },
  entityName: {
    type: String
  },

  // Detalji promene
  details: {
    before: Schema.Types.Mixed,     // Stanje pre promene
    after: Schema.Types.Mixed,      // Stanje posle promene
    diff: Schema.Types.Mixed,       // Samo promenjeni podaci
    action: String,                 // bulk_created, created, updated, deleted, bulk_assigned, bulk_unassigned, added, removed
    summary: Schema.Types.Mixed,    // Za bulk operacije ili tekstualni opis izmena
    addedItems: Schema.Types.Mixed, // Za bulk operacije (bulk_created)
    assignedItems: Schema.Types.Mixed, // Za bulk assign/unassign operacije (bulk_assigned, bulk_unassigned)
    duplicates: Schema.Types.Mixed, // Za bulk operacije
    errors: Schema.Types.Mixed,     // Za bulk operacije
    changes: Schema.Types.Mixed,    // Array promenjenih polja (za updated akcije)
    changeCount: Number,            // Broj promena (za updated akcije)
    // Edit actions - equipment/material details
    equipment: Schema.Types.Mixed,  // Za edit akcije (oprema)
    material: Schema.Types.Mixed,   // Za edit akcije (materijal)
    workOrder: Schema.Types.Mixed   // Za edit akcije (radni nalog info)
  },

  // Request metadata
  metadata: {
    ipAddress: String,
    userAgent: String,
    requestDuration: Number,     // ms
    requestMethod: String,       // GET, POST, PUT, DELETE
    requestUrl: String
  },

  // Timestamp
  timestamp: {
    type: Date,
    default: Date.now,
    required: true
  }
}, {
  timestamps: true,
  // Auto-delete logova starijih od 90 dana
  expireAfterSeconds: 90 * 24 * 60 * 60  // 90 dana u sekundama
});

// Indeksi za brže pretrage
AdminActivityLogSchema.index({ userId: 1, timestamp: -1 });
AdminActivityLogSchema.index({ category: 1, timestamp: -1 });
AdminActivityLogSchema.index({ action: 1, timestamp: -1 });
AdminActivityLogSchema.index({ timestamp: -1 });
AdminActivityLogSchema.index({ userName: 1, timestamp: -1 });
AdminActivityLogSchema.index({ entityType: 1, entityId: 1, timestamp: -1 });

// Compound index za filtriranje po više kriterijuma
AdminActivityLogSchema.index({
  category: 1,
  action: 1,
  timestamp: -1
});

module.exports = mongoose.model('AdminActivityLog', AdminActivityLogSchema);
