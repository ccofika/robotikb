// Posle testova: pravo vreme na serveru i emulatoru (ako je test pao usred skoka sata), animacije ponovo uključene
// (za ručni pregled na emulatoru), veza ka backendu vraćena
const { adb } = require('./helpers/maestro');
const clock = require('./helpers/clock');

module.exports = async () => {
  if (process.env.E2E_SKIP_ANDROID === '1') return;
  await clock.reset();
  try {
    for (const k of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) adb('shell', 'settings', 'put', 'global', k, '1');
    adb('reverse', 'tcp:5300', 'tcp:5300');
  } catch (e) { /* uređaj nije dostupan */ }
};
