const cloudinary = require('cloudinary').v2;

// Cloudinary konfiguracija
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  timeout: process.env.CLOUDINARY_TIMEOUT || 600000
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

// Funkcija za upload audio fajlova (voice recordings) sa kompresijom
const uploadVoiceRecording = async (audioBuffer, workOrderId, phoneNumber) => {
  try {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'voice-recordings', // Organizuje audio fajlove u folder
          resource_type: 'video', // Cloudinary tretira audio kao video resource
          public_id: `call_${workOrderId}_${phoneNumber}_${Date.now()}`, // Jedinstveno ime
          format: 'mp3', // Konvertuje u MP3 format
          transformation: [
            {
              audio_codec: 'mp3',
              bit_rate: '64k', // Niska bitrate za kompresiju (32k-96k optimalno za govor)
              audio_frequency: 22050 // Smanjena frekvencija (dovoljno za govor)
            }
          ]
        },
        (error, result) => {
          if (error) {
            console.error('Cloudinary voice recording upload greška:', error);
            reject(error);
          } else {
            console.log('Cloudinary voice recording upload uspešan:', result.secure_url);
            resolve(result);
          }
        }
      );

      uploadStream.end(audioBuffer);
    });
  } catch (error) {
    console.error('Greška pri upload-u voice recording-a na Cloudinary:', error);
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

// Funkcija za brisanje audio fajla
const deleteVoiceRecording = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'video' // Audio se briše kao video resource
    });
    console.log('Cloudinary voice recording delete result:', result);
    return result;
  } catch (error) {
    console.error('Greška pri brisanju voice recording-a sa Cloudinary:', error);
    throw error;
  }
};

// Funkcija za upload APK fajlova
const uploadAPK = async (apkBuffer, version) => {
  try {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'apk-releases', // Organizuje APK fajlove u folder
          resource_type: 'raw', // Za non-image/video fajlove
          public_id: `robotik-mobile-v${version}`, // Jedinstveno ime sa verzijom
          format: 'apk',
          access_mode: 'public' // Javno dostupan za download
        },
        (error, result) => {
          if (error) {
            console.error('Cloudinary APK upload greška:', error);
            reject(error);
          } else {
            console.log('Cloudinary APK upload uspešan:', result.secure_url);
            resolve(result);
          }
        }
      );

      uploadStream.end(apkBuffer);
    });
  } catch (error) {
    console.error('Greška pri upload-u APK fajla na Cloudinary:', error);
    throw error;
  }
};

// Funkcija za brisanje APK fajla
const deleteAPK = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'raw' // APK je raw resource
    });
    console.log('Cloudinary APK delete result:', result);
    return result;
  } catch (error) {
    console.error('Greška pri brisanju APK fajla sa Cloudinary:', error);
    throw error;
  }
};

// Funkcija za upload slika faktura servisa vozila
const uploadServiceInvoice = async (imageBuffer, vehicleId, serviceId) => {
  try {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'vehicle-service-invoices', // Odvojen folder za fakture servisa vozila
          resource_type: 'image',
          public_id: `service_${vehicleId}_${serviceId}_${Date.now()}`, // Jedinstveno ime
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
            console.error('Cloudinary service invoice upload greška:', error);
            reject(error);
          } else {
            console.log('Cloudinary service invoice upload uspešan:', result.secure_url);
            resolve(result);
          }
        }
      );

      uploadStream.end(imageBuffer);
    });
  } catch (error) {
    console.error('Greška pri upload-u fakture servisa na Cloudinary:', error);
    throw error;
  }
};

// Funkcija za brisanje slike fakture servisa
const deleteServiceInvoice = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    console.log('Cloudinary service invoice delete result:', result);
    return result;
  } catch (error) {
    console.error('Greška pri brisanju fakture servisa sa Cloudinary:', error);
    throw error;
  }
};

// Funkcija za upload dokumenata tehničara (PDF, Word, slike, itd.)
const uploadTechnicianDocument = async (fileBuffer, technicianId, originalName) => {
  try {
    // Određivanje resource_type na osnovu ekstenzije
    const ext = originalName.split('.').pop().toLowerCase();
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
    const isImage = imageExts.includes(ext);

    // Čisti ime fajla ali ZADRŽAVA ekstenziju za raw fajlove
    const cleanBaseName = originalName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '_');

    return new Promise((resolve, reject) => {
      const uploadOptions = {
        folder: 'technician-documents',
        // Za raw fajlove (PDF, Word, Excel) - zadrži ekstenziju u public_id
        // jer Cloudinary koristi public_id za URL, bez ekstenzije browser ne zna tip fajla
        public_id: isImage
          ? `tech_${technicianId}_${Date.now()}_${cleanBaseName}`
          : `tech_${technicianId}_${Date.now()}_${cleanBaseName}.${ext}`,
        resource_type: isImage ? 'image' : 'raw',
        access_mode: 'public'
      };

      // Dodaj transformacije samo za slike
      if (isImage) {
        uploadOptions.transformation = [
          {
            width: 1200,
            height: 1200,
            crop: 'limit',
            quality: 'auto:good',
            format: 'webp'
          }
        ];
      }

      const uploadStream = cloudinary.uploader.upload_stream(
        uploadOptions,
        (error, result) => {
          if (error) {
            console.error('Cloudinary document upload greška:', error);
            reject(error);
          } else {
            console.log('Cloudinary document upload uspešan:', result.secure_url);
            resolve(result);
          }
        }
      );

      uploadStream.end(fileBuffer);
    });
  } catch (error) {
    console.error('Greška pri upload-u dokumenta na Cloudinary:', error);
    throw error;
  }
};

// Funkcija za brisanje dokumenta tehničara
const deleteTechnicianDocument = async (publicId, resourceType = 'raw') => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType
    });
    console.log('Cloudinary document delete result:', result);
    return result;
  } catch (error) {
    console.error('Greška pri brisanju dokumenta sa Cloudinary:', error);
    throw error;
  }
};

module.exports = {
  cloudinary,
  uploadImage,
  deleteImage,
  uploadVoiceRecording,
  deleteVoiceRecording,
  uploadAPK,
  deleteAPK,
  uploadServiceInvoice,
  deleteServiceInvoice,
  uploadTechnicianDocument,
  deleteTechnicianDocument
}; 