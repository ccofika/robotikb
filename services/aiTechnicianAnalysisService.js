const OpenAI = require('openai');
const Log = require('../models/Log');
const WorkOrder = require('../models/WorkOrder');
const AITechnicianAnalysis = require('../models/AITechnicianAnalysis');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Glavna funkcija za AI analizu tehničara
 * @param {Date} periodStart - Početak perioda analize
 * @param {Date} periodEnd - Kraj perioda analize
 * @param {String} userId - ID korisnika koji pokreće analizu (optional)
 * @param {String} analysisType - 'scheduled' ili 'manual'
 * @returns {Object} - Rezultat analize
 */
async function performAITechnicianAnalysis(periodStart, periodEnd, userId = null, analysisType = 'scheduled') {
  try {
    console.log('=== AI TECHNICIAN ANALYSIS START ===');
    console.log('Period:', periodStart, '-', periodEnd);
    console.log('Type:', analysisType);

    // 1. Prikupi sve relevantne podatke
    const data = await collectTechnicianData(periodStart, periodEnd);

    // 2. Pripremi prompt za AI
    const promptData = prepareTechnicianPrompt(data, periodStart, periodEnd);

    // 3. Pozovi GPT-5 Nano za analizu
    const aiResponse = await callGPT5NanoForTechnicianAnalysis(promptData);

    // 4. Sačuvaj rezultat analize u bazu
    const savedAnalysis = await AITechnicianAnalysis.create({
      analysisDate: new Date(),
      periodStart,
      periodEnd,
      analysisType,
      analysis: {
        topPerformers: aiResponse.topPerformers,
        problemAreas: aiResponse.problemAreas,
        trainingNeeds: aiResponse.trainingNeeds,
        bestPractices: aiResponse.bestPractices,
        appImprovements: aiResponse.appImprovements,
        summary: aiResponse.summary
      },
      statistics: data.statistics,
      rawData: {
        logsAnalyzed: data.statistics.totalLogs,
        dataPoints: data.dataPoints
      },
      createdBy: userId
    });

    console.log('=== AI TECHNICIAN ANALYSIS COMPLETED ===');
    console.log('Analysis ID:', savedAnalysis._id);

    return savedAnalysis;

  } catch (error) {
    console.error('Error in AI technician analysis:', error);
    throw error;
  }
}

/**
 * Prikuplja sve podatke za analizu tehničara
 */
