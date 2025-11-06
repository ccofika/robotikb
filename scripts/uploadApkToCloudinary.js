// Script to add Google Drive APK to MongoDB
require('dotenv').config();
const mongoose = require('mongoose');
const ApkVersion = require('../models/ApkVersion');

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI;

async function addGoogleDriveApk() {
  try {
    console.log('🚀 Adding Google Drive APK to MongoDB...\n');

    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Version info
    const version = '1.0.2';
    const versionCode = 3;
    const googleDriveUrl = 'https://drive.usercontent.google.com/download?id=1cY1dey46jsflMczmmvu9vaUwms8z5ldF&export=download&authuser=0';
    const fileSize = 87596058; // 83.54 MB in bytes

    // Check if version already exists
    const existingVersion = await ApkVersion.findOne({
      $or: [
        { version },
        { versionCode }
      ]
    });

    let apkVersion;

    if (existingVersion) {
      console.log('⚠️  Version already exists, updating with Google Drive URL...');
      existingVersion.cloudinaryUrl = googleDriveUrl;
      existingVersion.fileSize = fileSize;
      apkVersion = await existingVersion.save();
      console.log('✅ Updated existing APK version in database');
    } else {
      console.log('📝 Creating new APK version entry...');
      apkVersion = new ApkVersion({
        version,
        versionCode,
        fileName: `robotik-mobile-v${version}.apk`,
        cloudinaryUrl: googleDriveUrl,
        fileSize: fileSize,
        changelog: [
          'Dodato automatsko snimanje i upload poziva sa ACR Phone aplikacije',
          'Dodato polje za broj telefona tehničara',
          'Poboljšana stabilnost aplikacije'
        ],
        isMandatory: false
      });

      await apkVersion.save();
      console.log('✅ Created new APK version in database');
    }

    console.log('\n📊 APK Version Info:');
    console.log('   ID:', apkVersion._id);
    console.log('   Version:', apkVersion.version);
    console.log('   VersionCode:', apkVersion.versionCode);
    console.log('   Download URL:', apkVersion.cloudinaryUrl);
    console.log('   File Size:', (apkVersion.fileSize / 1024 / 1024).toFixed(2), 'MB');
    console.log('   Mandatory:', apkVersion.isMandatory);
    console.log('   Active:', apkVersion.isActive);
    console.log('   Download Count:', apkVersion.downloadCount);
    console.log('   Published:', apkVersion.publishedAt);

    console.log('\n🎉 APK added to database successfully!\n');

    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('👋 Disconnected from MongoDB\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run the script
addGoogleDriveApk();
