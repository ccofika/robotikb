// Prijava na web (Security pre-prod 3300) kroz pravu stranu za prijavu
const { ADMIN, PASSWORD } = require('./env');

async function webLogin(page, name = ADMIN, password = PASSWORD) {
  await page.goto('/login');
  await page.getByPlaceholder('Unesite korisničko ime').fill(name);
  await page.getByPlaceholder('Unesite lozinku').fill(password);
  await page.getByRole('button', { name: 'Prijavi se' }).click();
  await page.waitForURL((u) => !/login/.test(u.toString()), { timeout: 30000 });
}

module.exports = { webLogin };
