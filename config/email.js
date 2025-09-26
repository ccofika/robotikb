const nodemailer = require('nodemailer');
require('dotenv').config();

// Konfiguracija za različite email provajdere
const getEmailConfig = () => {
  // Ako je definisan SMTP_SERVICE, koristi ga
  if (process.env.SMTP_SERVICE) {
    switch (process.env.SMTP_SERVICE.toLowerCase()) {
      case 'sendgrid':
        return {
          host: 'smtp.sendgrid.net',
          port: 587,
          secure: false,
          auth: {
            user: 'apikey',
            pass: process.env.SENDGRID_API_KEY
          },
          tls: {
            rejectUnauthorized: false
          }
        };

      case 'mailgun':
        return {
          host: 'smtp.mailgun.org',
          port: 587,
          secure: false,
          auth: {
            user: process.env.MAILGUN_USERNAME,
            pass: process.env.MAILGUN_PASSWORD
          },
          tls: {
            rejectUnauthorized: false
          }
        };

      case 'smtp2go':
        return {
          host: 'mail.smtp2go.com',
          port: 587,
          secure: false,
          auth: {
            user: process.env.SMTP2GO_USERNAME,
            pass: process.env.SMTP2GO_PASSWORD
          },
          tls: {
            rejectUnauthorized: false
          }
        };

      default:
        // Custom SMTP
        return {
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT) || 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          },
          tls: {
            rejectUnauthorized: false
          }
        };
    }
  }

  // Cloud hosting često blokira Gmail SMTP - probaj alternativne FREE provajdere
  const freeSmtpConfigs = [
    // Outlook/Hotmail SMTP - često prolazi kroz cloud hosting
    {
      name: 'Outlook',
      host: 'smtp-mail.outlook.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      tls: {
        ciphers: 'SSLv3',
        rejectUnauthorized: false
      }
    },
    // Yahoo SMTP - backup opcija
    {
      name: 'Yahoo',
      host: 'smtp.mail.yahoo.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      tls: {
        rejectUnauthorized: false
      }
    },
    // Gmail sa različitim portovima
    {
      name: 'Gmail-465',
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      tls: {
        rejectUnauthorized: false
      }
    },
    {
      name: 'Gmail-587',
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      tls: {
        rejectUnauthorized: false
      }
    },
    // Alternativni SMTP serveri za cloud hosting
    {
      name: 'SMTP2GO-Free',
      host: 'mail.smtp2go.com',
      port: 2525, // Alternativni port koji često prolazi
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      tls: {
        rejectUnauthorized: false
      }
    }
  ];

  // Proverava da li je specificirani SMTP provider preko env varijable
  let selectedConfig = null;
  const forceProvider = process.env.FORCE_SMTP_PROVIDER?.toLowerCase();

  if (forceProvider) {
    switch (forceProvider) {
      case 'outlook':
        selectedConfig = freeSmtpConfigs[0];
        break;
      case 'yahoo':
        selectedConfig = freeSmtpConfigs[1];
        break;
      case 'gmail':
      case 'gmail-465':
        selectedConfig = freeSmtpConfigs[2];
        break;
      case 'gmail-587':
        selectedConfig = freeSmtpConfigs[3];
        break;
      case 'smtp2go':
        selectedConfig = freeSmtpConfigs[4];
        break;
      default:
        console.warn(`⚠️ Unknown FORCE_SMTP_PROVIDER: ${forceProvider}`);
        selectedConfig = freeSmtpConfigs[0]; // fallback na Outlook
    }
    console.log(`🎯 Using forced SMTP provider: ${selectedConfig.name}`);
  } else {
    // Za cloud hosting, proba prvi config (Outlook)
    selectedConfig = freeSmtpConfigs[0];
    console.log(`🌐 Auto-selecting ${selectedConfig.name} SMTP for cloud hosting...`);
  }

  return {
    ...selectedConfig,
    // Cloud hosting optimizovana podešavanja
    connectionTimeout: 30000,  // Kraći timeout
    greetingTimeout: 15000,
    socketTimeout: 30000,
    pool: false,
    maxConnections: 1,
    maxMessages: 1,
    // Dodaj naziv za debugging
    debug: false,
    logger: false
  };
};