async function collectTechnicianData(periodStart, periodEnd) {
  console.log('Collecting technician data...');

  // Prikupi sve logove tehničara u periodu
  const technicianLogs = await Log.find({
    timestamp: { $gte: periodStart, $lte: periodEnd }
  }).populate('performedBy', 'name').lean();

  // Prikupi radne naloge u periodu
  const workOrders = await WorkOrder.find({
    createdAt: { $gte: periodStart, $lte: periodEnd }
  }).lean();

  // Statistika po tehničarima
  const technicianStats = {};
  technicianLogs.forEach(log => {
    const techId = log.performedBy?._id?.toString() || 'unknown';
    const techName = log.performedByName || 'Unknown';

    if (!technicianStats[techId]) {
      technicianStats[techId] = {
        name: techName,
        totalActivities: 0,
        materialAdded: 0,
        materialRemoved: 0,
        equipmentAdded: 0,
        equipmentRemoved: 0,
        workOrdersFinished: 0,
        workOrdersPostponed: 0,
        workOrdersCancelled: 0,
        commentsAdded: 0,
        imagesAdded: 0,
        materialUsage: {},
        equipmentRemovalReasons: {},
        municipalities: {}
      };
    }

    const stats = technicianStats[techId];
    stats.totalActivities++;

    // Brojanje po tipu akcije
    switch (log.action) {
      case 'material_added':
        stats.materialAdded++;
        if (log.materialDetails) {
          const matType = log.materialDetails.materialType || 'Unknown';
          stats.materialUsage[matType] = (stats.materialUsage[matType] || 0) + (log.materialDetails.quantity || 0);
        }
        break;
      case 'material_removed':
        stats.materialRemoved++;
        break;
      case 'equipment_added':
        stats.equipmentAdded++;
        break;
      case 'equipment_removed':
        stats.equipmentRemoved++;
        if (log.equipmentDetails?.removalReason) {
          const reason = log.equipmentDetails.removalReason;
          stats.equipmentRemovalReasons[reason] = (stats.equipmentRemovalReasons[reason] || 0) + 1;
        }
        break;
      case 'workorder_finished':
        stats.workOrdersFinished++;
        break;
      case 'workorder_postponed':
        stats.workOrdersPostponed++;
        break;
      case 'workorder_cancelled':
        stats.workOrdersCancelled++;
        break;
      case 'comment_added':
        stats.commentsAdded++;
        break;
      case 'image_added':
        stats.imagesAdded++;
        break;
    }

    // Brojanje po opštinama
    if (log.workOrderInfo?.municipality) {
      const muni = log.workOrderInfo.municipality;
      stats.municipalities[muni] = (stats.municipalities[muni] || 0) + 1;
    }
  });

  // Top 5 tehničara po aktivnostima
  const topTechnicians = Object.entries(technicianStats)
    .sort((a, b) => b[1].totalActivities - a[1].totalActivities)
    .slice(0, 5)
    .map(([id, stats]) => ({
      name: stats.name,
      activities: stats.totalActivities,
      finished: stats.workOrdersFinished,
      postponed: stats.workOrdersPostponed,
      cancelled: stats.workOrdersCancelled
    }));

  // Akcije po tipu (overall)
  const actionsByType = {};
  technicianLogs.forEach(log => {
    actionsByType[log.action] = (actionsByType[log.action] || 0) + 1;
  });

  // Material usage - ukupno
  let totalMaterialUsage = 0;
  const materialUsageByTechnician = [];
  Object.entries(technicianStats).forEach(([id, stats]) => {
    const totalMat = Object.values(stats.materialUsage).reduce((sum, qty) => sum + qty, 0);
    totalMaterialUsage += totalMat;
    if (totalMat > 0) {
      materialUsageByTechnician.push({
        name: stats.name,
        total: totalMat,
        breakdown: stats.materialUsage
      });
    }
  });

  // Equipment changes - ukupno
  const totalEquipmentChanges = technicianLogs.filter(log =>
    log.action === 'equipment_added' || log.action === 'equipment_removed'
  ).length;

  // Completion rates po tehničaru
  const completionRates = Object.entries(technicianStats).map(([id, stats]) => {
    const total = stats.workOrdersFinished + stats.workOrdersPostponed + stats.workOrdersCancelled;
    const rate = total > 0 ? ((stats.workOrdersFinished / total) * 100).toFixed(1) : 0;
    return {
      name: stats.name,
      finished: stats.workOrdersFinished,
      total,
      rate: parseFloat(rate)
    };
  }).sort((a, b) => b.rate - a.rate);

  // Postpone/Cancel rates
  const postponeCancelRates = Object.entries(technicianStats).map(([id, stats]) => {
    const total = stats.workOrdersFinished + stats.workOrdersPostponed + stats.workOrdersCancelled;
    const problemRate = total > 0 ? (((stats.workOrdersPostponed + stats.workOrdersCancelled) / total) * 100).toFixed(1) : 0;
    return {
      name: stats.name,
      postponed: stats.workOrdersPostponed,
      cancelled: stats.workOrdersCancelled,
      total,
      rate: parseFloat(problemRate)
    };
  }).sort((a, b) => b.rate - a.rate);

  return {
    statistics: {
      totalLogs: technicianLogs.length,
      totalTechnicians: Object.keys(technicianStats).length,
      totalWorkOrders: workOrders.length,
      totalMaterialUsage,
      totalEquipmentChanges,
      topTechnicians,
      actionsByType,
      materialUsageByTechnician: materialUsageByTechnician.slice(0, 10),
      completionRates: completionRates.slice(0, 10),
      postponeCancelRates: postponeCancelRates.slice(0, 10)
    },
    dataPoints: {
      technicianLogs: technicianLogs.slice(0, 100), // Sample od prvih 100
      technicianStats: Object.entries(technicianStats).slice(0, 20).map(([id, stats]) => ({
        name: stats.name,
        ...stats
      }))
    }
  };
}

