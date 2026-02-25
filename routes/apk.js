const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const ApkVersion = require('../models/ApkVersion');
const { uploadAPK, deleteAPK } = require('../config/cloudinary');
const { auth } = require('../middleware/auth');

// Multer config for APK upload (memory storage)
const apkStorage = multer.memoryStorage();
const apkUpload = multer({
  storage: apkStorage,
  limits: {
    fileSize: 200 * 1024 * 1024 // 200MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.android.package-archive' || file.originalname.endsWith('.apk')) {
      cb(null, true);
    } else {
      cb(new Error('Only APK files are allowed'));
    }
  }
});

/**
 * @route   POST /api/apk/upload
 * @desc    Upload new APK to Cloudinary and create version entry
 * @access  Private (requires auth - admin/superadmin only)
 */
router.post('/upload', auth, apkUpload.single('apk'), async (req, res) => {
  try {
    console.log('[APK Upload] Request received');
    console.log('[APK Upload] User:', req.user?.name, req.user?.role);

    // Check if user is admin or superadmin
    if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin' && req.user?.role !== 'supervisor') {
      return res.status(403).json({ error: 'Unauthorized - Admin access required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'APK file is required' });
    }

    const { version, versionCode, changelog, isMandatory } = req.body;

    // Validation
    if (!version || !versionCode || !changelog) {
      return res.status(400).json({
        error: 'Missing required fields: version, versionCode, changelog'
      });
    }

    console.log('[APK Upload] Version:', version, 'VersionCode:', versionCode);
    console.log('[APK Upload] File size:', req.file.size, 'bytes');

    // Check if version already exists
    const existingVersion = await ApkVersion.findOne({
      $or: [
        { version },
        { versionCode: parseInt(versionCode) }
      ]
    });

    if (existingVersion) {
      return res.status(400).json({
        error: 'APK version or version code already exists',
        existingVersion: {
          version: existingVersion.version,
          versionCode: existingVersion.versionCode
        }
      });
    }

    // Upload APK to Cloudinary
    console.log('[APK Upload] Uploading to Cloudinary...');
    const cloudinaryResult = await uploadAPK(req.file.buffer, version);
    console.log('[APK Upload] Cloudinary URL:', cloudinaryResult.secure_url);

    // Parse changelog (can be string or array)
    let changelogArray = [];
    if (typeof changelog === 'string') {
      try {
        changelogArray = JSON.parse(changelog);
      } catch (e) {
        // If not valid JSON, split by newlines
        changelogArray = changelog.split('\n').filter(line => line.trim());
      }
    } else if (Array.isArray(changelog)) {
      changelogArray = changelog;
    }

    // Create new APK version entry
    const apkVersion = new ApkVersion({
      version,
      versionCode: parseInt(versionCode),
      fileName: `robotik-mobile-v${version}.apk`,
      cloudinaryUrl: cloudinaryResult.secure_url,
      cloudinaryPublicId: cloudinaryResult.public_id,
      fileSize: req.file.size,
      changelog: changelogArray,
      isMandatory: isMandatory === 'true' || isMandatory === true,
      uploadedBy: req.user._id
    });

    await apkVersion.save();

    console.log('[APK Upload] APK version created:', apkVersion._id);

    res.status(201).json({
      success: true,
      message: 'APK uploaded successfully',
      version: {
        _id: apkVersion._id,
        version: apkVersion.version,
        versionCode: apkVersion.versionCode,
        cloudinaryUrl: apkVersion.cloudinaryUrl,
        fileSize: apkVersion.fileSize,
        changelog: apkVersion.changelog,
        isMandatory: apkVersion.isMandatory,
        publishedAt: apkVersion.publishedAt
      }
    });

  } catch (error) {
    console.error('[APK Upload] Error:', error);
    res.status(500).json({
      error: 'Failed to upload APK',
      details: error.message
    });
  }
});

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
 * @desc    Download APK file (supports both Cloudinary and legacy local files)
 * @param   id - ApkVersion document ID
 */
router.get('/download/:id', async (req, res) => {
  try {
    const apkVersion = await ApkVersion.findById(req.params.id);

    if (!apkVersion) {
      return res.status(404).json({ error: 'APK version not found' });
    }

    // Increment download count
    apkVersion.downloadCount += 1;
    await apkVersion.save();

    // If APK is on Cloudinary, redirect to Cloudinary URL
    if (apkVersion.cloudinaryUrl) {
      console.log('[APK Download] Redirecting to Cloudinary:', apkVersion.cloudinaryUrl);
      return res.redirect(apkVersion.cloudinaryUrl);
    }

    // Legacy: If APK is stored locally
    if (apkVersion.filePath) {
      const filePath = path.join(__dirname, '..', apkVersion.filePath);

      // Check if file exists
      try {
        await fs.access(filePath);
      } catch (error) {
        console.error('APK file not found:', filePath);
        return res.status(404).json({ error: 'APK file not found on server' });
      }

      // Set headers for APK download
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', `attachment; filename="${apkVersion.fileName}"`);
      res.setHeader('Content-Length', apkVersion.fileSize);

      // Stream the file
      const fileStream = require('fs').createReadStream(filePath);
      fileStream.pipe(res);
    } else {
      return res.status(404).json({ error: 'APK file location not found' });
    }

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
router.get('/list', auth, async (req, res) => {
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
router.post('/create', auth, async (req, res) => {
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
router.put('/:id/deactivate', auth, async (req, res) => {
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
