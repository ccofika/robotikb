const nodemailer = require('nodemailer');
require('dotenv').config();

// Jednostavna email konfiguracija
const getEmailConfig = () => {
  // Mailgun konfiguracija
  if (process.env.SMTP_SERVICE && process.env.SMTP_SERVICE.toLowerCase() === 'mailgun') {
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
  }

  // Gmail fallback
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
    }
  };
};

const emailConfig = getEmailConfig();

const transporter = nodemailer.createTransport(emailConfig);

transporter.verify((error, success) => {
  if (error) {
    console.log('❌ Email configuration error:', error.message);
    console.log('📧 Email service:', process.env.SMTP_SERVICE || 'gmail');
    console.log('👤 EMAIL_USER:', process.env.EMAIL_USER || process.env.MAILGUN_USERNAME);
    if (process.env.SMTP_SERVICE === 'mailgun') {
      console.log('🔑 MAILGUN_USERNAME:', process.env.MAILGUN_USERNAME);
      console.log('🔑 MAILGUN_PASSWORD length:', process.env.MAILGUN_PASSWORD ? process.env.MAILGUN_PASSWORD.length : 'undefined');
    } else {
      console.log('🔑 EMAIL_PASS length:', process.env.EMAIL_PASS ? process.env.EMAIL_PASS.length : 'undefined');
    }
  } else {
    console.log('✅ Email server is ready to take our messages');
    console.log('📧 Email service:', process.env.SMTP_SERVICE || 'gmail');
    console.log('👤 Using email:', process.env.EMAIL_USER || process.env.MAILGUN_USERNAME);
  }
});

module.exports = transporter;