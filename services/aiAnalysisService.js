const OpenAI = require('openai');
const AdminActivityLog = require('../models/AdminActivityLog');
const PerformanceLog = require('../models/PerformanceLog');
const ErrorLog = require('../models/ErrorLog');
const WorkOrder = require('../models/WorkOrder');
const User = require('../models/User');
const Equipment = require('../models/Equipment');
const Material = require('../models/Material');
const AIAnalysis = require('../models/AIAnalysis');

// Initialize OpenAI client (using same config as aiVerificationService)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Glavna funkcija za AI analizu sistema
 * @param {Date} periodStart - Početak perioda analize
 * @param {Date} periodEnd - Kraj perioda analize
 * @param {String} userId - ID korisnika koji pokreće analizu (optional)
 * @param {String} analysisType - 'scheduled' ili 'manual'
 * @returns {Object} - Rezultat analize
 */
async function performAIAnalysis(periodStart, periodEnd, userId = null, analysisType = 'scheduled') {
  try {
    console.log('=== AI ANALYSIS START ===');
    console.log('Period:', periodStart, '-', periodEnd);
    console.log('Type:', analysisType);

    // 1. Prikupi sve relevantne podatke
    const data = await collectAnalysisData(periodStart, periodEnd);

    // 2. Pripremi prompt za AI
    const promptData = prepareAnalysisPrompt(data, periodStart, periodEnd);

    // 3. Pozovi GPT-5 Nano za analizu
    const aiResponse = await callGPT5NanoForAnalysis(promptData);

    // 4. Sačuvaj rezultat analize u bazu
    const savedAnalysis = await AIAnalysis.create({
      analysisDate: new Date(),
      periodStart,
      periodEnd,
      analysisType,
      analysis: {
        trends: aiResponse.trends,
        patterns: aiResponse.patterns,
        automationSuggestions: aiResponse.automationSuggestions,
        improvementIdeas: aiResponse.improvementIdeas,
        summary: aiResponse.summary
      },
      statistics: data.statistics,
      rawData: {
        logsAnalyzed: data.statistics.totalLogs,
        dataPoints: data.dataPoints
      },
      createdBy: userId
    });

    console.log('=== AI ANALYSIS COMPLETED ===');
    console.log('Analysis ID:', savedAnalysis._id);

    return savedAnalysis;

  } catch (error) {
    console.error('Error in AI analysis:', error);
    throw error;
  }
}

/**
 * Prikuplja sve podatke za analizu
 */
async function collectAnalysisData(periodStart, periodEnd) {
  console.log('Collecting analysis data...');

  // Admin aktivnosti
  const adminLogs = await AdminActivityLog.find({
    createdAt: { $gte: periodStart, $lte: periodEnd }
  }).populate('userId', 'name email role').lean();

  // Performance logovi
  const performanceLogs = await PerformanceLog.find({
    createdAt: { $gte: periodStart, $lte: periodEnd }
  }).lean();

  // Error logovi
  const errorLogs = await ErrorLog.find({
    createdAt: { $gte: periodStart, $lte: periodEnd }
  }).lean();

  // Radni nalozi u periodu
  const workOrders = await WorkOrder.find({
    createdAt: { $gte: periodStart, $lte: periodEnd }
  }).lean();

  // Statistika aktivnosti po ulogama
  const activityByRole = {};
  adminLogs.forEach(log => {
    const role = log.userId?.role || 'unknown';
    if (!activityByRole[role]) {
      activityByRole[role] = 0;
    }
    activityByRole[role]++;
  });

  // Najaktivniji korisnici
  const userActivity = {};
  adminLogs.forEach(log => {
    const userName = log.userId?.name || 'Unknown';
    if (!userActivity[userName]) {
      userActivity[userName] = { count: 0, actions: [] };
    }
    userActivity[userName].count++;
    userActivity[userName].actions.push(log.action);
  });

  const mostActiveUsers = Object.entries(userActivity)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([name, data]) => ({ name, activityCount: data.count }));

  // Najčešće akcije
  const actionCounts = {};
  adminLogs.forEach(log => {
    if (!actionCounts[log.action]) {
      actionCounts[log.action] = 0;
    }
    actionCounts[log.action]++;
  });

  const mostCommonActions = Object.entries(actionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([action, count]) => ({ action, count }));

  // Performance metrike
  const avgResponseTime = performanceLogs.length > 0
    ? performanceLogs.reduce((sum, log) => sum + log.duration, 0) / performanceLogs.length
    : 0;

  const slowestEndpoints = performanceLogs
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 5)
    .map(log => ({
      endpoint: `${log.method} ${log.endpoint}`,
      duration: log.duration,
      timestamp: log.createdAt
    }));

  // Error analiza
  const errorsByType = {};
  errorLogs.forEach(log => {
    const type = log.type || 'unknown';
    if (!errorsByType[type]) {
      errorsByType[type] = 0;
    }
    errorsByType[type]++;
  });

  const errorTypes = Object.entries(errorsByType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));

  // Radni nalozi statistika
  const workOrderStats = {
    total: workOrders.length,
    byStatus: {},
    byType: {}
  };

  workOrders.forEach(wo => {
    // Status
    if (!workOrderStats.byStatus[wo.status]) {
      workOrderStats.byStatus[wo.status] = 0;
    }
    workOrderStats.byStatus[wo.status]++;

    // Type
    if (!workOrderStats.byType[wo.type]) {
      workOrderStats.byType[wo.type] = 0;
    }
    workOrderStats.byType[wo.type]++;
  });

  return {
    statistics: {
      totalLogs: adminLogs.length + performanceLogs.length + errorLogs.length,
      adminActivities: adminLogs.length,
      performanceLogs: performanceLogs.length,
      errorLogs: errorLogs.length,
      mostActiveUsers,
      mostCommonActions,
      activityByRole,
      avgResponseTime,
      slowestEndpoints,
      errorTypes,
      workOrderStats
    },
    dataPoints: {
      adminLogs: adminLogs.slice(0, 50), // Uzmi samo prvih 50 za AI analizu
      performanceLogs: performanceLogs.slice(0, 30),
      errorLogs: errorLogs.slice(0, 20),
      workOrders: workOrders.slice(0, 30)
    }
  };
}