/**
 * Priprema prompt za AI analizu tehničara
 */
function prepareTechnicianPrompt(data, periodStart, periodEnd) {
  const { statistics, dataPoints } = data;

  return {
    period: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      duration: `${Math.round((periodEnd - periodStart) / (1000 * 60 * 60))} sati`
    },
    statistics,
    sampleData: {
      topTechnicians: statistics.topTechnicians,
      completionRates: statistics.completionRates,
      postponeCancelRates: statistics.postponeCancelRates,
      materialUsage: statistics.materialUsageByTechnician,
      technicianDetails: dataPoints.technicianStats
    }
  };
}

/**
 * Poziva GPT-5 Nano za AI analizu tehničara
 */
async function callGPT5NanoForTechnicianAnalysis(promptData) {
  try {
    const systemPrompt = createSystemPromptForTechnicianAnalysis();
    const userPrompt = createUserPromptForTechnicianAnalysis(promptData);

    const messages = [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: userPrompt
      }
    ];

    console.log('Calling GPT-5 Nano for technician analysis...');
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('📤 DATA SENT TO AI MODEL');
    console.log('═══════════════════════════════════════');
    console.log('System Prompt Length:', systemPrompt.length, 'characters');
    console.log('User Prompt Length:', userPrompt.length, 'characters');
    console.log('═══════════════════════════════════════');
    console.log('');

    const completion = await openai.chat.completions.create({
      model: 'gpt-5-nano-2025-08-07',
      messages: messages,
      response_format: { type: 'json_object' },
      reasoning_effort: 'medium'
    });

    // Cena poziva
    const usage = completion.usage;
    const inputTokens = usage.prompt_tokens || 0;
    const cachedInputTokens = usage.prompt_tokens_details?.cached_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;

    const INPUT_PRICE = 0.05;
    const CACHED_INPUT_PRICE = 0.005;
    const OUTPUT_PRICE = 0.40;

    const inputCost = (inputTokens - cachedInputTokens) * (INPUT_PRICE / 1000000);
    const cachedInputCost = cachedInputTokens * (CACHED_INPUT_PRICE / 1000000);
    const outputCost = outputTokens * (OUTPUT_PRICE / 1000000);
    const totalCost = inputCost + cachedInputCost + outputCost;

    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('💰 AI TECHNICIAN ANALYSIS COST');
    console.log('═══════════════════════════════════════');
    console.log(`📥 Input tokens: ${inputTokens.toLocaleString()}`);
    console.log(`📤 Output tokens: ${outputTokens.toLocaleString()}`);
    console.log(`💵 TOTAL COST: $${totalCost.toFixed(6)} (${(totalCost * 117).toFixed(4)} RSD)`);
    console.log('═══════════════════════════════════════');
    console.log('');

    console.log('Completion choices:', completion.choices.length);
    console.log('First choice:', JSON.stringify(completion.choices[0], null, 2));

    const responseText = completion.choices[0]?.message?.content;

    console.log('Response text type:', typeof responseText);
    console.log('Response text length:', responseText?.length || 0);
    console.log('Response text (first 200 chars):', responseText?.substring(0, 200));

    if (!responseText || responseText.trim() === '') {
      console.error('❌ AI response was empty or null');
      console.error('Full completion object:', JSON.stringify(completion, null, 2));
      throw new Error('AI returned empty response');
    }

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ Failed to parse response as JSON');
      console.error('Response text:', responseText);
      throw new Error(`Failed to parse AI response: ${parseError.message}`);
    }

    // Validacija
    if (!parsedResponse.topPerformers || !parsedResponse.problemAreas || !parsedResponse.trainingNeeds || !parsedResponse.bestPractices || !parsedResponse.appImprovements) {
      console.error('Missing required fields in AI response');
      console.error('Response:', parsedResponse);
      throw new Error('Invalid AI response format - missing required fields');
    }

    // Helper funkcija za čišćenje i formatiranje teksta
    const cleanAndFormatText = (text) => {
      if (typeof text !== 'string') {
        text = JSON.stringify(text, null, 2);
      }
      // Konvertuj escaped \n u prave line break-ove
      text = text.replace(/\\n/g, '\n');
      // Ukloni ** bold markere
      text = text.replace(/\*\*/g, '');
      return text;
    };

    // Konvertuj sve u stringove ako su objekti i očisti formatting
    const topPerformers = cleanAndFormatText(parsedResponse.topPerformers);
    const problemAreas = cleanAndFormatText(parsedResponse.problemAreas);
    const trainingNeeds = cleanAndFormatText(parsedResponse.trainingNeeds);
    const bestPractices = cleanAndFormatText(parsedResponse.bestPractices);
    const appImprovements = cleanAndFormatText(parsedResponse.appImprovements);

    const summary = parsedResponse.summary && parsedResponse.summary.trim() !== ''
      ? cleanAndFormatText(parsedResponse.summary)
      : 'AI analiza tehničara završena - pogledajte detalje ispod.';

    return {
      topPerformers,
      problemAreas,
      trainingNeeds,
      bestPractices,
      appImprovements,
      summary
    };

  } catch (error) {
    console.error('Error calling GPT-5 Nano:', error);
    throw new Error(`AI API error: ${error.message}`);
  }
}

