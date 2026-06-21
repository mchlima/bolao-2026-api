// Screenshots do CMS de Posts + Revisão (promover). WSL: chromium do cache + playwright-core de outro projeto.
import pw from '/home/michel/projects/codebase/contatus/site-contatus-backlink/node_modules/playwright-core/index.js';
const { chromium } = pw;

const POST = 'cmqo85nni0001in44jnxgca48';
const ITEM = 'cmqnt9n090003inyzbcbfxqp4';
const CHROME = '/home/michel/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';

const login = await fetch('http://localhost:3000/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@bolao2026.local', password: 'admin12345' }),
}).then((r) => r.json());

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.addCookies([{ name: 'bolao-token', value: login.accessToken, domain: 'localhost', path: '/' }]);
const page = await ctx.newPage();

async function shot(url, sel, file, waitExtra = 600) {
  await page.goto(url, { waitUntil: 'networkidle' });
  if (sel) await page.waitForSelector(sel, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(waitExtra);
  await page.screenshot({ path: file, fullPage: true });
  console.log('shot:', file);
}

await shot('http://localhost:3001/admin/posts?tab=PUBLISHED', '.seg-tabs', '/tmp/cms-1-list.png');
await shot(`http://localhost:3001/admin/posts/${POST}`, '.ed-card', '/tmp/cms-2-editor.png');
await shot(`http://localhost:3001/admin/content/revisao/${ITEM}`, '.actbar', '/tmp/cms-3-revisao.png');

await browser.close();
