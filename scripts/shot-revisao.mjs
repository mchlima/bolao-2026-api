// Screenshot da tela de Revisão redesenhada (WSL: chromium do cache + playwright-core de outro projeto).
import pw from '/home/michel/projects/codebase/contatus/site-contatus-backlink/node_modules/playwright-core/index.js';
const { chromium } = pw;

const ITEM = 'cmqnt9d6y0000inyzo9em6ly0'; // Informativo (2 revisões)
const CHROME = '/home/michel/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';

const login = await fetch('http://localhost:3000/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@bolao2026.local', password: 'admin12345' }),
}).then((r) => r.json());

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.addCookies([{ name: 'bolao-token', value: login.accessToken, domain: 'localhost', path: '/' }]);
const page = await ctx.newPage();
await page.goto(`http://localhost:3001/admin/content/revisao/${ITEM}`, { waitUntil: 'networkidle' });
await page.waitForSelector('.gen-title', { timeout: 15000 });
await page.waitForTimeout(600);

await page.screenshot({ path: '/tmp/revisao-1-default.png', fullPage: true });
console.log('shot 1 (default) ok');

// fatos: abrir alguns nós da árvore
const toggles = page.locator('.ft-toggle');
const n = Math.min(await toggles.count(), 4);
for (let i = 0; i < n; i++) await toggles.nth(i).click().catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/revisao-2-facts.png', fullPage: true });
console.log('shot 2 (facts abertos) ok');

await browser.close();