/**
 * Kreira system prompt za analizu tehničara
 */
function createSystemPromptForTechnicianAnalysis() {
  return `Ti si AI asistent za analizu rada tehničara u telekomunikacionoj kompaniji.

KONTEKST APLIKACIJE:
Ovo je full-stack management aplikacija za telekomunikacionu kompaniju koja omogućava:
- **Backend**: Node.js/Express API sa MongoDB bazom
- **Frontend**: React aplikacija
- **Funkcionalnosti za tehničare**:
  - Pregled dodeljenih radnih naloga (Work Orders) sa svim detaljima
  - Dodavanje materijala i opreme na radne naloge
  - Upload fotografija kao dokaza rada
  - Promena statusa radnih naloga (u toku, završeno, odloženo, otkazano)
  - Dodavanje komentara i napomena
  - Pregled dodeljene opreme i materijala
  - GPS lokacija radnih naloga
  - Push notifikacije za nove naloge

KONTEKST RADA TEHNIČARA:
Tehničari rade na terenu, izvršavaju radne naloge, koriste materijale i opremu, dokumentuju svoj rad kroz komentare i slike.

TVOJ ZADATAK:
Analiziraj aktivnosti tehničara i identifikuj:

1. **TOP PERFORMERI** - Ko radi najbolje? Šta ih izdvaja?
   - Najbrži na završetku radnih naloga
   - Najmanje cancelled/postponed WO
   - Efikasna upotreba materijala
   - Kvalitetna dokumentacija (komentari, slike)
   - Konzistentnost u radu

2. **PROBLEM AREAS** - Problematični tehničari i oblasti
   - Visok postpone/cancel rate (više od 20%)
   - Anomalije u material usage (previše ili premalo)
   - Često equipment removal sa razlogom "not working"
   - Nedostatak dokumentacije (malo ili bez komentara)
   - Specifični problemi kod pojedinih tehničara

3. **TRAINING NEEDS** - Kome treba obuka i na šta
   - Specifični tehničari koji trebaju mentorstvo
   - Oblasti za poboljšanje (material handling, equipment care, documentation)
   - Preporuke za individual development plans
   - Šta može da se nauči od top performera

4. **BEST PRACTICES** - Šta rade najbolji tehničari drugačije
   - Patterns koji vode do uspjeha
   - Recommendations za sve tehničare
   - Process improvements
   - Tips & tricks za efikasniji rad

5. **APP IMPROVEMENTS** - Šta može da se unapredi u aplikaciji kako bi olakšalo tehničarima rad
   - Nove funkcionalnosti koje bi pomogle tehničarima na terenu
   - UI/UX poboljšanja u mobilnoj aplikaciji
   - Automatizacije koje bi smanjile manuelni rad
   - Bolja integracija sa postojećim funkcijama
   - Lakši pristup informacijama koje tehničari često trebaju
   - Smanjenje broja koraka za česte akcije
   - Offline funkcionalnosti za rad bez interneta

ODGOVOR MORA BITI JSON SA STRING VREDNOSTIMA:
{
  "topPerformers": "Lista i analiza top performera - STRUKTURIRAN tekst sa imenima, brojevima i bullet points",
  "problemAreas": "Problematični tehničari i oblasti - STRUKTURIRAN tekst sa konkretnim imenima i problemima",
  "trainingNeeds": "Potrebe za obuku - STRUKTURIRAN tekst sa konkretnim preporukama",
  "bestPractices": "Best practices - STRUKTURIRAN tekst sa bullet points",
  "appImprovements": "Predlozi za unapređenje aplikacije - STRUKTURIRAN tekst sa konkretnim funkcionalnostima",
  "summary": "Kratak summary glavnih nalaza (100-150 karaktera)"
}

VAŽNO ZA FORMATIRANJE:
- Koristi novi red (\n) za odvajanje paragrafa
- Koristi brojeve (1., 2., 3.) ili bullet points (•, -, *) za liste
- Odvoji različite sekcije sa praznim redom
- Koristi bold (**tekst**) za isticanje imena i važnih podataka
- NE piši sve u jednom dugom paragrafu!

PRIMER DOBROG FORMATIRANJA:
"topPerformers": "**Top 3 Performera:**\n\n1. **Marko Petrović**\n   - 45 završenih WO (completion rate 92%)\n   - Odličan documentation (prosek 3 slike po WO)\n   - Minimalna material usage sa 0 anomalija\n\n2. **Ana Jovanović**\n   - 38 završenih WO (completion rate 90%)\n   - Najbrže vreme završetka\n   - Najbolji u equipment handling\n\n**Zajednički faktori uspeha:**\n- Detaljni komentari na svakom WO\n- Brza reakcija na probleme\n- Efikasna komunikacija"

VAŽNO: SVI KLJUČEVI MORAJU IMATI STRING VREDNOSTI, NE OBJEKTE ILI NIZOVE!
VAŽNO: Budi KONKRETAN - koristi STVARNA IMENA tehničara i BROJEVE iz statistike!
VAŽNO: Fokusiraj se na AKCIJE - šta treba konkretno uraditi!
VAŽNO: Piši na srpskom jeziku, profesionalno ali razumljivo!`;
}

