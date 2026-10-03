// Pre testova na emulatoru: sistemske animacije isključene (aplikacija tada radi u režimu smanjenog kretanja,
// bez beskonačnih talasa, pa Maestro ne čeka da se ekran smiri), bez Gboard ponude za olovku, adb reverse.
const { adb, reverseAll } = require('./helpers/maestro');
const { SERIAL } = require('./helpers/env');

module.exports = async () => {
  if (process.env.E2E_SKIP_ANDROID === '1') return;
  try {
    for (const k of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) adb('shell', 'settings', 'put', 'global', k, '0');
    adb('shell', 'settings', 'put', 'secure', 'stylus_handwriting_enabled', '0');
    // aplikacija zove localhost:5300, a testovi rade na instanci za testove (5301)
    reverseAll();
  } catch (e) {
    // web testovi rade i bez emulatora; Android testovi će sami prijaviti grešku
    console.warn(`[e2e] uređaj ${SERIAL} nije spreman (security.ps1 start): ${e.message}`);
  }
};
