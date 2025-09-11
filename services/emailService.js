const transporter = require('../config/email');
const { createEmailTemplate } = require('../utils/emailTemplates');
const Technician = require('../models/Technician');

class EmailService {
  async sendEmailToTechnician(technicianId, emailType, data) {
    try {
      const technician = await Technician.findById(technicianId);
      
      if (!technician || !technician.gmail) {
        throw new Error('Tehničar nije pronađen ili nema email adresu');
      }

      const template = createEmailTemplate(emailType, data);
      
      if (!template) {
        throw new Error('Nepoznat tip email template-a');
      }

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: technician.gmail,
        subject: template.subject,
        html: template.html
      };

      const result = await transporter.sendMail(mailOptions);
      
      console.log(`Email poslat tehničaru ${technician.name} (${technician.gmail}):`, result.messageId);
      
      return {
        success: true,
        messageId: result.messageId,
        recipient: technician.gmail,
        technicianName: technician.name
      };

    } catch (error) {
      console.error('Greška pri slanju email-a:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async sendEmailToMultipleTechnicians(technicianIds, emailType, data) {
    try {
      const results = await Promise.allSettled(
        technicianIds.map(id => this.sendEmailToTechnician(id, emailType, data))
      );

      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
      const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success));

      return {
        totalSent: successful.length,
        totalFailed: failed.length,
        successful: successful.map(r => r.value),
        failed: failed.map(r => r.status === 'rejected' ? r.reason : r.value.error)
      };

    } catch (error) {
      console.error('Greška pri slanju email-a više tehničarima:', error);
      return {
        totalSent: 0,
        totalFailed: technicianIds.length,
        error: error.message
      };
    }
  }

  async sendEmailToAllTechnicians(emailType, data) {
    try {
      const technicians = await Technician.find({ 
        gmail: { $exists: true, $ne: '' } 
      });
      
      if (technicians.length === 0) {
        return {
          totalSent: 0,
          totalFailed: 0,
          message: 'Nema tehničara sa email adresama'
        };
      }

      const technicianIds = technicians.map(t => t._id);
      return await this.sendEmailToMultipleTechnicians(technicianIds, emailType, data);

    } catch (error) {
      console.error('Greška pri slanju email-a svim tehničarima:', error);
      return {
        totalSent: 0,
        totalFailed: 0,
        error: error.message
      };
    }
  }

  async sendEmailToAdminTechnicians(emailType, data) {
    try {
      const adminTechnicians = await Technician.find({ 
        isAdmin: true,
        gmail: { $exists: true, $ne: '' } 
      });
      
      if (adminTechnicians.length === 0) {
        return {
          totalSent: 0,
          totalFailed: 0,
          message: 'Nema admin tehničara sa email adresama'
        };
      }

      const adminIds = adminTechnicians.map(t => t._id);
      return await this.sendEmailToMultipleTechnicians(adminIds, emailType, data);

    } catch (error) {
      console.error('Greška pri slanju email-a admin tehničarima:', error);
      return {
        totalSent: 0,
        totalFailed: 0,
        error: error.message
      };
    }
  }
}

module.exports = new EmailService();