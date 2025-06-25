const cloudinary = require('cloudinary').v2;

// Cloudinary konfiguracija
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dmcfc0jv',
  api_key: process.env.CLOUDINARY_API_KEY || '884217485372871',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'RF7HXKhs08ZGCgdtCN7Us02aseE'
});

// Funkcija za upload slika sa maksimalnom kompresijom
const uploadImage = async (imageBuffer, workOrderId) => {
  try {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'workorders', // Organizuje slike u folder
          resource_type: 'image',
          public_id: `workorder_${workOrderId}_${Date.now()}`, // Jedinstveno ime
          transformation: [
            {
              width: 1200,
              height: 1200,
              crop: 'limit', // Ograničava veličinu ali zadržava proporcije
              quality: 'auto:low', // Automatska optimizacija sa niskim kvalitetom
              format: 'webp' // Konvertuje u WebP format za bolje kompresije
            }
          ],
          flags: 'progressive' // Progressive loading
        },
        (error, result) => {
          if (error) {
            console.error('Cloudinary upload greška:', error);
            reject(error);
          } else {
            console.log('Cloudinary upload uspešan:', result.secure_url);
            resolve(result);
          }
        }
      );
      
      uploadStream.end(imageBuffer);
    });
  } catch (error) {
    console.error('Greška pri upload-u na Cloudinary:', error);
    throw error;
  }
};

// Funkcija za brisanje slike
const deleteImage = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    console.log('Cloudinary delete result:', result);
    return result;
  } catch (error) {
    console.error('Greška pri brisanju slike sa Cloudinary:', error);
    throw error;
  }
};

module.exports = {
  cloudinary,
  uploadImage,
  deleteImage
}; 