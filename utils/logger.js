const { Log, Technician } = require('../models');
const notificationsRouter = require('../routes/notifications');
const createNotification = notificationsRouter.createNotification;

// Helper funkcija za kreiranje log zapisa
const createLog = async (logData) => {
  try {
    const {
      action,
      description,
      performedBy,
      performedByName,
      workOrderId,
      workOrderInfo,
      materialDetails,
      equipmentDetails,
      imageDetails,
      statusChange,
      commentText,
      metadata = {}
    } = logData;

    const log = new Log({
      action,
      description,
      performedBy,
      performedByName,
      workOrderId,
      workOrderInfo,
      materialDetails,
      equipmentDetails,
      imageDetails,
      statusChange,
      commentText,
      metadata
    });

    await log.save();
    console.log('Log kreiran uspešno:', action, description);
    return log;
  } catch (error) {
    console.error('Greška pri kreiranju log zapisa:', error);
    return null;
  }
};

// Specific logging functions
const logMaterialAdded = async (technicianId, technicianName, workOrder, material, quantity) => {
  return createLog({
    action: 'material_added',
    description: `Dodao/dodala materijal: ${material.type} (količina: ${quantity})`,
    performedBy: technicianId,
    performedByName: technicianName,
    workOrderId: workOrder._id,
    workOrderInfo: {
      municipality: workOrder.municipality,
      address: workOrder.address,
      type: workOrder.type,
      tisId: workOrder.tisId,
      userName: workOrder.userName
    },
    materialDetails: {
      materialId: material._id,
      materialType: material.type,
      quantity: quantity
    }
  });
};

const logMaterialRemoved = async (technicianId, technicianName, workOrder, material, quantity) => {
  return createLog({
    action: 'material_removed',
    description: `Uklonio/uklonila materijal: ${material.type} (količina: ${quantity})`,
    performedBy: technicianId,
    performedByName: technicianName,
    workOrderId: workOrder._id,
    workOrderInfo: {
      municipality: workOrder.municipality,
      address: workOrder.address,
      type: workOrder.type,
      tisId: workOrder.tisId,
      userName: workOrder.userName
    },
    materialDetails: {
      materialId: material._id,
      materialType: material.type,
      quantity: quantity
    }
  });
};

const logEquipmentAdded = async (technicianId, technicianName, workOrder, equipment) => {
  return createLog({
    action: 'equipment_added',
    description: `Dodao/dodala opremu: ${equipment.category} - ${equipment.description} (S/N: ${equipment.serialNumber})`,
    performedBy: technicianId,
    performedByName: technicianName,
    workOrderId: workOrder._id,
    workOrderInfo: {
      municipality: workOrder.municipality,
      address: workOrder.address,
      type: workOrder.type,
      tisId: workOrder.tisId,
      userName: workOrder.userName
    },
    equipmentDetails: {
      equipmentId: equipment._id,
      equipmentType: equipment.category,  // Promenio sa type na category
      serialNumber: equipment.serialNumber,
      description: equipment.description
    }
  });
};

const logEquipmentRemoved = async (technicianId, technicianName, workOrder, equipment, isWorking, removalReason) => {
  return createLog({
    action: 'equipment_removed',
    description: `Uklonio/uklonila opremu: ${equipment.category} - ${equipment.description} (S/N: ${equipment.serialNumber})${isWorking ? ' - oprema ispravna' : ' - oprema neispravna'}`,
    performedBy: technicianId,
    performedByName: technicianName,
    workOrderId: workOrder._id,
    workOrderInfo: {
      municipality: workOrder.municipality,
      address: workOrder.address,
      type: workOrder.type,
      tisId: workOrder.tisId,
      userName: workOrder.userName
    },
    equipmentDetails: {
      equipmentId: equipment._id,
      equipmentType: equipment.category,  // Promenio sa type na category
      serialNumber: equipment.serialNumber,
      description: equipment.description,
      isWorking: isWorking,
      removalReason: removalReason
    }
  });
};

const logCommentAdded = async (technicianId, technicianName, workOrder, comment) => {
  return createLog({
    action: 'comment_added',
    description: `Dodao/dodala komentar na radni nalog`,
    performedBy: technicianId,
    performedByName: technicianName,
    workOrderId: workOrder._id,
    workOrderInfo: {
      municipality: workOrder.municipality,
      address: workOrder.address,
      type: workOrder.type,
      tisId: workOrder.tisId,
      userName: workOrder.userName
    },
    commentText: comment
  });
};

const logWorkOrderStatusChanged = async (technicianId, technicianName, workOrder, oldStatus, newStatus) => {
  let description = '';
  
  switch (newStatus) {
    case 'zavrsen':
      description = 'Završio/završila radni nalog';
      break;
    case 'odlozen':
      description = 'Odložio/odložila radni nalog';
      break;
    case 'otkazan':
      description = 'Otkazao/otkazala radni nalog';
      break;
    default:
      description = `Promenio/promenila status radnog naloga sa "${oldStatus}" na "${newStatus}"`;
  }

  return createLog({
    action: newStatus === 'zavrsen' ? 'workorder_finished' : 
            newStatus === 'odlozen' ? 'workorder_postponed' :
            newStatus === 'otkazan' ? 'workorder_cancelled' : 'workorder_status_changed',
    description: description,
    performedBy: technicianId,
    performedByName: technicianName,
    workOrderId: workOrder._id,
    workOrderInfo: {
      municipality: workOrder.municipality,
      address: workOrder.address,
      type: workOrder.type,
      tisId: workOrder.tisId,
      userName: workOrder.userName
    },
    statusChange: {
      oldStatus: oldStatus,
      newStatus: newStatus
    }
  });
};

