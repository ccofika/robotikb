const AndroidNotification = require('../models/AndroidNotification');
const Technician = require('../models/Technician');

class AndroidNotificationService {
  /**
   * Kreiranje notifikacije za novi radni nalog
   * @param {String} technicianId - ID tehničara
   * @param {Object} workOrderData - Podaci o radnom nalogu { address, municipality, date, time, orderId }
   */
  async createWorkOrderNotification(technicianId, workOrderData) {
    try {
      const notification = await AndroidNotification.createWorkOrderNotification(
        technicianId,
        workOrderData
      );

      console.log(`✅ Android notifikacija kreirana - Radni nalog za tehničara ${technicianId}`);

      // Pokušaj slanja push notifikacije (non-blocking)
      setImmediate(async () => {
        try {
          await this.sendPushNotification(notification);
        } catch (error) {
          console.error('⚠️ Push notifikacija nije poslata:', error.message);
        }
      });

      return {
        success: true,
        notification
      };

    } catch (error) {
      console.error('❌ Greška pri kreiranju Android notifikacije (radni nalog):', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Kreiranje notifikacije za dodjeljivanje opreme
   * @param {String} technicianId - ID tehničara
   * @param {Array} equipmentList - Lista opreme sa detaljima
   */
  async createEquipmentAddNotification(technicianId, equipmentList) {
    try {
      const notification = await AndroidNotification.createEquipmentAddNotification(
        technicianId,
        equipmentList
      );

      console.log(`✅ Android notifikacija kreirana - Oprema dodana tehničaru ${technicianId} (${equipmentList.length} stavki)`);

      // Pokušaj slanja push notifikacije (non-blocking)
      setImmediate(async () => {
        try {
          await this.sendPushNotification(notification);
        } catch (error) {
          console.error('⚠️ Push notifikacija nije poslata:', error.message);
        }
      });

      return {
        success: true,
        notification
      };

    } catch (error) {
      console.error('❌ Greška pri kreiranju Android notifikacije (oprema dodana):', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Kreiranje notifikacije za uklanjanje opreme
   * @param {String} technicianId - ID tehničara
   * @param {Array} equipmentList - Lista opreme sa detaljima
   */
  async createEquipmentRemoveNotification(technicianId, equipmentList) {
    try {
      const notification = await AndroidNotification.createEquipmentRemoveNotification(
        technicianId,
        equipmentList
      );

      console.log(`✅ Android notifikacija kreirana - Oprema uklonjena od tehničara ${technicianId} (${equipmentList.length} stavki)`);

      // Pokušaj slanja push notifikacije (non-blocking)
      setImmediate(async () => {
        try {
          await this.sendPushNotification(notification);
        } catch (error) {
          console.error('⚠️ Push notifikacija nije poslata:', error.message);
        }
      });

      return {
        success: true,
        notification
      };

    } catch (error) {
      console.error('❌ Greška pri kreiranju Android notifikacije (oprema uklonjena):', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Slanje push notifikacije preko Expo Push API
   * @param {Object} notification - AndroidNotification objekat
   */
  async sendPushNotification(notification) {
    try {
      // Pronadji tehničara i njegov push token
      const technician = await Technician.findById(notification.technicianId);

      if (!technician || !technician.pushNotificationToken) {
        console.log(`⚠️ Tehničar ${notification.technicianId} nema registrovan push token`);
        return {
          success: false,
          error: 'No push token registered'
        };
      }

      const pushToken = technician.pushNotificationToken;

      // Proveri da li je token validan Expo push token
      if (!pushToken.startsWith('ExponentPushToken[')) {
        console.log(`⚠️ Nevažeći push token format: ${pushToken}`);
        return {
          success: false,
          error: 'Invalid push token format'
        };
      }

      // Pripremi push notification payload
      const message = {
        to: pushToken,
        sound: 'default',
        title: notification.title,
        body: notification.message,
        data: {
          notificationId: notification._id.toString(),
          type: notification.type,
          relatedId: notification.relatedId?.toString(),
          relatedData: notification.relatedData
        },
        priority: 'high',
        channelId: this.getChannelId(notification.type)
      };

      // Pošalji preko Expo Push API
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
      });

      const result = await response.json();

      if (result.data && result.data[0] && result.data[0].status === 'ok') {
        // Uspešno poslato
        notification.pushSent = true;
        notification.pushSentAt = new Date();
        notification.pushToken = pushToken;
        await notification.save();

        console.log(`✅ Push notifikacija poslata tehničaru ${technician.name} (${pushToken})`);

        return {
          success: true,
          ticketId: result.data[0].id
        };
      } else {
        // Neuspešno slanje
        const error = result.data?.[0]?.message || 'Unknown error';
        notification.pushError = error;
        await notification.save();

        console.error(`❌ Greška pri slanju push notifikacije:`, error);

        return {
          success: false,
          error
        };
      }

    } catch (error) {
      console.error('❌ Greška pri slanju push notifikacije:', error);

      // Sačuvaj grešku u notifikaciji
      notification.pushError = error.message;
      await notification.save();

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Vraća channel ID za tip notifikacije (Android notification channels)
   */
  getChannelId(type) {
    const channels = {
      'work_order': 'work-orders',
      'equipment_add': 'equipment-added',
      'equipment_remove': 'equipment-removed'
    };
    return channels[type] || 'default';
  }

  /**
   * Dohvati sve notifikacije za tehničara (posledn jih 7 dana)
   */
  async getNotificationsForTechnician(technicianId, limit = 50) {
    try {
      const notifications = await AndroidNotification.find({
        technicianId
      })
        .sort({ createdAt: -1 })
        .limit(limit);

      return {
        success: true,
        notifications
      };

    } catch (error) {
      console.error('❌ Greška pri dohvatanju notifikacija:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Broj nepročitanih notifikacija za tehničara
   */
  async getUnreadCount(technicianId) {
    try {
      const count = await AndroidNotification.countDocuments({
        technicianId,
        isRead: false
      });

      return {
        success: true,
        count
      };

    } catch (error) {
      console.error('❌ Greška pri dohvatanju broja nepročitanih:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new AndroidNotificationService();