/**
 * Kreira user prompt za analizu tehničara
 */
function createUserPromptForTechnicianAnalysis(data) {
  const { period, statistics, sampleData } = data;

  return `Analiziraj sledeće podatke o radu tehničara:

═══════════════════════════════════════
PERIOD ANALIZE
═══════════════════════════════════════
Početak: ${new Date(period.start).toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' })}
Kraj: ${new Date(period.end).toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' })}
Trajanje: ${period.duration}

═══════════════════════════════════════
OPŠTA STATISTIKA
═══════════════════════════════════════
Ukupno logova: ${statistics.totalLogs}
Broj aktivnih tehničara: ${statistics.totalTechnicians}
Radni nalozi u periodu: ${statistics.totalWorkOrders}
Ukupan material usage: ${statistics.totalMaterialUsage}
Equipment changes: ${statistics.totalEquipmentChanges}

═══════════════════════════════════════
TOP 5 NAJAKTIVNIJIH TEHNIČARA
═══════════════════════════════════════
${sampleData.topTechnicians.map((tech, i) =>
  `${i + 1}. ${tech.name} - ${tech.activities} aktivnosti (završeno: ${tech.finished}, postponed: ${tech.postponed}, cancelled: ${tech.cancelled})`
).join('\n')}

═══════════════════════════════════════
COMPLETION RATES (TOP 10)
═══════════════════════════════════════
${sampleData.completionRates.map((tech, i) =>
  `${i + 1}. ${tech.name} - ${tech.rate}% (${tech.finished}/${tech.total} završeno)`
).join('\n')}

═══════════════════════════════════════
POSTPONE/CANCEL RATES (TOP 10)
═══════════════════════════════════════
${sampleData.postponeCancelRates.map((tech, i) =>
  `${i + 1}. ${tech.name} - ${tech.rate}% problema (postponed: ${tech.postponed}, cancelled: ${tech.cancelled}, total: ${tech.total})`
).join('\n')}

═══════════════════════════════════════
MATERIAL USAGE PO TEHNIČARIMA (TOP 10)
═══════════════════════════════════════
${sampleData.materialUsage.map((tech, i) =>
  `${i + 1}. ${tech.name} - ${tech.total} jedinica (${Object.entries(tech.breakdown).map(([type, qty]) => `${type}: ${qty}`).join(', ')})`
).join('\n')}

═══════════════════════════════════════
DETALJNE STATISTIKE TEHNIČARA
═══════════════════════════════════════
${sampleData.technicianDetails.slice(0, 10).map(tech => `
${tech.name}:
  - Ukupno aktivnosti: ${tech.totalActivities}
  - Material added: ${tech.materialAdded}, removed: ${tech.materialRemoved}
  - Equipment added: ${tech.equipmentAdded}, removed: ${tech.equipmentRemoved}
  - WO finished: ${tech.workOrdersFinished}, postponed: ${tech.workOrdersPostponed}, cancelled: ${tech.workOrdersCancelled}
  - Komentari: ${tech.commentsAdded}, slike: ${tech.imagesAdded}
  ${Object.keys(tech.equipmentRemovalReasons).length > 0 ? `- Equipment removal reasons: ${Object.entries(tech.equipmentRemovalReasons).map(([r, c]) => `${r}(${c})`).join(', ')}` : ''}
`).join('\n')}

═══════════════════════════════════════
TVOJ ZADATAK
═══════════════════════════════════════

Na osnovu gornjih podataka:

1. **IDENTIFIKUJ TOP PERFORMERE**
   - Ko su najbolji 3-5 tehničara i zašto?
   - Šta ih izdvaja od ostalih?
   - Koje metrike pokazuju njihov uspeh?

2. **PRONAĐI PROBLEM AREAS**
   - Ko ima visok postpone/cancel rate (>20%)?
   - Ko ima anomalije u material usage?
   - Ko ima nedostatak dokumentacije?
   - Koje konkretne probleme primećuješ?

3. **DEFINIŠI TRAINING NEEDS**
   - Kome tačno treba obuka?
   - Na koje oblasti treba da se fokusiraju?
   - Šta mogu da nauče od top performera?

4. **IZDVOJ BEST PRACTICES**
   - Šta rade top performeri drugačije?
   - Koje patterns vode do uspeha?
   - Koje konkretne preporuke možeš dati svim tehničarima?

5. **PREDLOŽI APP IMPROVEMENTS**
   - Na osnovu problema i obrazaca koje si uočio, koje nove funkcionalnosti bi pomogle?
   - Kako može da se pojednostavi UI/UX za najčešće akcije?
   - Koje automatizacije bi smanjile manuelni rad tehničara?
   - Kako olakšati pristup podacima koje tehničari često trebaju?
   - Koje offline funkcionalnosti bi bile korisne?

Vrati JSON sa detaljnim, STRUKTURIRANIM analizama koristeći STVARNA IMENA i BROJEVE!`;
}

module.exports = {
  performAITechnicianAnalysis
};
