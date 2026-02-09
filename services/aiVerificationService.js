const OpenAI = require('openai');
const { WorkOrder, Technician, Equipment, Material } = require('../models');
const WorkOrderEvidence = require('../models/WorkOrderEvidence');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Customer status options
const CUSTOMER_STATUS_OPTIONS = [
  'Priključenje korisnika na HFC KDS mreža u zgradi sa instalacijom CPE opreme (izrada kompletne instalacije od RO do korisnika sa instalacijom kompletne CPE opreme)',
  'Priključenje korisnika na HFC KDS mreža u privatnim kućama sa instalacijom CPE opreme (izrada instalacije od PM-a do korisnika sa instalacijom kompletne CPE opreme)',
  'Priključenje korisnika na GPON mrežu u privatnim kućama (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)',
  'Priključenje korisnika na GPON mrežu u zgradi (izrada kompletne instalacije od PM do korisnika sa instalacijom kompletne CPE opreme)',
  'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji sa montažnim radovima',
  'Radovi kod postojećeg korisnika na unutrašnjoj instalaciji bez montažnih radova',
  'Priključenje novog korisnika WiFi tehnologijom (postavljanje nosača antene, postavljanje i usmeravanje antene ka baznoj stanici sa postavljanjem napajanja za antenu, postavljanje rutera i jednog uređaja za televiziju)',
  'Dodavanje drugog uređaja ili dorada',
  'Demontaža postojeće opreme kod korisnika (po korisniku)',
  'Intervencija kod korisnika',
  'Priključenje korisnika GPON tehnologijom (povezivanje svih uređaja u okviru paketa)',
  'ASTRA TELEKOM'
];

/**
 * Glavni funkcija za AI verifikaciju radnog naloga
 * @param {String} workOrderId - ID radnog naloga
 * @returns {Object} - Rezultat verifikacije
 */
async function verifyWorkOrderWithAI(workOrderId) {
  try {
    console.log('=== AI VERIFICATION START ===');
    console.log('Work Order ID:', workOrderId);

    // 1. Dohvati radni nalog sa populated podacima
    const workOrder = await WorkOrder.findById(workOrderId)
      .populate('technicianId')
      .populate('technician2Id')
      .populate({
        path: 'materials.material',
        model: 'Material'
      })
      .lean();

    if (!workOrder) {
      throw new Error('Radni nalog nije pronađen');
    }

    console.log('Work order found:', workOrder._id);
    console.log('Images in work order:', workOrder.images?.length || 0);
    if (workOrder.images && workOrder.images.length > 0) {
      console.log('Sample image:', workOrder.images[0]);
    }

    // 2. Dohvati WorkOrderEvidence
    const evidence = await WorkOrderEvidence.findOne({ workOrderId }).lean();

    // 3. Dohvati instaliranu opremu iz WorkOrder-a
    let installedEquipment = [];
    if (workOrder.installedEquipment && workOrder.installedEquipment.length > 0) {
      const equipmentIds = workOrder.installedEquipment.map(eq => eq.equipmentId);
      installedEquipment = await Equipment.find({
        _id: { $in: equipmentIds }
      }).lean();
    }

    // 4. Dohvati opremu koja je dodeljena ovom radnom nalogu (equipment array u WorkOrder)
    let assignedEquipment = [];
    if (workOrder.equipment && workOrder.equipment.length > 0) {
      assignedEquipment = await Equipment.find({
        _id: { $in: workOrder.equipment }
      }).lean();
    }

    // 5. Pripremi podatke za AI prompt
    const promptData = preparePromptData(workOrder, evidence, installedEquipment, assignedEquipment);

    // 6. Pozovi GPT-5 Nano
    const aiResponse = await callGPT5Nano(promptData);

    console.log('=== AI RESPONSE ===');
    console.log(JSON.stringify(aiResponse, null, 2));

    return aiResponse;

  } catch (error) {
    console.error('Error in AI verification:', error);
    throw error;
  }
}

/**
 * Priprema podatke za AI prompt
 */
