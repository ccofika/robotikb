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
    equipmentAssignment: {
      subject: 'Zadužena nova oprema',
      html: `
        <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%); padding: 24px;">
          
          <!-- Header Card with Glassmorphism Effect -->
          <div style="background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 16px; padding: 32px; margin-bottom: 24px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);">
            <div style="display: flex; align-items: center; margin-bottom: 16px;">
              <div style="padding: 12px; background: #dbeafe; border-radius: 12px; margin-right: 16px;">
                <span style="font-size: 24px; color: #3b82f6;">📋</span>
              </div>
              <div>
                <h1 style="color: #1e293b; margin: 0; font-size: 24px; font-weight: 700;">
                  ${data.assignmentType === 'assign' ? 'Zadužena nova oprema' : 'Promenjena lokacija opreme'}
                </h1>
                <p style="color: #64748b; margin: 4px 0 0 0; font-size: 14px;">Robotik - Sistem za upravljanje opremom</p>
              </div>
            </div>
            
            <div style="padding: 16px; background: ${data.assignmentType === 'assign' ? '#dbeafe' : '#fef3c7'}; border-radius: 8px; border-left: 4px solid ${data.assignmentType === 'assign' ? '#3b82f6' : '#f59e0b'};">
              <p style="color: ${data.assignmentType === 'assign' ? '#1e40af' : '#92400e'}; margin: 0; font-size: 14px; font-weight: 600;">
                ${data.assignmentType === 'assign' ? '✅ Zadužena oprema' : '🔄 Promenjena lokacija'} (${data.equipment.length} ${data.equipment.length === 1 ? 'stavka' : data.equipment.length < 5 ? 'stavke' : 'stavki'})
              </p>
              <p style="color: ${data.assignmentType === 'assign' ? '#1e40af' : '#92400e'}; margin: 8px 0 0 0; font-size: 12px;">
                <strong>Datum i vreme:</strong> ${new Date().toLocaleString('sr-RS', { 
                  day: '2-digit', 
                  month: '2-digit', 
                  year: 'numeric', 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}
              </p>
            </div>
          </div>

          <!-- Greeting Card -->
          <div style="background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 16px; padding: 24px; margin-bottom: 24px;">
            <h2 style="color: #1e293b; margin: 0 0 12px 0; font-size: 18px; font-weight: 600;">Poštovani ${data.technicianName},</h2>
            <p style="color: #475569; margin: 0; font-size: 16px; line-height: 1.5;">
              Obaveštavamo vas da vam je ${data.assignmentType === 'assign' ? 'zadužena nova oprema' : 'promenjena lokacija opreme'}. 
              Molimo vas da proverite listu opreme ispod.
            </p>
          </div>

          <!-- Equipment Table Card -->
          <div style="background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 16px; overflow: hidden; margin-bottom: 24px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);">
            <!-- Table Header -->
            <div style="padding: 24px 24px 16px 24px; border-bottom: 1px solid #e2e8f0;">
              <div style="display: flex; align-items: center; margin-bottom: 16px;">
                <span style="font-size: 18px; margin-right: 8px;">📋</span>
                <h3 style="color: #1e293b; margin: 0; font-size: 16px; font-weight: 600;">Lista opreme</h3>
                <span style="margin-left: 12px; padding: 4px 8px; background: #f1f5f9; color: #64748b; border-radius: 12px; font-size: 12px; font-weight: 500;">
                  ${data.equipment.length} ${data.equipment.length === 1 ? 'stavka' : data.equipment.length < 5 ? 'stavke' : 'stavki'}
                </span>
              </div>
            </div>
            
            <!-- Equipment Table -->
            <div style="overflow-x: auto;">
              <table style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr style="background: #f8fafc;">
                    <th style="padding: 16px 24px; text-align: left; font-weight: 600; color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0;">RB.</th>
                    <th style="padding: 16px 24px; text-align: left; font-weight: 600; color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0;">Kategorija</th>
                    <th style="padding: 16px 24px; text-align: left; font-weight: 600; color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0;">Opis</th>
                    <th style="padding: 16px 24px; text-align: left; font-weight: 600; color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0;">Serijski broj</th>
                    <th style="padding: 16px 24px; text-align: left; font-weight: 600; color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0;">Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${data.equipment.map((item, index) => `
                  <tr style="transition: all 0.2s; ${index % 2 === 0 ? 'background: rgba(248, 250, 252, 0.3);' : 'background: rgba(255, 255, 255, 0.1);'}">
                    <td style="padding: 16px 24px; color: #64748b; font-size: 14px; font-weight: 500;">${index + 1}.</td>
                    <td style="padding: 16px 24px;">
                      <span style="display: inline-block; padding: 6px 12px; background: ${index % 2 === 0 ? '#3b82f6' : '#06b6d4'}; color: white; border-radius: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                        ${item.category || 'N/A'}
                      </span>
                    </td>
                    <td style="padding: 16px 24px; color: #1e293b; font-size: 14px; font-weight: 500;">${item.description || 'N/A'}</td>
                    <td style="padding: 16px 24px;">
                      <code style="padding: 6px 8px; background: #fef7ed; color: #ea580c; border-radius: 4px; font-family: 'Monaco', 'Menlo', monospace; font-size: 13px; font-weight: 600;">${item.serialNumber || 'N/A'}</code>
                    </td>
                    <td style="padding: 16px 24px;">
                      <span style="display: inline-block; padding: 6px 12px; background: ${item.status === 'assigned' ? '#dcfce7' : '#f3f4f6'}; color: ${item.status === 'assigned' ? '#15803d' : '#374151'}; border-radius: 6px; font-size: 12px; font-weight: 600;">
                        ${item.status === 'assigned' ? '✓ Zaduženo' : item.status === 'available' ? '○ Dostupno' : item.status || 'N/A'}
                      </span>
                    </td>
                  </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Stats Card -->
          <div style="background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 16px; padding: 24px; margin-bottom: 24px;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px;">
              <div style="text-align: center; padding: 16px; background: #f8fafc; border-radius: 12px;">
                <div style="font-size: 24px; font-weight: 700; color: #3b82f6; margin-bottom: 4px;">${data.equipment.length}</div>
                <div style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">📊 Ukupno stavki</div>
              </div>
              <div style="text-align: center; padding: 16px; background: #f0fdf4; border-radius: 12px;">
                <div style="font-size: 18px; font-weight: 600; color: #16a34a; margin-bottom: 4px;">${data.technicianName}</div>
                <div style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">👤 Odgovorno lice</div>
              </div>
              <div style="text-align: center; padding: 16px; background: #fef7ed; border-radius: 12px;">
                <div style="font-size: 14px; font-weight: 600; color: #ea580c; margin-bottom: 4px;">${new Date().toLocaleDateString('sr-RS')}</div>
                <div style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">📅 Datum</div>
              </div>
            </div>
          </div>

          <!-- Important Notes Card -->
          <div style="background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 16px; padding: 24px; margin-bottom: 24px; border-left: 4px solid #ef4444;">
            <div style="display: flex; align-items: center; margin-bottom: 16px;">
              <span style="font-size: 20px; margin-right: 12px;">⚠️</span>
              <h4 style="color: #dc2626; margin: 0; font-size: 16px; font-weight: 600;">Važne napomene</h4>
            </div>
            <ul style="color: #7f1d1d; margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.6; list-style-type: none;">
              <li style="margin-bottom: 8px; position: relative;">
                <span style="position: absolute; left: -20px; color: #ef4444;">•</span>
                Molimo vas da proverite sve stavke na listi i potvrdite prijem
              </li>
              <li style="margin-bottom: 8px; position: relative;">
                <span style="position: absolute; left: -20px; color: #ef4444;">•</span>
                U slučaju nedostajuće ili oštećene opreme, odmah kontaktirajte administratora
              </li>
              <li style="margin-bottom: 8px; position: relative;">
                <span style="position: absolute; left: -20px; color: #ef4444;">•</span>
                Odgovorni ste za čuvanje i pravilno korišćenje zadužene opreme
              </li>
              <li style="position: relative;">
                <span style="position: absolute; left: -20px; color: #ef4444;">•</span>
                Sve izmene ili problemi sa opremom moraju biti prijavljeni u sistemu
              </li>
            </ul>
          </div>

          <!-- Footer Card -->
          <div style="background: rgba(255, 255, 255, 0.6); backdrop-filter: blur(8px); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 12px; padding: 20px; text-align: center;">
            <div style="padding: 16px; background: #f1f5f9; border-radius: 8px; margin-bottom: 16px;">
              <p style="color: #475569; margin: 0; font-size: 14px; font-weight: 500;">
                Za dodatne informacije kontaktirajte administratora sistema
              </p>
            </div>
            <hr style="border: none; height: 1px; background: linear-gradient(to right, transparent, #e2e8f0, transparent); margin: 16px 0;">
            <p style="font-size: 12px; color: #64748b; margin: 0; line-height: 1.4;">
              <strong style="color: #1e293b;">Robotik</strong> - Centralizovani sistem za upravljanje opremom i materijalima<br>
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
    }
  };

  return templates[type] || null;
};

module.exports = { createEmailTemplate };