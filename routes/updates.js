const express = require('express');
const router = express.Router();
const AppUpdate = require('../models/AppUpdate');
const path = require('path');
const fs = require('fs').promises;

// Check za dostupne update-e
router.get('/check', async (req, res) => {
  try {
    const { currentVersion, platform = 'android' } = req.query;

    if (!currentVersion) {
      return res.status(400).json({ error: 'currentVersion je obavezan parametar' });
    }

    console.log(`Checking for updates: current=${currentVersion}, platform=${platform}`);

    // Pronađi najnoviji update
    const latestUpdate = await AppUpdate.getLatestUpdate(platform, currentVersion);

    if (!latestUpdate) {
      return res.json({
        updateAvailable: false,
        currentVersion: currentVersion,
        message: 'Aplikacija je ažurna'
      });
    }

    res.json({
      updateAvailable: true,
      latestVersion: latestUpdate.runtimeVersion,
      currentVersion: currentVersion,
      isMandatory: latestUpdate.isMandatory,
      changelog: latestUpdate.changelog,
      publishedAt: latestUpdate.publishedAt
    });
  } catch (error) {
    console.error('Error checking for updates:', error);
    res.status(500).json({ error: 'Greška pri proveri update-a' });
  }
});

// Expo manifest endpoint
router.get('/manifest', async (req, res) => {
  try {
    const { platform = 'android', runtimeVersion } = req.query;

    console.log(`Fetching manifest: platform=${platform}, runtimeVersion=${runtimeVersion}`);

    const latestUpdate = await AppUpdate.findOne({
      $or: [
        { platform: platform },
        { platform: 'all' }
      ],
      isActive: true
    }).sort({ runtimeVersion: -1 });

    if (!latestUpdate) {
      return res.status(404).json({ error: 'Nema dostupnih update-a' });
    }

    // Expo očekuje specifičan format manifesta
    const manifest = {
      id: latestUpdate._id.toString(),
      createdAt: latestUpdate.createdAt.toISOString(),
      runtimeVersion: latestUpdate.runtimeVersion,
      launchAsset: {
        url: `${req.protocol}://${req.get('host')}/api/updates/assets/${latestUpdate._id}/bundle`,
        contentType: 'application/javascript'
      },
      assets: latestUpdate.assets.map(asset => ({
        url: `${req.protocol}://${req.get('host')}${asset.url}`,
        contentType: 'image/png' // Možeš dinamički odrediti content type
      })),
      extra: {
        changelog: latestUpdate.changelog
      }
    };

    res.json({
      manifest
    });
  } catch (error) {
    console.error('Error fetching manifest:', error);
    res.status(500).json({ error: 'Greška pri učitavanju manifesta' });
  }
});

// Serviranje bundle fajla
router.get('/assets/:updateId/bundle', async (req, res) => {
  try {
    const { updateId } = req.params;

    const update = await AppUpdate.findById(updateId);
    if (!update) {
      return res.status(404).json({ error: 'Update nije pronađen' });
    }

    const bundlePath = path.join(__dirname, '..', update.bundlePath);

    // Proveri da li bundle postoji
    try {
      await fs.access(bundlePath);
    } catch (err) {
      console.error('Bundle file not found:', bundlePath);
      return res.status(404).json({ error: 'Bundle fajl nije pronađen' });
    }

    // Servuj bundle fajl
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(bundlePath);
  } catch (error) {
    console.error('Error serving bundle:', error);
    res.status(500).json({ error: 'Greška pri učitavanju bundle-a' });
  }
});

// Admin endpoint za kreiranje novog update-a (samo za testiranje)
router.post('/create', async (req, res) => {
  try {
    const { version, runtimeVersion, platform, bundlePath, changelog, isMandatory } = req.body;

    const update = await AppUpdate.createUpdate({
      version,
      runtimeVersion,
      platform: platform || 'all',
      bundlePath,
      changelog: changelog || '',
      isMandatory: isMandatory || false,
      assets: []
    });

    res.json({
      success: true,
      update: {
        id: update._id,
        version: update.version,
        runtimeVersion: update.runtimeVersion,
        platform: update.platform,
        publishedAt: update.publishedAt
      }
    });
  } catch (error) {
    console.error('Error creating update:', error);
    res.status(500).json({ error: 'Greška pri kreiranju update-a' });
  }
});

// Lista svih update-a (admin)
router.get('/list', async (req, res) => {
  try {
    const updates = await AppUpdate.find()
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({
      updates: updates.map(u => ({
        id: u._id,
        version: u.version,
        runtimeVersion: u.runtimeVersion,
        platform: u.platform,
        isActive: u.isActive,
        isMandatory: u.isMandatory,
        publishedAt: u.publishedAt,
        changelog: u.changelog
      }))
    });
  } catch (error) {
    console.error('Error listing updates:', error);
    res.status(500).json({ error: 'Greška pri učitavanju liste update-a' });
  }
});

module.exports = router;