function preparePromptData(workOrder, evidence, installedEquipment, assignedEquipment) {
  const data = {
    workOrder: {
      tisId: workOrder.tisId || 'N/A',
      tisJobId: workOrder.tisJobId || 'N/A',
      userName: workOrder.userName || 'N/A',
      userPhone: workOrder.userPhone || 'N/A',
      address: workOrder.address,
      municipality: workOrder.municipality,
      type: workOrder.type,
      technology: workOrder.technology || 'N/A',
      details: workOrder.details || 'N/A',
      comment: workOrder.comment || 'N/A',
      additionalJobs: workOrder.additionalJobs || 'N/A',
      date: workOrder.date,
      time: workOrder.time
    },
    technicians: {
      technician1: workOrder.technicianId?.name || 'N/A',
      technician2: workOrder.technician2Id?.name || null
    },
    installedEquipment: installedEquipment.map(eq => ({
      category: eq.category,
      description: eq.description,
      serialNumber: eq.serialNumber,
      status: eq.status,
      installedAt: eq.installedAt
    })),
    assignedEquipment: assignedEquipment.map(eq => ({
      category: eq.category,
      description: eq.description,
      serialNumber: eq.serialNumber,
      status: eq.status
    })),
    materials: (workOrder.materials || []).map(m => ({
      type: m.material?.type || 'N/A',
      quantity: m.quantity
    })),
    images: (workOrder.images || []).map(img => ({
      url: typeof img === 'object' ? img.url : img,
      originalName: typeof img === 'object' ? img.originalName : null
    })),
    evidence: evidence ? {
      customerStatus: evidence.customerStatus || null,
      installedEquipmentInEvidence: evidence.installedEquipment || [],
      removedEquipmentInEvidence: evidence.removedEquipment || []
    } : null
  };

  return data;
}

/**
 * Poziva GPT-5 Nano sa promptom
 */
