const nodemailer = require('nodemailer');
require('dotenv').config();

// SMTP_HOST prepisuje Gmail (npr. lokalni Mailpit u pre-prod okruženju)
const emailConfig = process.env.SMTP_HOST ? {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 1025,
  secure: false,
  auth: process.env.SMTP_USER ? {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  } : undefined,
  tls: {
    rejectUnauthorized: false
  }
} : {
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
const emailServiceName = process.env.SMTP_HOST ? `${process.env.SMTP_HOST}:${emailConfig.port}` : 'gmail';

const transporter = nodemailer.createTransport(emailConfig);

transporter.verify((error, success) => {
  if (error) {
    console.log('❌ Email configuration error:', error.message);
    console.log('📧 Email service:', emailServiceName);
    console.log('👤 EMAIL_USER:', process.env.EMAIL_USER);
    console.log('🔑 EMAIL_PASS length:', process.env.EMAIL_PASS ? process.env.EMAIL_PASS.length : 'undefined');
  } else {
    console.log('✅ Email server is ready to take our messages');
    console.log('📧 Email service:', emailServiceName);
    console.log('👤 Using email:', process.env.EMAIL_USER);
  }
});

module.exports = transporter;