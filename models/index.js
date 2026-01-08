const User = require('./User');
const Technician = require('./Technician');
const Material = require('./Material');
const BasicEquipment = require('./BasicEquipment');
const Equipment = require('./Equipment');
const WorkOrder = require('./WorkOrder');
const WorkOrderEvidence = require('./WorkOrderEvidence');
const Log = require('./Log');
const DismissedWorkOrder = require('./DismissedWorkOrder');
const Notification = require('./Notification');
const AndroidNotification = require('./AndroidNotification');
const FinancialTransaction = require('./FinancialTransaction');
const FinancialSettings = require('./FinancialSettings');
const AdminActivityLog = require('./AdminActivityLog');
const ErrorLog = require('./ErrorLog');
const PerformanceLog = require('./PerformanceLog');
const CallRecording = require('./CallRecording');

module.exports = {
  User,
  Technician,
  Material,
  BasicEquipment,
  Equipment,
  WorkOrder,
  WorkOrderEvidence,
  Log,
  DismissedWorkOrder,
  Notification,
  AndroidNotification,
  FinancialTransaction,
  FinancialSettings,
  AdminActivityLog,
  ErrorLog,
  PerformanceLog,
  CallRecording
}; 