async function callGPT5Nano(promptData) {
  try {
    // Kreiraj strukturiran prompt
    const systemPrompt = createSystemPrompt();
    const userPrompt = createUserPrompt(promptData);

    // Pripremi poruke SA SLIKAMA
    const userContent = [
      {
        type: 'text',
        text: userPrompt
      }
    ];

    // Dodaj SVE slike
    if (promptData.images && promptData.images.length > 0) {
      promptData.images.forEach(img => {
        if (img.url) {
          userContent.push({
            type: 'image_url',
            image_url: {
              url: img.url
            }
          });
        }
      });
    }

    const messages = [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: userContent
      }
    ];

    console.log('Calling GPT-5 Nano with', promptData.images.length, 'images');
    console.log('User content items:', userContent.length);
    console.log('System prompt length:', systemPrompt.length);
    console.log('User prompt length:', userPrompt.length);

    // Pozovi OpenAI API
    const completion = await openai.chat.completions.create({
      model: 'gpt-5-nano-2025-08-07',
      messages: messages,
      max_completion_tokens: 2500, // Povećano jer model koristi reasoning tokens
      response_format: { type: 'json_object' }, // Zahtevaj JSON odgovor
      // GPT-5 Nano ne podržava temperature parametar - koristi default (1)
      // Pokušaj da ograničiš reasoning tokens
      reasoning_effort: 'low' // Minimal reasoning effort da ostavi više tokena za output
    });

    console.log('OpenAI API response received');
    console.log('Completion object:', JSON.stringify(completion, null, 2));

    // Izračunaj cenu poziva
    const usage = completion.usage;
    const inputTokens = usage.prompt_tokens || 0;
    const cachedInputTokens = usage.prompt_tokens_details?.cached_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;

    // GPT-5 Nano cene (po 1M tokena)
    const INPUT_PRICE = 0.05;        // $0.05 per 1M input tokens
    const CACHED_INPUT_PRICE = 0.005; // $0.005 per 1M cached tokens
    const OUTPUT_PRICE = 0.40;       // $0.40 per 1M output tokens

    const inputCost = (inputTokens - cachedInputTokens) * (INPUT_PRICE / 1000000);
    const cachedInputCost = cachedInputTokens * (CACHED_INPUT_PRICE / 1000000);
    const outputCost = outputTokens * (OUTPUT_PRICE / 1000000);
    const totalCost = inputCost + cachedInputCost + outputCost;

    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('💰 CENA AI VERIFIKACIJE');
    console.log('═══════════════════════════════════════');
    console.log(`📥 Input tokeni: ${inputTokens.toLocaleString()}`);
    console.log(`   - Regular: ${(inputTokens - cachedInputTokens).toLocaleString()} × $${INPUT_PRICE}/1M = $${inputCost.toFixed(6)}`);
    if (cachedInputTokens > 0) {
      console.log(`   - Cached: ${cachedInputTokens.toLocaleString()} × $${CACHED_INPUT_PRICE}/1M = $${cachedInputCost.toFixed(6)}`);
    }
    console.log(`📤 Output tokeni: ${outputTokens.toLocaleString()} × $${OUTPUT_PRICE}/1M = $${outputCost.toFixed(6)}`);
    console.log(`💵 UKUPNA CENA: $${totalCost.toFixed(6)} (${(totalCost * 117).toFixed(4)} RSD)`);
    console.log('═══════════════════════════════════════');
    console.log('');

    const responseText = completion.choices[0].message.content;
    console.log('Raw AI response:', responseText);
    console.log('Response length:', responseText?.length || 0);

    // Proveri da li je response prazan
    if (!responseText || responseText.trim() === '') {
      console.error('AI returned empty response');
      throw new Error('AI returned empty response. This may be due to content filtering or model limitations.');
    }

    // Parsiraj JSON odgovor
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse AI response:', responseText);
      throw new Error(`Failed to parse AI response as JSON: ${parseError.message}`);
    }

    // Validiraj odgovor
    if (!parsedResponse.hasOwnProperty('verified') || !parsedResponse.customerStatus || !parsedResponse.reason) {
      console.error('Invalid AI response structure:', parsedResponse);
      throw new Error('Invalid AI response format - missing required fields');
    }

    return {
      verified: parsedResponse.verified,
      customerStatus: parsedResponse.customerStatus,
      reason: parsedResponse.reason,
      checkedItems: parsedResponse.checkedItems || [],
      confidence: parsedResponse.confidence || 'medium'
    };

  } catch (error) {
    console.error('Error calling GPT-5 Nano:', error);
    throw new Error(`AI API error: ${error.message}`);
  }
}

/**
 * Kreira system prompt
 */
function createSystemPrompt() {
  return `Ti si asistent za verifikaciju telekomunikacionih radnih naloga. Tvoj zadatak je da proveriš:
1. Da li je posao OČIGLEDNO URAĐEN (ne mora biti savršeno, ali mora biti završeno)
2. Koji je tip usluge (customerStatus) na osnovu izvršenih radova

TIPOVI USLUGA (customerStatus):
${CUSTOMER_STATUS_OPTIONS.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}

KRITERIJUMI ZA VERIFIKACIJU (REALISTIČNI):
✓ Da li se vidi da je tehničar bio kod korisnika i uradio posao?
✓ Da li postoji BILO KAKVA dokumentacija (slike, opis, oprema)?
✓ Da li je LOGIČNO da je posao završen na osnovu dostupnih podataka?
✓ Da li je postavljena oprema i da li je evidentirano šta je urađeno?

NAPOMENA: Ovo je Srbija - ne očekujemo savršenstvo!
- Slike ne moraju biti profesionalne - dovoljno je da se vidi da je posao urađen
- Dokumentacija može biti minimalna - bitno je da postoji
- Serijski brojevi ne moraju biti kristalno jasni - dovoljno je da postoje
- Povezivanje ne mora biti estetski - bitno je da radi

VERIFIKUJ radni nalog ako:
- Tehničar je OČIGLEDNO bio kod korisnika
- Postoji BAR NEKAKVA evidencija posla (slike ili opis)
- Logično je da je posao završen

VRATI radni nalog ako:
- Nema NIKAKVIH dokaza da je posao urađen
- Potpuno nedostaju kritični podaci (npr. nema opreme, nema opisa)
- Očigledno je da tehničar NIJE bio na terenu

ODGOVOR:
Vraćaj JSON objekat:
{
  "verified": true/false,
  "customerStatus": "naziv statusa",
  "reason": "DIREKTNA PORUKA ZA TEHNIČARA",
  "checkedItems": ["šta si proverio"],
  "confidence": "high/medium/low"
}

**VAŽNO ZA "reason" POLJE:**
- Ako je VERIFIED ✅: Kratko objašnjenje šta je provereno i potvrđeno
- Ako NIJE VERIFIED ❌: Piši DIREKTNO TEHNIČARU šta treba da douradi/ispravi

  Primer LOŠE poruke: "Razlog vraćanja: Nedostaju slike instalacije"
  Primer DOBRE poruke: "Molim te dodaj slike instalirane opreme kod korisnika. Potrebno je da se vidi povezan ONT uređaj i da su serijski brojevi čitljivi."

Budi RAZUMAN i REALISTIČAN. Ako je posao urađen - verifikuj ga!`;
}

