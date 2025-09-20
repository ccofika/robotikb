const mongoose = require('mongoose');
const Notification = require('../models/Notification');
require('dotenv').config();

// MongoDB connection string from environment
const MONGODB_URI = process.env.MONGODB_URI;

async function fixNotificationTimestamps() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected successfully');

    console.log('Finding all notifications...');
    const notifications = await Notification.find({});
    console.log(`Found ${notifications.length} notifications to update`);

    let updatedCount = 0;

    for (const notification of notifications) {
      // Add 2 hours (7200000 milliseconds) to existing timestamps
      const originalCreatedAt = notification.createdAt;
      const correctedCreatedAt = new Date(originalCreatedAt.getTime() + (2 * 60 * 60 * 1000));

      let correctedReadAt = null;
      if (notification.readAt) {
        correctedReadAt = new Date(notification.readAt.getTime() + (2 * 60 * 60 * 1000));
      }

      let correctedExpiresAt = null;
      if (notification.expiresAt) {
        correctedExpiresAt = new Date(notification.expiresAt.getTime() + (2 * 60 * 60 * 1000));
      }

      // Update the notification
      await Notification.updateOne(
        { _id: notification._id },
        {
          createdAt: correctedCreatedAt,
          ...(correctedReadAt && { readAt: correctedReadAt }),
          ...(correctedExpiresAt && { expiresAt: correctedExpiresAt })
        }
      );

      updatedCount++;

      if (updatedCount % 10 === 0) {
        console.log(`Updated ${updatedCount}/${notifications.length} notifications...`);
      }
    }

    console.log(`\nSuccessfully updated ${updatedCount} notifications!`);
    console.log('Timestamps have been corrected to Serbian timezone (UTC+2)');

  } catch (error) {
    console.error('Error fixing notification timestamps:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the script
fixNotificationTimestamps();