const emailConfig = getEmailConfig();

// Kreiraj transporter sa fallback logikom
let transporter = nodemailer.createTransport(emailConfig);
let gmailConfigIndex = 0;

// Funkcija za kreiranje novog transportera sa sledećom konfiguracijom
const createAlternativeTransporter = () => {
  if (!process.env.SMTP_SERVICE && gmailConfigIndex < 4) { // Imamo 5 konfiguracija (0-4)
    gmailConfigIndex++;

    const freeSmtpConfigs = [
      // Yahoo SMTP
      {
        name: 'Yahoo',
        host: 'smtp.mail.yahoo.com',
        port: 587,
        secure: false,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        tls: { rejectUnauthorized: false }
      },
      // Gmail sa port 465
      {
        name: 'Gmail-465',
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        tls: { rejectUnauthorized: false }
      },
      // Gmail sa port 587
      {
        name: 'Gmail-587',
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        tls: { rejectUnauthorized: false }
      },
      // SMTP2GO sa alternativnim portom
      {
        name: 'SMTP2GO-Alt',
        host: 'mail.smtp2go.com',
        port: 2525,
        secure: false,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        tls: { rejectUnauthorized: false }
      }
    ];

    const config = freeSmtpConfigs[gmailConfigIndex - 1];
    console.log(`🔄 Switching to ${config.name} SMTP (attempt ${gmailConfigIndex + 1}/5)...`);

    const finalConfig = {
      ...config,
      connectionTimeout: 30000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
      pool: false,
      maxConnections: 1,
      maxMessages: 1
    };

    transporter = nodemailer.createTransport(finalConfig);
    return transporter;
  }
  return null;
};

// Poboljšana verifikacija sa timeout-om
const verifyEmailConnection = () => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Email verification timeout after 10 seconds'));
    }, 10000);

    transporter.verify((error, success) => {
      clearTimeout(timeout);

      if (error) {
        console.log('❌ Email configuration error:', error.message);
        console.log('📧 Email service:', process.env.SMTP_SERVICE || 'gmail');
        console.log('👤 EMAIL_USER:', process.env.EMAIL_USER);
        console.log('🔑 EMAIL_PASS length:', process.env.EMAIL_PASS ? process.env.EMAIL_PASS.length : 'undefined');

        // Log konfiguraciju bez osetljivih podataka
        const configForLog = { ...emailConfig };
        if (configForLog.auth) {
          configForLog.auth = {
            user: configForLog.auth.user,
            pass: configForLog.auth.pass ? '[HIDDEN]' : 'undefined'
          };
        }
        console.log('⚙️ Email config:', JSON.stringify(configForLog, null, 2));

        reject(error);
      } else {
        console.log('✅ Email server is ready to take our messages');
        console.log('📧 Email service:', process.env.SMTP_SERVICE || 'gmail');
        console.log('👤 Using email:', process.env.EMAIL_USER || emailConfig.auth?.user);
        resolve(success);
      }
    });
  });
};

// Pokušaj verifikacije sa error handling
verifyEmailConnection().catch(error => {
  console.warn('⚠️ Email server verification failed, but continuing...');
  console.warn('💡 Emails may not work properly. Consider using alternative SMTP service.');
  console.warn('📖 To fix: Set SMTP_SERVICE environment variable to "sendgrid", "mailgun", or "smtp2go"');
});

// Kreiraj fallback transporter ako se glavni ne može povezati
let fallbackTransporter = null;

const createFallbackTransporter = () => {
  if (!fallbackTransporter) {
    try {
      // Pokušaj kreiranje "test account" transportera za development
      fallbackTransporter = nodemailer.createTransporter({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: 'ethereal.user@ethereal.email',
          pass: 'ethereal.pass'
        }
      });
      console.log('📮 Fallback email transporter created (emails will be logged only)');
    } catch (err) {
      console.warn('⚠️ Could not create fallback email transporter');
    }
  }
  return fallbackTransporter;
};

module.exports = transporter;
module.exports.createAlternativeTransporter = createAlternativeTransporter;
module.exports.getTransporter = () => transporter;