/**
 * Kreira user prompt sa podacima radnog naloga
 */
function createUserPrompt(data) {
  const { workOrder, technicians, installedEquipment, removedEquipment, materials, evidence } = data;

  return `Analiziraj sledeći radni nalog:

═══════════════════════════════════════
OSNOVNI PODACI RADNOG NALOGA
═══════════════════════════════════════
TIS ID: ${workOrder.tisId}
TIS Job ID: ${workOrder.tisJobId}
Korisnik: ${workOrder.userName}
Telefon: ${workOrder.userPhone}
Adresa: ${workOrder.address}, ${workOrder.municipality}
Datum: ${new Date(workOrder.date).toLocaleDateString('sr-RS')} u ${workOrder.time}

Tip instalacije: ${workOrder.type}
Tehnologija: ${workOrder.technology}

═══════════════════════════════════════
TEHNIČARI
═══════════════════════════════════════
Glavni tehničar: ${technicians.technician1}
${technicians.technician2 ? `Pomoćni tehničar: ${technicians.technician2}` : ''}

═══════════════════════════════════════
DETALJI RADNOG NALOGA
═══════════════════════════════════════
${workOrder.details}

Komentar tehničara:
${workOrder.comment}

${workOrder.additionalJobs !== 'N/A' ? `Dodatni poslovi:\n${workOrder.additionalJobs}` : ''}

═══════════════════════════════════════
INSTALIRANA OPREMA (${installedEquipment.length})
═══════════════════════════════════════
${installedEquipment.length > 0
  ? installedEquipment.map(eq =>
      `• ${eq.category}: ${eq.description}\n  Serijski broj: ${eq.serialNumber}\n  Status: ${eq.status}${eq.installedAt ? `\n  Instalirano: ${new Date(eq.installedAt).toLocaleDateString('sr-RS')}` : ''}`
    ).join('\n\n')
  : 'Nema instalirane opreme'}

═══════════════════════════════════════
DODELJENA OPREMA (${data.assignedEquipment.length})
═══════════════════════════════════════
${data.assignedEquipment.length > 0
  ? data.assignedEquipment.map(eq =>
      `• ${eq.category}: ${eq.description}\n  Serijski broj: ${eq.serialNumber}\n  Status: ${eq.status}`
    ).join('\n\n')
  : 'Nema dodeljene opreme'}

═══════════════════════════════════════
UTROŠENI MATERIJALI (${materials.length})
═══════════════════════════════════════
${materials.length > 0
  ? materials.map(m => `• ${m.type} - Količina: ${m.quantity}`).join('\n')
  : 'Nema evidencije materijala'}

═══════════════════════════════════════
EVIDENCIJA RADNOG NALOGA
═══════════════════════════════════════
${evidence
  ? `Instalirana oprema u evidenciji: ${evidence.installedEquipmentInEvidence.length}
Uklonjena oprema u evidenciji: ${evidence.removedEquipmentInEvidence.length}

NAPOMENA: Postojeći customerStatus u evidenciji IGNORIŠI - ti ćeš ga SAMOSTALNO odrediti!`
  : 'Nema WorkOrderEvidence zapisa'}

═══════════════════════════════════════
SLIKE RADNOG NALOGA (${data.images.length})
═══════════════════════════════════════
${data.images.length > 0
  ? `Priloženo ${data.images.length} slika. DETALJNO ANALIZIRAJ slike:

📸 Proveri na slikama:
✓ Da li se vidi oprema koja je navedena u opisu?
✓ Da li je oprema povezana/instalirana?
✓ Da li slike odgovaraju vrsti posla (instalacija/popravka)?
✓ Da li se vidi da je tehničar ISPUNIO ONO ŠTO JE BILO POTREBNO prema opisu radnog naloga?
✓ Da li postoje znaci rada (kablovi, konektori, instalirana oprema)?

VAŽNO: Uporedi slike sa opisom radova - da li je urađeno ono što piše u "Detalji" i "Komentar tehničara"?`
  : 'Nema slika, ali to NIJE problem ako postoji detaljan opis i evidencija opreme!'}

═══════════════════════════════════════
TVOJ ZADATAK
═══════════════════════════════════════

1. **Odredi customerStatus SAMOSTALNO** (IGNORIŠI postojeći status ako postoji!):

   Analiziraj:
   - "Tip" radnog naloga (${workOrder.type})
   - "Tehnologija" (${workOrder.technology})
   - "Detalji" - šta je bilo potrebno uraditi
   - "Komentar tehničara" - šta je urađeno
   - "Dodatni poslovi" - dodatne informacije
   - Adresa (zgrada ili privatna kuća)

   Na osnovu GORENAVEDENIH podataka (NE postojećeg customerStatus), odaberi najodgovarajući:
   ${CUSTOMER_STATUS_OPTIONS.map((opt, i) => `   ${i + 1}. ${opt}`).join('\n')}

2. **Uporedi slike sa opisom posla:**

   ✓ Proveri da li SLIKE POKAZUJU DA JE URAĐENO ono što piše u opisu
   ✓ Da li je instalirana oprema koja je navedena?
   ✓ Da li je povezivanje urađeno kako treba?
   ✓ Da li je završen posao koji je bio zahtev u radnom nalogu?

3. **Proveri evidenciju:**

   ✓ Da li je postavljena oprema?
   ✓ Da li postoji opis rada?
   ✓ Da li tehnička dokumentacija pokriva izvršeni posao?

4. **Donesi odluku:**

   VERIFIED ✅ = Tehničar je ISPUNIO zahtev iz radnog naloga (ima dokaza na slikama/opisu)
   NOT VERIFIED ❌ = Nema dokaza da je ispunjen zahtev iz radnog naloga

**KLJUČNO:** Uporedi šta je bilo POTREBNO (Detalji) sa onim što JE URAĐENO (slike + komentar tehničara)!

Vrati JSON:
{
  "verified": true/false,
  "customerStatus": "status koji SI TI ODABRAO (ne postojeći!)",
  "reason": "AKO JE VERIFIED: objašnjenje što je potvrđeno | AKO NIJE: DIREKTNA PORUKA TEHNIČARU šta treba da douradi",
  "checkedItems": ["šta si proverio na slikama/u opisu"],
  "confidence": "high/medium/low"
}

PRIMERI PORUKA ZA TEHNIČARA (kada NIJE verified):
✅ DOBRO: "Molim te dodaj slike instalirane opreme. Potrebno je da se vidi ONT uređaj povezan na optički kabl i da serijski broj bude čitljiv na slici."
✅ DOBRO: "Dodaj opis izvršenih radova u komentar. Nije jasno šta je tačno urađeno kod korisnika."
❌ LOŠE: "Razlog vraćanja: Nedostaju slike"
❌ LOŠE: "Nema dovoljno informacija"`;
}

module.exports = {
  verifyWorkOrderWithAI
};
