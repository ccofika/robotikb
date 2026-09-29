// Fotografije i dokumenti Security modula: Cloudinary kad je podešen, inače lokalni disk (/uploads/security).
// Lokalni disk služi za pre-prod i razvoj, gde Cloudinary nalog nije podešen.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cloudinary } = require('../../config/cloudinary');

const cloudinaryConfigured = () => !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'security');

function extFor(mimetype, originalName) {
  const fromName = path.extname(originalName || '').toLowerCase();
  if (fromName && fromName.length <= 6) return fromName;
  if (/png/.test(mimetype)) return '.png';
  if (/webp/.test(mimetype)) return '.webp';
  if (/pdf/.test(mimetype)) return '.pdf';
  return '.jpg';
}

async function saveFile(file, folder = 'photos') {
  const isImage = /^image\//.test(file.mimetype || '');
  if (cloudinaryConfigured()) {
    const result = await new Promise((resolve, reject) => {
      const opts = { folder: `security/${folder}`, resource_type: isImage ? 'image' : 'raw' };
      if (isImage) opts.transformation = [{ width: 1600, height: 1600, crop: 'limit', quality: 'auto:good', format: 'webp' }];
      const stream = cloudinary.uploader.upload_stream(opts, (err, res) => (err ? reject(err) : resolve(res)));
      stream.end(file.buffer);
    });
    return { url: result.secure_url, publicId: result.public_id, local: false };
  }
  const dir = path.join(UPLOAD_ROOT, folder);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extFor(file.mimetype, file.originalname)}`;
  fs.writeFileSync(path.join(dir, name), file.buffer);
  return { url: `/uploads/security/${folder}/${name}`, publicId: name, local: true };
}

async function deleteFile(item, folder = 'photos') {
  try {
    if (!item) return;
    if (item.local) {
      const p = path.join(UPLOAD_ROOT, folder, path.basename(item.publicId || ''));
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } else if (item.publicId && cloudinaryConfigured()) {
      await cloudinary.uploader.destroy(item.publicId).catch(() => {});
    }
  } catch (e) { /* brisanje fajla nikad ne sme da obori zahtev */ }
}

module.exports = { saveFile, deleteFile, cloudinaryConfigured };
