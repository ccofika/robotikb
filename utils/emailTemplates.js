// Helper funkcija za kreiranje sumirane tabele inventara
const createInventorySummary = (inventory) => {
  if (!inventory || inventory.length === 0) {
    return { inventorySummary: [], totalItems: 0 };
  }

  // Grupišemo opremu po modelu/opisu
  const summary = {};

  inventory.forEach(item => {
    // Koristimo description kao model/tip opreme
    const model = item.description || item.category || 'Nepoznato';

    if (summary[model]) {
      summary[model]++;
    } else {
      summary[model] = 1;
    }
  });

  // Konvertujemo u array za template
  const inventorySummary = Object.entries(summary).map(([model, count]) => ({
    model,
    count
  }));

  // Sortiramo po imenu modela
  inventorySummary.sort((a, b) => a.model.localeCompare(b.model));

  return {
    inventorySummary,
    totalItems: inventory.length
  };
};

const createEmailTemplate = (type, data) => {
  const templates = { 
    lowStock: {
      subject: 'Upozorenje - Nizak nivo zaliha',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #e74c3c;">🚨 Upozorenje - Nizak nivo zaliha</h2>
          <p>Poštovani tehničar,</p>
          <p>Informišemo vas da je materijal <strong>${data.materialName}</strong> na niskom nivou zaliha:</p>
          <ul>
            <li><strong>Trenutna količina:</strong> ${data.currentQuantity}</li>
            <li><strong>Minimalna količina:</strong> ${data.minQuantity}</li>
          </ul>
          <p>Molimo vas da razmotrite dopunu zaliha.</p>
          <hr style="margin: 20px 0;">
          <p style="font-size: 12px; color: #666;">
            Ova poruka je automatski generisana od strane Robotik sistema.<br>
            Vreme slanja: ${new Date().toLocaleString('sr-RS')}
          </p>
        </div>
      `
    },
    equipmentMaintenance: {
      subject: 'Obaveštenje - Održavanje opreme',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f39c12;">🔧 Obaveštenje - Održavanje opreme</h2>
          <p>Poštovani tehničar,</p>
          <p>Oprema <strong>${data.equipmentName}</strong> zahteva održavanje:</p>
          <ul>
            <li><strong>Tip opreme:</strong> ${data.equipmentType}</li>
            <li><strong>Poslednje održavanje:</strong> ${data.lastMaintenance}</li>
            <li><strong>Razlog:</strong> ${data.reason}</li>
          </ul>
          <p>Molimo vas da planirate održavanje u najkraćem roku.</p>
          <hr style="margin: 20px 0;">
          <p style="font-size: 12px; color: #666;">
            Ova poruka je automatski generisana od strane Robotik sistema.<br>
            Vreme slanja: ${new Date().toLocaleString('sr-RS')}
          </p>
        </div>
      `
    },
    workOrder: {
      subject: 'Novi radni nalog',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #27ae60;">📋 Novi radni nalog</h2>
          <p>Poštovani tehničar,</p>
          <p>Dodeljen vam je novi radni nalog:</p>
          <ul>
            <li><strong>ID naloga:</strong> ${data.workOrderId}</li>
            <li><strong>Prioritet:</strong> ${data.priority}</li>
            <li><strong>Opis:</strong> ${data.description}</li>
            <li><strong>Lokacija:</strong> ${data.location}</li>
          </ul>
          <p>Molimo vas da pristupite izvršavanju naloga.</p>
          <hr style="margin: 20px 0;">
          <p style="font-size: 12px; color: #666;">
            Ova poruka je automatski generisana od strane Robotik sistema.<br>
            Vreme slanja: ${new Date().toLocaleString('sr-RS')}
          </p>
        </div>
      `
    },
    systemAlert: {
      subject: 'Sistemsko upozorenje',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #9b59b6;">⚠️ Sistemsko upozorenje</h2>
          <p>Poštovani tehničar,</p>
          <p>Sistemsko upozorenje:</p>
          <div style="background-color: #f8f9fa; padding: 15px; border-left: 4px solid #9b59b6;">
            <strong>${data.alertType}:</strong> ${data.message}
          </div>
          <p><strong>Vreme događaja:</strong> ${data.timestamp}</p>
          <hr style="margin: 20px 0;">
          <p style="font-size: 12px; color: #666;">
            Ova poruka je automatski generisana od strane Robotik sistema.<br>
            Vreme slanja: ${new Date().toLocaleString('sr-RS')}
          </p>
        </div>
      `
    },
    equipmentUnassignment: {
      subject: 'Razdužena oprema',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #fef2f2; padding: 24px;">
          <h2 style="color: #dc2626;">📋 Razdužena oprema</h2>
          <p>Poštovani ${data.technicianName},</p>
          <p>Obaveštavamo vas da je sledeća oprema razdužena i vraćena u magacin:</p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <thead>
              <tr style="background: #fee2e2;">
                <th style="padding: 12px; text-align: left; border: 1px solid #fecaca;">RB</th>
                <th style="padding: 12px; text-align: left; border: 1px solid #fecaca;">Kategorija</th>
                <th style="padding: 12px; text-align: left; border: 1px solid #fecaca;">Opis</th>
                <th style="padding: 12px; text-align: left; border: 1px solid #fecaca;">Serijski broj</th>
              </tr>
            </thead>
            <tbody>
              ${(data.equipment || []).map((item, index) => `
                <tr style="background: ${index % 2 === 0 ? '#fef7f7' : 'white'};">
                  <td style="padding: 12px; border: 1px solid #fecaca;">${index + 1}</td>
                  <td style="padding: 12px; border: 1px solid #fecaca;">${item.category || 'N/A'}</td>
                  <td style="padding: 12px; border: 1px solid #fecaca;">${item.description || 'N/A'}</td>
                  <td style="padding: 12px; border: 1px solid #fecaca;">${item.serialNumber || 'N/A'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          
          <p style="color: #16a34a; font-weight: 600;">✅ Oprema je uspešno vraćena u magacin</p>

          ${(data.inventorySummary && data.inventorySummary.length > 0) ? `
          <div style="margin-top: 30px;">
            <h3 style="color: #16a34a; margin-bottom: 15px;">📋 Vaš preostali magacin (sumirano)</h3>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <thead>
                <tr style="background: #f0fdf4;">
                  <th style="padding: 12px; text-align: left; border: 1px solid #bbf7d0;">RB</th>
                  <th style="padding: 12px; text-align: left; border: 1px solid #bbf7d0;">Model/Tip opreme</th>
                  <th style="padding: 12px; text-align: center; border: 1px solid #bbf7d0;">Količina</th>
                </tr>
              </thead>
              <tbody>
                ${data.inventorySummary.map((item, index) => `
                  <tr style="background: ${index % 2 === 0 ? '#f7fef7' : 'white'};">
                    <td style="padding: 12px; border: 1px solid #bbf7d0;">${index + 1}</td>
                    <td style="padding: 12px; border: 1px solid #bbf7d0;"><strong>${item.model}</strong></td>
                    <td style="padding: 12px; border: 1px solid #bbf7d0; text-align: center; color: #16a34a; font-weight: 600;">${item.count} kom</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            <p style="color: #16a34a; font-size: 14px; font-weight: 500;">
              📊 Ukupno u magacinu: ${data.totalItems} ${data.totalItems === 1 ? 'stavka' : 'stavki'}
            </p>
          </div>
          ` : `
          <div style="margin-top: 30px; padding: 20px; background: #f9fafb; border-radius: 8px; border-left: 4px solid #6b7280;">
            <p style="color: #6b7280; font-size: 14px; font-weight: 500; margin: 0;">
              📭 Vaš magacin je trenutno prazan
            </p>
          </div>
          `}

          <hr style="margin: 20px 0;">
          <p style="font-size: 12px; color: #666;">
            <strong>Robotik</strong> - Centralizovani sistem za upravljanje opremom i materijalima<br>
            <em>Automatski generisano ${new Date().toLocaleString('sr-RS')}</em>
          </p>
        </div>
      `
    },
    equipmentAssignment: {
      subject: 'Zadužena nova oprema',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f1f5f9; padding: 24px;">
          <h2 style="color: #3b82f6;">📋 Zadužena nova oprema</h2>
          <p>Poštovani ${data.technicianName},</p>
          <p>Obaveštavamo vas da vam je zadužena nova oprema:</p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <thead>
              <tr style="background: #dbeafe;">
                <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe;">RB</th>
                <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe;">Kategorija</th>
                <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe;">Opis</th>
                <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe;">Serijski broj</th>
              </tr>
            </thead>
            <tbody>
              ${(data.equipment || []).map((item, index) => `
                <tr style="background: ${index % 2 === 0 ? '#f8fafc' : 'white'};">
                  <td style="padding: 12px; border: 1px solid #bfdbfe;">${index + 1}</td>
                  <td style="padding: 12px; border: 1px solid #bfdbfe;">${item.category || 'N/A'}</td>
                  <td style="padding: 12px; border: 1px solid #bfdbfe;">${item.description || 'N/A'}</td>
                  <td style="padding: 12px; border: 1px solid #bfdbfe;">${item.serialNumber || 'N/A'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          
          <p style="color: #dc2626; font-weight: 600;">⚠️ Molimo vas da proverite sve stavke i potvrdite prijem</p>

          ${(data.inventorySummary && data.inventorySummary.length > 0) ? `
          <div style="margin-top: 30px;">
            <h3 style="color: #1e40af; margin-bottom: 15px;">📋 Vaš trenutni magacin (sumirano)</h3>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <thead>
                <tr style="background: #e0f2fe;">
                  <th style="padding: 12px; text-align: left; border: 1px solid #81d4fa;">RB</th>
                  <th style="padding: 12px; text-align: left; border: 1px solid #81d4fa;">Model/Tip opreme</th>
                  <th style="padding: 12px; text-align: center; border: 1px solid #81d4fa;">Količina</th>
                </tr>
              </thead>
              <tbody>
                ${data.inventorySummary.map((item, index) => `
                  <tr style="background: ${index % 2 === 0 ? '#f0f9ff' : 'white'};">
                    <td style="padding: 12px; border: 1px solid #81d4fa;">${index + 1}</td>
                    <td style="padding: 12px; border: 1px solid #81d4fa;"><strong>${item.model}</strong></td>
                    <td style="padding: 12px; border: 1px solid #81d4fa; text-align: center; color: #1e40af; font-weight: 600;">${item.count} kom</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            <p style="color: #1e40af; font-size: 14px; font-weight: 500;">
              📊 Ukupno u magacinu: ${data.totalItems} ${data.totalItems === 1 ? 'stavka' : 'stavki'}
            </p>
          </div>
          ` : ''}

          <hr style="margin: 20px 0;">
          <p style="font-size: 12px; color: #666;">
            <strong>Robotik</strong> - Centralizovani sistem za upravljanje opremom i materijalima<br>
            <em>Automatski generisano ${new Date().toLocaleString('sr-RS')}</em>
          </p>
        </div>
      `
    },
    workOrderAssignment: {
      subject: 'Dodeljen novi radni nalog',
      html: `
        <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); padding: 24px;">
          
          <div style="background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 16px; padding: 32px; margin-bottom: 24px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);">
            <div style="display: flex; align-items: center; margin-bottom: 16px;">
              <div style="padding: 12px; background: #dcfce7; border-radius: 12px; margin-right: 16px;">
                <span style="font-size: 24px; color: #16a34a;">📋</span>
              </div>
              <div>
                <h1 style="color: #1e293b; margin: 0; font-size: 24px; font-weight: 700;">
                  Dodeljen novi radni nalog
                </h1>
                <p style="color: #64748b; margin: 4px 0 0 0; font-size: 14px;">Robotik - Sistem za upravljanje radnim nalozima</p>
              </div>
            </div>
            
            <div style="padding: 16px; background: #dcfce7; border-radius: 8px; border-left: 4px solid #16a34a;">
              <p style="color: #15803d; margin: 0; font-size: 14px; font-weight: 600;">
                ✅ Novi radni nalog (${(data.workOrders && data.workOrders.length) || 1} ${((data.workOrders && data.workOrders.length) || 1) === 1 ? 'nalog' : 'naloga'})
              </p>
              <p style="color: #15803d; margin: 8px 0 0 0; font-size: 12px;">
                <strong>Datum dodeljivanja:</strong> ${new Date().toLocaleString('sr-RS', { 
                  day: '2-digit', 
                  month: '2-digit', 
                  year: 'numeric', 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}
              </p>
            </div>
          </div>

          <div style="background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 16px; padding: 24px; margin-bottom: 24px;">
            <h2 style="color: #1e293b; margin: 0 0 12px 0; font-size: 18px; font-weight: 600;">Poštovani ${data.technicianName},</h2>
            <p style="color: #475569; margin: 0; font-size: 16px; line-height: 1.5;">
              Obaveštavamo vas da ${(data.workOrders && data.workOrders.length > 1) ? 'su vam dodeljeni novi radni nalozi' : 'vam je dodeljen novi radni nalog'}. 
              Molimo vas da proverite detalje naloga ispod i pristupite izvršavanju u predviđenom vremenu.
            </p>
          </div>

          <div style="background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 16px; overflow: hidden; margin-bottom: 24px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);">
            <div style="padding: 24px 24px 16px 24px; border-bottom: 1px solid #e2e8f0;">
              <div style="display: flex; align-items: center; margin-bottom: 16px;">
                <span style="font-size: 18px; margin-right: 8px;">📋</span>
                <h3 style="color: #1e293b; margin: 0; font-size: 16px; font-weight: 600;">Dodeljeni radni nalozi</h3>
                <span style="margin-left: 12px; padding: 4px 8px; background: #f0fdf4; color: #15803d; border-radius: 12px; font-size: 12px; font-weight: 500;">
                  ${(data.workOrders && data.workOrders.length) || 1} ${((data.workOrders && data.workOrders.length) || 1) === 1 ? 'nalog' : 'naloga'}
                </span>
              </div>
            </div>
            
            <div style="overflow-x: auto;">
              <table style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr style="background: #f8fafc;">
                    <th style="padding: 16px 24px; text-align: left; font-weight: 600; color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0;">RB.</th>
                    <th style="padding: 16px 24px; text-align: left; font-weight: 600; color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0;">Datum</th>
                    <th style="padding: 16px 24px; text-align: left; font-weight: 600; color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0;">Vreme</th>
                    <th style="padding: 16px 24px; text-align: left; font-weight: 600; color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0;">Adresa</th>
                    <th style="padding: 16px 24px; text-align: left; font-weight: 600; color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0;">Tip</th>
                    <th style="padding: 16px 24px; text-align: left; font-weight: 600; color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0;">Korisnik</th>
                    <th style="padding: 16px 24px; text-align: left; font-weight: 600; color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0;">Telefon</th>
                  </tr>
                </thead>
                <tbody>
                  ${(data.workOrders || []).map((order, index) => `
                  <tr style="transition: all 0.2s; background: ${index % 2 === 0 ? 'rgba(248, 250, 252, 0.3)' : 'rgba(255, 255, 255, 0.1)'};">
                    <td style="padding: 16px 24px; color: #64748b; font-size: 14px; font-weight: 500;">${index + 1}.</td>
                    <td style="padding: 16px 24px;">
                      <div style="color: #1e293b; font-size: 14px; font-weight: 500;">
                        ${order.date ? new Date(order.date).toLocaleDateString('sr-RS') : 'N/A'}
                      </div>
                    </td>
                    <td style="padding: 16px 24px;">
                      <span style="display: inline-block; padding: 6px 12px; background: #16a34a; color: white; border-radius: 6px; font-size: 12px; font-weight: 600;">
                        ${order.time || 'N/A'}
                      </span>
                    </td>
                    <td style="padding: 16px 24px; color: #1e293b; font-size: 14px; font-weight: 500;">
                      <div style="margin-bottom: 4px;">${order.address || 'N/A'}</div>
                      <div style="color: #64748b; font-size: 12px;">${order.municipality || 'N/A'}</div>
                    </td>
                    <td style="padding: 16px 24px;">
                      <span style="display: inline-block; padding: 6px 12px; background: #f0fdf4; color: #15803d; border: 1px solid #dcfce7; border-radius: 6px; font-size: 12px; font-weight: 600;">
                        ${order.type || 'N/A'}
                      </span>
                    </td>
                    <td style="padding: 16px 24px; color: #1e293b; font-size: 14px; font-weight: 500;">
                      ${order.userName || 'N/A'}
                    </td>
                    <td style="padding: 16px 24px;">
                      <code style="padding: 6px 8px; background: #fef7ed; color: #ea580c; border-radius: 4px; font-family: 'Monaco', 'Menlo', monospace; font-size: 13px; font-weight: 600;">${order.userPhone || 'N/A'}</code>
                    </td>
                  </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          ${(data.workOrders && data.workOrders.length === 1) ? `
          <div style="background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 16px; padding: 24px; margin-bottom: 24px;">
            <div style="display: flex; align-items: center; margin-bottom: 16px;">
              <span style="font-size: 18px; margin-right: 8px;">📝</span>
              <h3 style="color: #1e293b; margin: 0; font-size: 16px; font-weight: 600;">Dodatni detalji</h3>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
              ${data.workOrders[0].technology ? `
              <div style="padding: 16px; background: #f0fdf4; border-radius: 8px;">
                <div style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; margin-bottom: 4px;">Tehnologija</div>
                <div style="color: #16a34a; font-size: 14px; font-weight: 600;">${data.workOrders[0].technology}</div>
              </div>
              ` : ''}
              ${data.workOrders[0].tisId ? `
              <div style="padding: 16px; background: #fef7ed; border-radius: 8px;">
                <div style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; margin-bottom: 4px;">TIS ID</div>
                <div style="color: #ea580c; font-size: 14px; font-weight: 600;">${data.workOrders[0].tisId}</div>
              </div>
              ` : ''}
              ${data.workOrders[0].details ? `
              <div style="padding: 16px; background: #f8fafc; border-radius: 8px;">
                <div style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; margin-bottom: 4px;">Detalji</div>
                <div style="color: #1e293b; font-size: 14px;">${data.workOrders[0].details}</div>
              </div>
              ` : ''}
            </div>
          </div>
          ` : ''}

          <div style="background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 16px; padding: 24px; margin-bottom: 24px;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px;">
              <div style="text-align: center; padding: 16px; background: #f0fdf4; border-radius: 12px;">
                <div style="font-size: 24px; font-weight: 700; color: #16a34a; margin-bottom: 4px;">${(data.workOrders && data.workOrders.length) || 1}</div>
                <div style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">📊 Radnih naloga</div>
              </div>
              <div style="text-align: center; padding: 16px; background: #f8fafc; border-radius: 12px;">
                <div style="font-size: 18px; font-weight: 600; color: #1e293b; margin-bottom: 4px;">${data.technicianName}</div>
                <div style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">👤 Odgovorno lice</div>
              </div>
              <div style="text-align: center; padding: 16px; background: #fef7ed; border-radius: 12px;">
                <div style="font-size: 14px; font-weight: 600; color: #ea580c; margin-bottom: 4px;">${new Date().toLocaleDateString('sr-RS')}</div>
                <div style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">📅 Datum dodeljivanja</div>
              </div>
            </div>
          </div>

          <div style="background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 16px; padding: 24px; margin-bottom: 24px; border-left: 4px solid #f59e0b;">
            <div style="display: flex; align-items: center; margin-bottom: 16px;">
              <span style="font-size: 20px; margin-right: 12px;">⚠️</span>
              <h4 style="color: #d97706; margin: 0; font-size: 16px; font-weight: 600;">Važne napomene</h4>
            </div>
            <ul style="color: #92400e; margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.6; list-style-type: none;">
              <li style="margin-bottom: 8px; position: relative;">
                <span style="position: absolute; left: -20px; color: #f59e0b;">•</span>
                Molimo vas da se pridržavate zakazanog vremena i datuma
              </li>
              <li style="margin-bottom: 8px; position: relative;">
                <span style="position: absolute; left: -20px; color: #f59e0b;">•</span>
                Pre odlaska na teren kontaktirajte korisnika na navedeni broj telefona
              </li>
              <li style="margin-bottom: 8px; position: relative;">
                <span style="position: absolute; left: -20px; color: #f59e0b;">•</span>
                U slučaju problema ili izmena, odmah kontaktirajte administratora
              </li>
              <li style="position: relative;">
                <span style="position: absolute; left: -20px; color: #f59e0b;">•</span>
                Ne zaboravite da ažurirate status naloga u sistemu po završetku
              </li>
            </ul>
          </div>

          <div style="background: rgba(255, 255, 255, 0.6); backdrop-filter: blur(8px); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 12px; padding: 20px; text-align: center;">
            <div style="padding: 16px; background: #f1f5f9; border-radius: 8px; margin-bottom: 16px;">
              <p style="color: #475569; margin: 0; font-size: 14px; font-weight: 500;">
                Za dodatne informacije kontaktirajte administratora sistema
              </p>
            </div>
            <hr style="border: none; height: 1px; background: linear-gradient(to right, transparent, #e2e8f0, transparent); margin: 16px 0;">
            <p style="font-size: 12px; color: #64748b; margin: 0; line-height: 1.4;">
              <strong style="color: #1e293b;">Robotik</strong> - Centralizovani sistem za upravljanje radnim nalozima<br>
              <em>Automatski generisano ${new Date().toLocaleString('sr-RS', { 
                weekday: 'long',
                day: '2-digit', 
                month: 'long', 
                year: 'numeric', 
                hour: '2-digit', 
                minute: '2-digit'
              })}</em>
            </p>
          </div>
        </div>
      `
    },

    reviewSurvey: {
      subject: 'Vaše mišljenje nam je važno – Ocena instalacije Robotik montaža',
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700;">
              Robotik montaža
            </h1>
            <p style="color: #bfdbfe; margin: 8px 0 0 0; font-size: 14px;">
              Vaše mišljenje nam je važno
            </p>
          </div>

          <!-- Body -->
          <div style="padding: 30px; border: 1px solid #e5e7eb; border-top: none;">
            <p style="font-size: 16px; color: #1f2937; margin: 0 0 16px 0;">
              Poštovani/a <strong>${data.customerName || 'korisniče'}</strong>,
            </p>
            <p style="font-size: 14px; color: #4b5563; line-height: 1.6; margin: 0 0 16px 0;">
              Hvala Vam što ste odabrali kablovske servise Telekoma Srbije. Naš cilj je da Vam pružimo vrhunsko iskustvo, pa bismo voleli da čujemo Vaše utiske o nedavnoj instalaciji koju su obavili naši tehničari.
            </p>
            <p style="font-size: 14px; color: #4b5563; line-height: 1.6; margin: 0 0 24px 0;">
              Vaši odgovori nam pomažu da budemo još bolji.
            </p>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 30px 0;">
              <a href="${data.surveyUrl}"
                 style="display: inline-block; background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-size: 16px; font-weight: 700; letter-spacing: 0.5px;">
                ZAPOČNI ANKETU
              </a>
            </div>

            <p style="font-size: 13px; color: #9ca3af; text-align: center; margin: 0;">
              Popunjavanje traje manje od 2 minuta.
            </p>
          </div>

          <!-- Footer -->
          <div style="padding: 20px 30px; background: #f9fafb; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; text-align: center;">
            <p style="font-size: 12px; color: #9ca3af; margin: 0;">
              Robotik montaža • Ovaj email je automatski generisan
            </p>
          </div>
        </div>
      `
    }
  };

  return templates[type] || null;
};

module.exports = { createEmailTemplate, createInventorySummary };