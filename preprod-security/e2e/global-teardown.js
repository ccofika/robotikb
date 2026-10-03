// Posle testova: pravo vreme na serveru i emulatoru (ako je test pao usred skoka sata), animacije ponovo uključene
// (za ručni pregled na emulatoru), veza ka backendu vraćena
const { adb, reverseMain } = require('./helpers/maestro');
const clock = require('./helpers/clock');

module.exports = async () => {
  if (process.env.E2E_SKIP_ANDROID === '1') return;
  await clock.reset();
  try {
    for (const k of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) adb('shell', 'settings', 'put', 'global', k, '1');
    // emulator ponovo gleda standardnu instancu (ručni pregled)
    reverseMain();
  } catch (e) { /* uređaj nije dostupan */ }
};
