const express = require('express');
const router = express.Router();
const { Notification, User } = require('../models');
const { auth } = require('../middleware/auth');

// GET /api/notifications - Get all notifications for current user
router.get('/', auth, async (req, res) => {
  try {
    
    const notifications = await Notification.find({
      recipientId: req.user.id
    })
    .populate('createdBy', 'name')
    .populate('technicianId', 'name')
    .populate('workOrderId', 'tisJobId jobId')
    .populate('vehicleId', 'name licensePlate')
    .sort({ createdAt: -1 })
    .limit(50); // Limit to latest 50 notifications
    

    const formattedNotifications = notifications.map(notification => ({
      id: notification._id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      priority: notification.priority,
      isRead: notification.isRead,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      timeAgo: notification.timeAgo,
      formattedTimestamp: notification.formattedTimestamp,
      
      // Navigation data
      targetPage: notification.targetPage,
      targetTab: notification.targetTab,
      targetId: notification.targetId,
      
      // User info
      user: {
        name: notification.technicianName || (notification.createdBy?.name) || 'System',
        fallback: notification.technicianName ? 
          notification.technicianName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) :
          'S'
      },
      
      // Type specific data
      workOrder: notification.workOrderId ? {
        id: notification.workOrderId._id,
        jobId: notification.workOrderId.jobId,
        tisJobId: notification.workOrderId.tisJobId
      } : null,
      
      vehicle: notification.vehicleId ? {
        id: notification.vehicleId._id,
        name: notification.vehicleId.name,
        licensePlate: notification.vehicleId.licensePlate
      } : null,
      
      material: notification.materialName ? {
        name: notification.materialName,
        anomalyType: notification.anomalyType
      } : null
    }));

    res.json({
      success: true,
      notifications: formattedNotifications,
      totalCount: notifications.length,
      unreadCount: notifications.filter(n => !n.isRead).length
    });

  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri dohvaćanju notifikacija',
      error: error.message
    });
  }
});

// GET /api/notifications/unread - Get only unread notifications count
router.get('/unread', auth, async (req, res) => {
  try {
    
    const unreadCount = await Notification.countDocuments({
      recipientId: req.user.id,
      isRead: false
    });
    

    res.json({
      success: true,
      unreadCount
    });

  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri dohvaćanju broja nepročitanih notifikacija',
      error: error.message
    });
  }
});

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', auth, async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      recipientId: req.user.id
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notifikacija nije pronađena'
      });
    }

    await notification.markAsRead();

    res.json({
      success: true,
      message: 'Notifikacija označena kao pročitana'
    });

  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri označavanju notifikacije kao pročitane',
      error: error.message
    });
  }
});

// PUT /api/notifications/mark-all-read - Mark all notifications as read
router.put('/mark-all-read', auth, async (req, res) => {
  try {
    await Notification.updateMany(
      { 
        recipientId: req.user.id,
        isRead: false 
      },
      {
        isRead: true,
        readAt: new Date(new Date().getTime() + (2 * 60 * 60 * 1000)) // Serbian timezone (UTC+2)
      }
    );

    res.json({
      success: true,
      message: 'Sve notifikacije označene kao pročitane'
    });

  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri označavanju svih notifikacija kao pročitane',
      error: error.message
    });
  }
});

// PUT /api/notifications/mark-selected-read - Mark selected notifications as read
router.put('/mark-selected-read', auth, async (req, res) => {
  try {
    const { notificationIds } = req.body;

    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Lista ID-jeva notifikacija je obavezna'
      });
    }

    await Notification.updateMany(
      { 
        _id: { $in: notificationIds },
        recipientId: req.user.id,
        isRead: false 
      },
      {
        isRead: true,
        readAt: new Date(new Date().getTime() + (2 * 60 * 60 * 1000)) // Serbian timezone (UTC+2)
      }
    );

    res.json({
      success: true,
      message: 'Označene notifikacije su označene kao pročitane'
    });

  } catch (error) {
    console.error('Error marking selected notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri označavanju izabranih notifikacija kao pročitane',
      error: error.message
    });
  }
});

// DELETE /api/notifications/:id - Delete notification
router.delete('/:id', auth, async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      recipientId: req.user.id
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notifikacija nije pronađena'
      });
    }

    res.json({
      success: true,
      message: 'Notifikacija obrisana'
    });

  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({
      success: false,
      message: 'Greška pri brisanju notifikacije',
      error: error.message
    });
  }
});

// Utility function to create notifications (for internal use)
async function createNotification(type, data) {
  try {
    
    let notification;
    
    switch (type) {
      case 'work_order_verification':
        notification = await Notification.createWorkOrderVerification(
          data.workOrderId,
          data.technicianId,
          data.technicianName,
          data.recipientId
        );
        break;
        
      case 'material_anomaly':
        notification = await Notification.createMaterialAnomaly(
          data.logId,
          data.technicianId,
          data.technicianName,
          data.workOrderId,
          data.materialName,
          data.anomalyType,
          data.recipientId
        );
        break;
        
      case 'vehicle_registration_expiry':
        notification = await Notification.createVehicleRegistrationExpiry(
          data.vehicleId,
          data.vehicleName,
          data.licensePlate,
          data.expiryDate,
          data.recipientId
        );
        break;
        
      default:
        throw new Error('Nepoznat tip notifikacije');
    }
    
    return notification;
    
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
}

// Export the utility function for use in other routes
router.createNotification = createNotification;

module.exports = router;