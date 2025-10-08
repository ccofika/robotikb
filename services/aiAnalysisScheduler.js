const cron = require('node-cron');
const axios = require('axios');

/**
 * Pokreće scheduled job za dnevnu AI analizu
 * Izvršava se svaki dan u 12:00 časova
 */
function startAIAnalysisScheduler() {
  console.log('🤖 AI Analysis Scheduler initialized');

  // Cron job - svaki dan u 12:00
  // Format: minuta sat dan mesec dan_u_nedelji
  // '0 12 * * *' = minuta 0, sat 12, svaki dan, svaki mesec, svaki dan u nedelji
  cron.schedule('0 12 * * *', async () => {
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('🤖 SCHEDULED AI ANALYSIS STARTED');
    console.log('Time:', new Date().toLocaleString('sr-RS'));
    console.log('═══════════════════════════════════════');

    try {
      // Pozovi endpoint za scheduled analizu
      const baseURL = process.env.BASE_URL || 'http://localhost:5000';
      const apiKey = process.env.INTERNAL_API_KEY || 'default-internal-key';

      const response = await axios.get(`${baseURL}/api/ai-analysis/scheduled/trigger`, {
        headers: {
          'x-api-key': apiKey
        }
      });

      if (response.data.success) {
        console.log('✅ Scheduled AI analysis completed successfully');
        console.log('Analysis ID:', response.data.data._id);
        console.log('Period:', new Date(response.data.data.periodStart).toLocaleString('sr-RS'),
                    'to', new Date(response.data.data.periodEnd).toLocaleString('sr-RS'));
      } else {
        console.error('❌ Scheduled AI analysis failed:', response.data.message);
      }
    } catch (error) {
      console.error('❌ Error in scheduled AI analysis:', error.message);
      if (error.response) {
        console.error('Response error:', error.response.data);
      }
    }

    console.log('═══════════════════════════════════════');
    console.log('');
  }, {
    scheduled: true,
    timezone: "Europe/Belgrade" // Srbija timezone
  });

  console.log('📅 Daily AI analysis scheduled for 12:00 PM (Europe/Belgrade timezone)');
  console.log('   Next scheduled run will analyze data from yesterday 12:00 PM to today 12:00 PM');
  console.log('');
}

module.exports = {
  startAIAnalysisScheduler
};
