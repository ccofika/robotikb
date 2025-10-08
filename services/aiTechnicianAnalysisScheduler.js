const cron = require('node-cron');
const axios = require('axios');

/**
 * Pokreće scheduled job za nedeljnu AI analizu tehničara
 * Izvršava se svakog ponedeljka u 06:00 časova
 * Analizira period od prošlog ponedeljka 00:00 do trenutnog ponedeljka 06:00
 */
function startAITechnicianAnalysisScheduler() {
  console.log('🔧 AI Technician Analysis Scheduler initialized');

  // Cron job - svaki ponedelak u 06:00
  // Format: minuta sat dan mesec dan_u_nedelji
  // '0 6 * * 1' = minuta 0, sat 6, svaki dan, svaki mesec, ponedeljak (1)
  cron.schedule('0 6 * * 1', async () => {
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('🔧 SCHEDULED AI TECHNICIAN ANALYSIS STARTED');
    console.log('Time:', new Date().toLocaleString('sr-RS'));
    console.log('═══════════════════════════════════════');

    try {
      // Pozovi endpoint za scheduled analizu
      const baseURL = process.env.BASE_URL || 'http://localhost:5000';
      const apiKey = process.env.INTERNAL_API_KEY || 'default-internal-key';

      const response = await axios.get(`${baseURL}/api/ai-technician-analysis/scheduled/trigger`, {
        headers: {
          'x-api-key': apiKey
        }
      });

      if (response.data.success) {
        console.log('✅ Scheduled AI technician analysis completed successfully');
        console.log('Analysis ID:', response.data.data._id);
        console.log('Period:', new Date(response.data.data.periodStart).toLocaleString('sr-RS'),
                    'to', new Date(response.data.data.periodEnd).toLocaleString('sr-RS'));
      } else {
        console.error('❌ Scheduled AI technician analysis failed:', response.data.message);
      }
    } catch (error) {
      console.error('❌ Error in scheduled AI technician analysis:', error.message);
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

  console.log('📅 Weekly AI technician analysis scheduled for every Monday at 06:00 (Europe/Belgrade timezone)');
  console.log('   Next scheduled run will analyze technician data from last Monday 00:00 to current Monday 06:00');
  console.log('');
}

module.exports = {
  startAITechnicianAnalysisScheduler
};
