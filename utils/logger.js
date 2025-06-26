const { Log } = require('../models');

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
    description: `Dodao/dodala opremu: ${equipment.type} - ${equipment.description || equipment.brand} (S/N: ${equipment.serialNumber})`,
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
      equipmentType: equipment.type,
      serialNumber: equipment.serialNumber,
      description: equipment.description || equipment.brand
    }
  });
};

const logEquipmentRemoved = async (technicianId, technicianName, workOrder, equipment, isWorking, removalReason) => {
  return createLog({
    action: 'equipment_removed',
    description: `Uklonio/uklonila opremu: ${equipment.type} - ${equipment.description || equipment.brand} (S/N: ${equipment.serialNumber})${isWorking ? ' - oprema ispravna' : ' - oprema neispravna'}`,
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
      equipmentType: equipment.type,
      serialNumber: equipment.serialNumber,
      description: equipment.description || equipment.brand,
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
  logWorkOrderUpdated
}; 