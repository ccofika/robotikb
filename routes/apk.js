const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const ApkVersion = require('../models/ApkVersion');

/**
 * @route   GET /api/apk/check-update
 * @desc    Check if a new APK version is available
 * @query   currentVersion - Current app version (e.g., "1.0.0")
 * @query   currentVersionCode - Current version code (e.g., 1)
 */
router.get('/check-update', async (req, res) => {
  try {
    const { currentVersion, currentVersionCode } = req.query;

    if (!currentVersion || !currentVersionCode) {
      return res.status(400).json({
        error: 'currentVersion and currentVersionCode are required'
      });
    }

    const currentCode = parseInt(currentVersionCode);

    // Find the latest active APK version
    const latestVersion = await ApkVersion.findOne({
      isActive: true,
      versionCode: { $gt: currentCode }
    }).sort({ versionCode: -1 });

    if (!latestVersion) {
      return res.json({
        updateAvailable: false,
        currentVersion,
        currentVersionCode: currentCode
      });
    }

    res.json({
      updateAvailable: true,
      currentVersion,
      currentVersionCode: currentCode,
      latestVersion: latestVersion.version,
      latestVersionCode: latestVersion.versionCode,
      changelog: latestVersion.changelog,
      isMandatory: latestVersion.isMandatory,
      fileSize: latestVersion.fileSize,
      publishedAt: latestVersion.publishedAt,
      downloadUrl: `/api/apk/download/${latestVersion._id}`
    });

  } catch (error) {
    console.error('Error checking for APK update:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @route   GET /api/apk/download/:id
 * @desc    Download APK file
 * @param   id - ApkVersion document ID
 */
router.get('/download/:id', async (req, res) => {
  try {
    const apkVersion = await ApkVersion.findById(req.params.id);

    if (!apkVersion) {
      return res.status(404).json({ error: 'APK version not found' });
    }

    const filePath = path.join(__dirname, '..', apkVersion.filePath);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      console.error('APK file not found:', filePath);
      return res.status(404).json({ error: 'APK file not found on server' });
    }

    // Increment download count
    apkVersion.downloadCount += 1;
    await apkVersion.save();

    // Set headers for APK download
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${apkVersion.fileName}"`);
    res.setHeader('Content-Length', apkVersion.fileSize);

    // Stream the file
    const fileStream = require('fs').createReadStream(filePath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Error downloading APK:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @route   GET /api/apk/latest
 * @desc    Get latest APK version info (for web display)
 */
router.get('/latest', async (req, res) => {
  try {
    const latestVersion = await ApkVersion.findOne({
      isActive: true
    }).sort({ versionCode: -1 });

    if (!latestVersion) {
      return res.status(404).json({ error: 'No APK version available' });
    }

    res.json({
      version: latestVersion.version,
      versionCode: latestVersion.versionCode,
      changelog: latestVersion.changelog,
      fileSize: latestVersion.fileSize,
      fileName: latestVersion.fileName,
      publishedAt: latestVersion.publishedAt,
      downloadUrl: `/api/apk/download/${latestVersion._id}`,
      downloadCount: latestVersion.downloadCount
    });

  } catch (error) {
    console.error('Error fetching latest APK:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @route   GET /api/apk/list
 * @desc    List all APK versions (admin)
 */
router.get('/list', async (req, res) => {
  try {
    const versions = await ApkVersion.find()
      .sort({ versionCode: -1 })
      .select('-filePath'); // Don't expose file paths

    res.json({ versions });

  } catch (error) {
    console.error('Error listing APK versions:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @route   POST /api/apk/create
 * @desc    Create new APK version entry (admin)
 * @body    version, versionCode, fileName, filePath, fileSize, changelog, isMandatory
 */
router.post('/create', async (req, res) => {
  try {
    const {
      version,
      versionCode,
      fileName,
      filePath,
      fileSize,
      changelog,
      isMandatory
    } = req.body;

    // Validation
    if (!version || !versionCode || !fileName || !filePath || !fileSize || !changelog) {
      return res.status(400).json({
        error: 'All fields are required: version, versionCode, fileName, filePath, fileSize, changelog'
      });
    }

    // Check if version already exists
    const existingVersion = await ApkVersion.findOne({
      $or: [
        { version },
        { versionCode }
      ]
    });

    if (existingVersion) {
      return res.status(400).json({
        error: 'APK version or version code already exists'
      });
    }

    // Create new APK version
    const apkVersion = new ApkVersion({
      version,
      versionCode: parseInt(versionCode),
      fileName,
      filePath,
      fileSize: parseInt(fileSize),
      changelog,
      isMandatory: isMandatory || false
    });

    await apkVersion.save();

    res.status(201).json({
      message: 'APK version created successfully',
      version: apkVersion
    });

  } catch (error) {
    console.error('Error creating APK version:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @route   PUT /api/apk/:id/deactivate
 * @desc    Deactivate an APK version (admin)
 */
router.put('/:id/deactivate', async (req, res) => {
  try {
    const apkVersion = await ApkVersion.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );

    if (!apkVersion) {
      return res.status(404).json({ error: 'APK version not found' });
    }

    res.json({
      message: 'APK version deactivated successfully',
      version: apkVersion
    });

  } catch (error) {
    console.error('Error deactivating APK version:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