const logImageAdded = async (technicianId, technicianName, workOrder, imageName, imageUrl) => {
  return createLog({
    action: 'image_added',
    description: `Dodao/dodala sliku: ${imageName}`,
    performedBy: technicianId,
    performedByName: technicianName,
    workOrderId: workOrder._id,
    workOrderInfo: {
      municipality: workOrder.municipality,
      address: workOrder.address,
      type: workOrder.type,
      tisId: workOrder.tisId,
      userName: workOrder.userName
    },
    imageDetails: {
      imageName: imageName,
      imageUrl: imageUrl
    }
  });
};

const logImageRemoved = async (technicianId, technicianName, workOrder, imageName, imageUrl) => {
  return createLog({
    action: 'image_removed',
    description: `Uklonio/uklonila sliku: ${imageName}`,
    performedBy: technicianId,
    performedByName: technicianName,
    workOrderId: workOrder._id,
    workOrderInfo: {
      municipality: workOrder.municipality,
      address: workOrder.address,
      type: workOrder.type,
      tisId: workOrder.tisId,
      userName: workOrder.userName
    },
    imageDetails: {
      imageName: imageName,
      imageUrl: imageUrl
    }
  });
};

const logWorkOrderCreated = async (adminId, adminName, workOrder) => {
  return createLog({
    action: 'workorder_created',
    description: `Kreirao/kreirala novi radni nalog`,
    performedBy: adminId,
    performedByName: adminName,
    workOrderId: workOrder._id,
    workOrderInfo: {
      municipality: workOrder.municipality,
      address: workOrder.address,
      type: workOrder.type,
      tisId: workOrder.tisId,
      userName: workOrder.userName
    }
  });
};

const logWorkOrderAssigned = async (adminId, adminName, workOrder, technicianName) => {
  return createLog({
    action: 'workorder_assigned',
    description: `Dodelio/dodelila radni nalog tehničaru: ${technicianName}`,
    performedBy: adminId,
    performedByName: adminName,
    workOrderId: workOrder._id,
    workOrderInfo: {
      municipality: workOrder.municipality,
      address: workOrder.address,
      type: workOrder.type,
      tisId: workOrder.tisId,
      userName: workOrder.userName
    },
    metadata: {
      assignedTechnicianName: technicianName
    }
  });
};

const logWorkOrderUpdated = async (adminId, adminName, workOrder) => {
  return createLog({
    action: 'workorder_updated',
    description: `Ažurirao/ažurirala radni nalog`,
    performedBy: adminId,
    performedByName: adminName,
    workOrderId: workOrder._id,
    workOrderInfo: {
      municipality: workOrder.municipality,
      address: workOrder.address,
      type: workOrder.type,
      tisId: workOrder.tisId,
      userName: workOrder.userName
    }
  });
};

// Function to detect material anomalies and create notifications
const checkMaterialAnomaly = async (technicianId, technicianName, workOrder, material, quantity, logId) => {
  try {
    // Get recent material usage data for anomaly detection (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentLogs = await Log.find({
      action: 'material_added',
      'materialDetails.materialType': material.type,
      timestamp: { $gte: thirtyDaysAgo }
    });

    if (recentLogs.length < 5) {
      // Not enough data for anomaly detection
      return;
    }

    // Calculate average and standard deviation
    const quantities = recentLogs.map(log => log.materialDetails.quantity);
    const average = quantities.reduce((sum, q) => sum + q, 0) / quantities.length;
    const variance = quantities.reduce((sum, q) => sum + Math.pow(q - average, 2), 0) / quantities.length;
    const standardDeviation = Math.sqrt(variance);
    
    // Threshold: 2 standard deviations above average
    const threshold = average + (2 * standardDeviation);

    // Check if current usage exceeds threshold
    if (quantity > threshold) {
      console.log(`Material anomaly detected: ${material.type} - quantity ${quantity} exceeds threshold ${threshold.toFixed(2)}`);
      
      // Find all admin users to send notifications
      const adminUsers = await Technician.find({ isAdmin: true });
      
      if (adminUsers.length > 0) {
        const anomalyType = quantity > threshold * 1.5 ? 'high' : 'medium';
        
        for (const adminUser of adminUsers) {
          try {
            await createNotification('material_anomaly', {
              logId: logId,
              technicianId: technicianId,
              technicianName: technicianName,
              workOrderId: workOrder._id,
              materialName: material.type,
              anomalyType: anomalyType,
              recipientId: adminUser._id
            });
            
            console.log(`Created material anomaly notification for admin ${adminUser.name} - ${material.type} (${quantity} > ${threshold.toFixed(2)})`);
          } catch (notificationError) {
            console.error(`Error creating material anomaly notification for admin ${adminUser.name}:`, notificationError);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error in material anomaly detection:', error);
  }
};

module.exports = {
  createLog,
  logMaterialAdded,
  logMaterialRemoved,
  logEquipmentAdded,
  logEquipmentRemoved,
  logCommentAdded,
  logWorkOrderStatusChanged,
  logImageAdded,
  logImageRemoved,
  logWorkOrderCreated,
  logWorkOrderAssigned,
  logWorkOrderUpdated,
  checkMaterialAnomaly
}; 