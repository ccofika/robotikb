const AndroidNotification = require('../models/AndroidNotification');
const Technician = require('../models/Technician');
const axios = require('axios');

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

      // Pripremi push notification payload za Expo Push API
      // Format: Hybrid notification (title + body + data)
      // - Android OS automatski prikazuje notifikaciju u notification tray-u
      // - channelId određuje kako se notifikacija prikazuje (zvuk, vibracija, LED)
      // - data payload se prosleđuje u app kada korisnik tap-uje notifikaciju
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
        // KRITIČNO: channelId MORA da odgovara kanalu kreiranom u Android app-u
        // Ako kanal ne postoji, notifikacija NEĆE biti prikazana na Android 8+
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

  /**
   * Slanje push notifikacije svim tehničarima da sinhronizuju snimke poziva
   * Koristi se kada admin želi da pokrene sinhronizaciju sa weba
   */
  async sendSyncRecordingsNotificationToAll() {
    try {
      console.log('=== sendSyncRecordingsNotificationToAll START ===');
      console.log('📤 Slanje sync recordings notifikacije svim tehničarima...');

      // Debug: proveri SVE tehničare i njihove tokene
      const allTechnicians = await Technician.find({})
        .select('name pushNotificationToken pushNotificationsEnabled phoneNumber');

      console.log(`DEBUG: Ukupno tehničara u bazi: ${allTechnicians.length}`);

      // Filtriraj samo one sa VALIDNIM tokenom (string koji počinje sa ExponentPushToken)
      const technicians = allTechnicians.filter(t => {
        const token = t.pushNotificationToken;
        const isValid = typeof token === 'string' &&
                       token.length > 0 &&
                       token.startsWith('ExponentPushToken[');
        return isValid;
      });

      // Debug: prikaži sve tehničare i status njihovog tokena
      console.log('DEBUG: Status tokena svih tehničara:');
      allTechnicians.forEach(t => {
        const token = t.pushNotificationToken;
        let status;
        if (token === null || token === undefined) {
          status = '❌ NULL/UNDEFINED - nije instalirao app';
        } else if (token === '') {
          status = '⚠️  PRAZAN STRING';
        } else if (typeof token === 'string' && token.startsWith('ExponentPushToken[')) {
          status = '✅ VALIDAN';
        } else {
          status = '❓ NEVAŽEĆI FORMAT: ' + String(token).substring(0, 30);
        }
        console.log(`  ${t.name}: ${status}`);
      });

      console.log(`\nPronađeno ${technicians.length} tehničara sa VALIDNIM push tokenom`);

      // Ako nema tehničara sa validnim tokenom
      if (technicians.length === 0) {
        console.log('UPOZORENJE: Nema tehničara sa aktivnim push tokenima!');
        console.log('Tehničari moraju da instaliraju i otvore mobilnu aplikaciju.');
        return {
          success: true,
          totalTechnicians: allTechnicians.length,
          successCount: 0,
          failCount: 0,
          message: 'Nema tehničara sa aktivnim push tokenima. Tehničari moraju instalirati mobilnu aplikaciju.'
        };
      }

      // Prikaži tehničare koji će dobiti notifikaciju
      console.log('Tehničari koji će dobiti notifikaciju:', technicians.map(t => t.name));

      let successCount = 0;
      let failCount = 0;
      const errors = [];

      for (const technician of technicians) {
        try {
          const pushToken = technician.pushNotificationToken;

          // Pošalji silent data-only notifikaciju za sync
          const message = {
            to: pushToken,
            data: {
              type: 'sync_recordings',
              action: 'trigger_sync',
              timestamp: new Date().toISOString()
            },
            priority: 'high',
            // Za Android - data-only notifikacija
            _contentAvailable: true
          };

          console.log(`Sending to ${technician.name}...`);
          const response = await axios.post('https://exp.host/--/api/v2/push/send', message, {
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            timeout: 10000 // 10 second timeout
          });

          const result = response.data;
          console.log(`Response for ${technician.name}:`, JSON.stringify(result));

          if (result.data && result.data[0] && result.data[0].status === 'ok') {
            console.log(`✅ Sync notifikacija poslata: ${technician.name}`);
            successCount++;
          } else {
            const errorMsg = result.data?.[0]?.message || 'Unknown error';
            console.log(`❌ Neuspešno za ${technician.name}:`, errorMsg);
            failCount++;
            errors.push({ name: technician.name, error: errorMsg });
          }

        } catch (techError) {
          console.error(`❌ Greška za ${technician.name}:`, techError.message);
          if (techError.response) {
            console.error('Response data:', techError.response.data);
            console.error('Response status:', techError.response.status);
          }
          failCount++;
          errors.push({ name: technician.name, error: techError.message });
        }
      }

      console.log(`📊 Sync notifikacije: ${successCount} uspešno, ${failCount} neuspešno`);
      console.log('=== sendSyncRecordingsNotificationToAll END ===');

      return {
        success: true,
        totalTechnicians: technicians.length,
        successCount,
        failCount,
        errors: errors.length > 0 ? errors : undefined
      };

    } catch (error) {
      console.error('=== sendSyncRecordingsNotificationToAll ERROR ===');
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      return {
        success: false,
        error: error.message,
        errorName: error.name,
        errorStack: error.stack
      };
    }
  }
}

module.exports = new AndroidNotificationService();
