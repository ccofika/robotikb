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

  // Fallback na Gmail sa poboljšanim podešavanjima za cloud hosting
  return {
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    },
    tls: {
      rejectUnauthorized: false
    },
    // Dodaj timeout i pool podešavanja za cloud hosting
    connectionTimeout: 60000,
    greetingTimeout: 30000,
    socketTimeout: 60000,
    pool: true,
    maxConnections: 5,
    maxMessages: 100
  };
};

const emailConfig = getEmailConfig();

const transporter = nodemailer.createTransport(emailConfig);

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