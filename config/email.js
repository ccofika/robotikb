const nodemailer = require('nodemailer');
require('dotenv').config();

const emailConfig = {
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

const transporter = nodemailer.createTransport(emailConfig);

transporter.verify((error, success) => {
  if (error) {
    console.log('❌ Email configuration error:', error.message);
    console.log('📧 Email service: gmail');
    console.log('👤 EMAIL_USER:', process.env.EMAIL_USER);
    console.log('🔑 EMAIL_PASS length:', process.env.EMAIL_PASS ? process.env.EMAIL_PASS.length : 'undefined');
  } else {
    console.log('✅ Email server is ready to take our messages');
    console.log('📧 Email service: gmail');
    console.log('👤 Using email:', process.env.EMAIL_USER);
  }
});

module.exports = transporter;