/**
 * Priprema prompt za AI analizu
 */
function prepareAnalysisPrompt(data, periodStart, periodEnd) {
  const { statistics, dataPoints } = data;

  return {
    period: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      duration: `${Math.round((periodEnd - periodStart) / (1000 * 60 * 60))} sati`
    },
    statistics,
    sampleLogs: {
      adminActivities: dataPoints.adminLogs.map(log => ({
        action: log.action,
        user: log.userId?.name,
        role: log.userId?.role,
        timestamp: log.createdAt,
        details: log.details
      })),
      performance: dataPoints.performanceLogs.map(log => ({
        endpoint: `${log.method} ${log.endpoint}`,
        duration: log.duration,
        timestamp: log.createdAt
      })),
      errors: dataPoints.errorLogs.map(log => ({
        type: log.type,
        message: log.message,
        endpoint: log.endpoint,
        timestamp: log.createdAt
      })),
      workOrders: dataPoints.workOrders.map(wo => ({
        status: wo.status,
        type: wo.type,
        createdAt: wo.createdAt
      }))
    }
  };
}

/**
 * Poziva GPT-5 Nano za AI analizu
 */
async function callGPT5NanoForAnalysis(promptData) {
  try {
    const systemPrompt = createSystemPromptForAnalysis();
    const userPrompt = createUserPromptForAnalysis(promptData);

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

    console.log('Calling GPT-5 Nano for analysis...');
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('📤 DATA SENT TO AI MODEL');
    console.log('═══════════════════════════════════════');
    console.log('System Prompt Length:', systemPrompt.length, 'characters');
    console.log('User Prompt Length:', userPrompt.length, 'characters');
    console.log('');
    console.log('--- SYSTEM PROMPT (first 500 chars) ---');
    console.log(systemPrompt.substring(0, 500) + '...');
    console.log('');
    console.log('--- USER PROMPT (full) ---');
    console.log(userPrompt);
    console.log('═══════════════════════════════════════');
    console.log('');

    const completion = await openai.chat.completions.create({
      model: 'gpt-5-nano-2025-08-07',
      messages: messages,
      max_completion_tokens: 3000,
      response_format: { type: 'json_object' },
      reasoning_effort: 'low' // Low umesto medium da ostavi više tokena za output
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
    console.log('💰 AI ANALYSIS COST');
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
    if (!parsedResponse.trends || !parsedResponse.patterns || !parsedResponse.automationSuggestions || !parsedResponse.improvementIdeas) {
      console.error('Missing required fields in AI response');
      console.error('Response:', parsedResponse);
      throw new Error('Invalid AI response format - missing required fields');
    }

    // Konvertuj sve u stringove ako su objekti
    const trends = typeof parsedResponse.trends === 'string'
      ? parsedResponse.trends
      : JSON.stringify(parsedResponse.trends, null, 2);

    const patterns = typeof parsedResponse.patterns === 'string'
      ? parsedResponse.patterns
      : JSON.stringify(parsedResponse.patterns, null, 2);

    const automationSuggestions = typeof parsedResponse.automationSuggestions === 'string'
      ? parsedResponse.automationSuggestions
      : JSON.stringify(parsedResponse.automationSuggestions, null, 2);

    const improvementIdeas = typeof parsedResponse.improvementIdeas === 'string'
      ? parsedResponse.improvementIdeas
      : JSON.stringify(parsedResponse.improvementIdeas, null, 2);

    const summary = parsedResponse.summary && parsedResponse.summary.trim() !== ''
      ? parsedResponse.summary
      : 'AI analiza završena - pogledajte detalje ispod.';

    return {
      trends,
      patterns,
      automationSuggestions,
      improvementIdeas,
      summary
    };

  } catch (error) {
    console.error('Error calling GPT-5 Nano:', error);
    throw new Error(`AI API error: ${error.message}`);
  }
}

/**
 * Kreira system prompt za analizu
 */
function createSystemPromptForAnalysis() {
  return `Ti si AI asistent za analizu telekomunikacione management aplikacije.

KONTEKST APLIKACIJE:
Ovo je full-stack aplikacija za upravljanje telekomunikacionom kompanijom koja sadrži:
- **Backend**: Node.js/Express API server sa MongoDB bazom
- **Frontend**: React aplikacija
- **Funkcionalnosti**:
  - Upravljanje opremom (Equipment) - uređaji sa serijskim brojevima, lokacijama, dodeljeni tehničarima
  - Upravljanje materijalima (Materials) - inventar sa količinama i dodeljenim tehničarima
  - Upravljanje tehničarima (Technicians) - terenski radnici sa dodeljenom opremom/materijalima
  - Radni nalozi (Work Orders) - zadaci dodeljeni tehničarima sa praćenjem statusa
  - Korisnici (Users) - sistem korisnika sa ulogama (admin, technician, user)
  - Logovi aktivnosti (Logs) - praćenje aktivnosti za audit

TVOJ ZADATAK:
Analiziraj admin aktivnosti i performance podatke iz aplikacije i daj:

1. **TRENDOVI** - Šta se dešava u aplikaciji? Koji su obrasci ponašanja korisnika?
   - Najčešće akcije admina
   - Vreme kada je aplikacija najaktivnija
   - Koji moduli (oprema, materijali, radni nalozi) se najviše koriste

2. **PONAVLJAJUĆI OBRASCI** - Šta se ponavlja i može automatizovati?
   - Repetitivne admin akcije koje se ponavljaju svaki dan
   - Predvidljivi problemi i greške
   - Rutinski zadaci koji oduzimaju vreme

3. **PREDLOZI ZA AUTOMATIZACIJU** - Kako možemo automatizovati procese?
   - Konkretne ideje za automatizaciju ponavljajućih zadataka
   - Integracije koje bi mogle pomoći
   - Scheduled jobs koji bi mogli eliminisati manuelni rad

4. **IDEJE ZA UNAPREĐENJE** - Kako možemo upgrade-ovati aplikaciju?
   - Nove funkcionalnosti koje bi olakšale rad
   - UI/UX poboljšanja
   - Performance optimizacije
   - Integracije sa eksternim servisima

ODGOVOR MORA BITI JSON SA STRING VREDNOSTIMA:
{
  "trends": "Detaljan opis trendova - MORA biti STRUKTURIRAN tekst sa bullet points i paragrafima",
  "patterns": "Ponavljajući obrasci - MORA biti STRUKTURIRAN tekst sa bullet points",
  "automationSuggestions": "Konkretne ideje za automatizaciju - MORA biti STRUKTURIRAN tekst sa brojevima ili bullet points",
  "improvementIdeas": "Ideje za unapređenje - MORA biti STRUKTURIRAN tekst sa brojevima ili bullet points",
  "summary": "Kratak summary glavnih nalaza (100-150 karaktera)"
}

VAŽNO ZA FORMATIRANJE:
- Koristi novi red (\n) za odvajanje paragrafa
- Koristi brojeve (1., 2., 3.) ili bullet points (•, -, *) za liste
- Odvoji različite sekcije sa praznim redom
- Koristi bold (**tekst**) ili heading-e gde je potrebno
- NE piši sve u jednom dugom paragrafu!

PRIMER DOBROG FORMATIRANJA:
"automationSuggestions": "Predlažem sledeće automatizacije:\n\n1. **Automatizacija dodele opreme**\n   - Dodela na osnovu lokacije i dostupnosti\n   - Automatske notifikacije tehničarima\n   - Eskalacija ako nema odgovora\n\n2. **Kreiranje radnih naloga**\n   - Automatsko kreiranje iz repetitivnih zahteva\n   - Automatski prelazak u status 'u radu'\n\n3. **Sinhronizacija inventara**\n   - Dnevni scheduled job\n   - Automatski alarmi za niske zalihe"

VAŽNO: SVI KLJUČEVI MORAJU IMATI STRING VREDNOSTI, NE OBJEKTE ILI NIZOVE!
VAŽNO: Tekst mora biti ČITLJIV, STRUKTURIRAN i FORMATIRAN sa novim redovima i bullet points!

VAŽNO:
- Budi specifičan i daj KONKRETNE predloge
- Fokusiraj se na AKCIJE koje donose vrednost
- Razmišljaj o ROI (return on investment) - šta donosi najveću vrednost za najmanje truda
- Piši na srpskom jeziku
- Koristi profesionalan ali razumljiv ton`;
}

/**
 * Kreira user prompt za analizu
 */
function createUserPromptForAnalysis(data) {
  const { period, statistics, sampleLogs } = data;

  return `Analiziraj sledeće podatke iz telekomunikacione management aplikacije:

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
Admin aktivnosti: ${statistics.adminActivities}
Performance logova: ${statistics.performanceLogs}
Error logova: ${statistics.errorLogs}

Prosečno vreme odgovora: ${statistics.avgResponseTime.toFixed(2)}ms

═══════════════════════════════════════
AKTIVNOST PO ULOGAMA
═══════════════════════════════════════
${Object.entries(statistics.activityByRole)
  .map(([role, count]) => `${role}: ${count} akcija`)
  .join('\n')}

═══════════════════════════════════════
NAJAKTIVNIJI KORISNICI (TOP 5)
═══════════════════════════════════════
${statistics.mostActiveUsers.map((user, i) =>
  `${i + 1}. ${user.name} - ${user.activityCount} aktivnosti`
).join('\n')}

═══════════════════════════════════════
NAJČEŠĆE AKCIJE (TOP 10)
═══════════════════════════════════════
${statistics.mostCommonActions.map((action, i) =>
  `${i + 1}. ${action.action} - ${action.count}x`
).join('\n')}

═══════════════════════════════════════
NAJSPORIJI ENDPOINTS (TOP 5)
═══════════════════════════════════════
${statistics.slowestEndpoints.map((ep, i) =>
  `${i + 1}. ${ep.endpoint} - ${ep.duration.toFixed(2)}ms`
).join('\n')}

═══════════════════════════════════════
ERROR TIPOVI
═══════════════════════════════════════
${statistics.errorTypes.map(err =>
  `• ${err.type}: ${err.count} grešaka`
).join('\n')}

═══════════════════════════════════════
RADNI NALOZI STATISTIKA
═══════════════════════════════════════
Ukupno: ${statistics.workOrderStats.total}

Po statusu:
${Object.entries(statistics.workOrderStats.byStatus)
  .map(([status, count]) => `  • ${status}: ${count}`)
  .join('\n')}

Po tipu:
${Object.entries(statistics.workOrderStats.byType)
  .map(([type, count]) => `  • ${type}: ${count}`)
  .join('\n')}

═══════════════════════════════════════
PRIMERI AKTIVNOSTI (Sample)
═══════════════════════════════════════

ADMIN AKCIJE (prvih 10):
${sampleLogs.adminActivities.slice(0, 10).map(log =>
  `• ${log.action} - ${log.user} (${log.role}) - ${new Date(log.timestamp).toLocaleString('sr-RS', { timeZone: 'Europe/Belgrade' })}`
).join('\n')}

PERFORMANCE ISSUES (najsporije):
${sampleLogs.performance.slice(0, 5).map(log =>
  `• ${log.endpoint} - ${log.duration.toFixed(2)}ms`
).join('\n')}

GREŠKE (najnovije):
${sampleLogs.errors.slice(0, 5).map(log =>
  `• ${log.type}: ${log.message} (${log.endpoint})`
).join('\n')}

═══════════════════════════════════════
TVOJ ZADATAK
═══════════════════════════════════════

Na osnovu gornjih podataka:

1. **IDENTIFIKUJ TRENDOVE**
   - Koji su najčešći obrasci korišćenja?
   - U kom periodu dana je aplikacija najaktivnija?
   - Koji moduli se najviše koriste?

2. **PRONAĐI PONAVLJAJUĆE OBRASCE**
   - Koje akcije se ponavljaju svaki dan?
   - Postoje li predvidljivi problemi?
   - Koje rutinske zadatke admini moraju raditi ručno?

3. **PREDLOŽI AUTOMATIZACIJU**
   - Koje procese možemo automatizovati?
   - Koji scheduled jobs bi pomogli?
   - Koje integracije bi eliminisale manualni rad?

4. **DAJ IDEJE ZA UNAPREĐENJE**
   - Nove funkcionalnosti
   - UI/UX poboljšanja
   - Performance optimizacije
   - Korisne integracije

Vrati JSON sa detaljnim analizama!`;
}

module.exports = {
  performAIAnalysis
};
