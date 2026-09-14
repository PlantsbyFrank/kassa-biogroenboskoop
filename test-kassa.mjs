/* Controle van de kassapagina.
   Eenmalig:  npm install playwright  (in deze map)
   Draaien:   node test-kassa.mjs
   Staat er al een chromium op de machine, wijs hem dan aan:
              CHROMIUM=/pad/naar/chrome node test-kassa.mjs          */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// draai met:  node test-kassa.mjs   (vanuit deze map)
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const TYPE = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8'};
const srv = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, {'content-type': TYPE[path.extname(f)] || 'application/octet-stream'});
  res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(8731, r));

const fails = [];
const ok = (naam, cond, extra='') => { console.log((cond?'  ok  ':'FAIL  ')+naam+(extra?'  — '+extra:'')); if(!cond) fails.push(naam); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2,
  permissions:['clipboard-read','clipboard-write'] });
const page = await ctx.newPage();

const errors = [], badreq = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()+' @ '+JSON.stringify(m.location())); });
page.on('pageerror', e => errors.push('pageerror: '+e.message));
page.on('response', r => { if (r.status() >= 400) badreq.push(r.status()+' '+r.url()); });

// welke betaallink DE PAGINA zelf zegt te gebruiken
const BETAALLINK = (fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .match(/betaalLink:\s*'([^']+)'/) || [])[1];

// blokkeer de echte mollie-redirect, maar leg wel vast dat hij komt
let redirect = null;
await page.route('https://payment-links.mollie.com/**', route => {
  redirect = route.request().url();
  route.fulfill({ status:200, contentType:'text/html', body:'<h1>mollie-stub</h1>' });
});

await page.goto('http://127.0.0.1:8731/', { waitUntil:'networkidle' });

// --- rekenwerk ---
const lees = () => page.evaluate(() => ({
  totaal: document.getElementById('totaal').textContent.replace(/ | /g,' ').trim(),
  spec:   document.getElementById('specificatie').textContent.replace(/ | /g,' ').trim(),
  meter:  document.getElementById('meterTekst').textContent.replace(/ | /g,' ').trim(),
  vul:    document.getElementById('meterVul').style.width,
  knop:   document.getElementById('afrekenen').disabled,
  leeg:   !document.getElementById('leegmelding').hidden,
  hint:   !document.getElementById('hint').hidden,
  min:    document.querySelector('.teller__knop[data-stap="-1"]').disabled,
}));
const zet = async n => { await page.fill('#aantal', String(n)); await page.waitForTimeout(30); };

let s = await lees();
ok('start: knop uit',      s.knop === true);
ok('start: leegmelding aan', s.leeg === true);
ok('start: minknop uit',   s.min === true);
ok('start: hint verborgen', s.hint === false);
ok('start: totaal 0,00',   /0,00/.test(s.totaal), s.totaal);

for (const [n, verwacht] of [[1,'3,50'],[23,'80,50'],[24,'72,00'],[25,'75,00'],[48,'144,00'],[999,'2.997,00']]) {
  await zet(n); s = await lees();
  ok(`${n} stuks => € ${verwacht}`, s.totaal.includes(verwacht), s.totaal);
}

await zet(23); s = await lees();
ok('23: meter zegt nog 1 plant', /Nog 1 plant\b/.test(s.meter), s.meter);
ok('23: geen kortingsregel',  !/Staffelkorting/.test(s.spec), s.spec);
await zet(24); s = await lees();
ok('24: staffel gehaald', /Staffel gehaald/.test(s.meter), s.meter);
ok('24: korting 12,00', /Staffelkorting/.test(s.spec) && /12,00/.test(s.spec), s.spec);
ok('24: meter vol', s.vul === '100%', s.vul);

// grenswaarden via fill (geldige getallen)
for (const [in_, uit] of [['1500','999'],['-4','0'],['3.9','3'],['','0']]) {
  await zet(in_);
  const v = await page.inputValue('#aantal');
  ok(`invoer "${in_}" => ${uit}`, v === uit, 'werd '+JSON.stringify(v));
}

// rommel intypen met echte toetsaanslagen: een nummerveld slikt letters niet,
// maar de pagina mag er niet door omvallen of een knop aan laten staan
await zet(12);
await page.click('#aantal');
await page.keyboard.press('Control+a');
await page.keyboard.type('abc');
await page.waitForTimeout(50);
{
  const v = await page.inputValue('#aantal');
  const t = await lees();
  ok('letters intypen: geen rest in veld', v === '' || v === '0', JSON.stringify(v));
  ok('letters intypen: totaal 0,00', /0,00/.test(t.totaal), t.totaal);
  ok('letters intypen: knop uit', t.knop === true);
}

// plus/min en snelknoppen
await zet(0);
await page.click('.teller__knop[data-stap="1"]');
await page.click('.teller__knop[data-stap="1"]');
ok('plus twee keer => 2', (await page.inputValue('#aantal')) === '2');
await page.click('.teller__knop[data-stap="-1"]');
ok('min één keer => 1', (await page.inputValue('#aantal')) === '1');
await page.click('.teller__snel button[data-zet="24"]');
s = await lees();
ok('snelknop 24 => 72,00', s.totaal.includes('72,00'), s.totaal);

// --- tapdoelen ---
const klein = await page.evaluate(() => {
  const uit = [];
  document.querySelectorAll('button, a[href], input').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.right < 0 || r.bottom < 0) return;   // staat buiten beeld (skiplink)
    if (r.height < 44 || r.width < 44) uit.push((el.id||el.className||el.tagName)+' '+Math.round(r.width)+'x'+Math.round(r.height));
  });
  return uit;
});
ok('alle tapdoelen >= 44px', klein.length === 0, klein.join(' | '));

await page.evaluate(() => { document.activeElement.blur(); document.querySelector('.skip').focus(); });
await page.waitForTimeout(50);
const skip = await page.evaluate(() => {
  const r = document.querySelector('.skip').getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), links: Math.round(r.left) };
});
ok('skiplink zichtbaar en groot genoeg bij Tab', skip.h >= 44 && skip.links >= 0, JSON.stringify(skip));
await page.evaluate(() => document.activeElement.blur());

// --- horizontale overloop ---
for (const w of [320, 360, 390, 768, 1280]) {
  await page.setViewportSize({ width:w, height:844 });
  await page.waitForTimeout(60);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(`geen overloop op ${w}px`, over <= 0, 'over: '+over);
}
await page.setViewportSize({ width:390, height:844 });

// --- klembord + doorsturen ---
await page.click('.teller__snel button[data-zet="24"]');
await page.click('#afrekenen');
await page.waitForTimeout(120);
const klembord = await page.evaluate(() => navigator.clipboard.readText());
ok('klembord bevat 72,00', klembord === '72,00', JSON.stringify(klembord));
s = await lees();
ok('hint zichtbaar na klik', s.hint === true);
const hintb = (await page.textContent('#hintbedrag')).replace(/ /g,' ');
ok('hint toont € 72,00', hintb.includes('72,00'), hintb);
const kt = await page.textContent('#knoptekst');
ok('knoptekst bevestigt kopie', /72,00/.test(kt) && /gekopieerd/.test(kt), kt);

await page.waitForTimeout(1400);
ok('betaallink is een https mollie-betaallink',
   /^https:\/\/payment-links\.mollie\.com\/payment\/[A-Za-z0-9]+$/.test(BETAALLINK || ''), String(BETAALLINK));
ok('doorgestuurd naar de link die de pagina zelf noemt',
   redirect === BETAALLINK, String(redirect));


// --- logo leesbaar op de kopbalk ---
// (de pagina staat nu op de mollie-stub, dus eerst terug)
await page.goto('http://127.0.0.1:8731/', { waitUntil:'networkidle' });
// Meet in de gerenderde pixels in plaats van in de css. Zo blijft deze controle
// gelden als het logo later een <img> wordt in plaats van inline svg.
await page.locator('.kop').screenshot({ path: path.join(ROOT, '.kop.png') });
{
  const png = fs.readFileSync(path.join(ROOT, '.kop.png'));
  const uit = await page.evaluate(async b64 => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const lum = (r,g,b) => {
      const f = v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
      return 0.2126*f(r) + 0.7152*f(g) + 0.0722*f(b);
    };
    // achtergrond = hoekpixel; donkerste pixel = de zwaarste letter van het logo
    const achter = lum(d[0], d[1], d[2]);
    let donkerst = 1;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i+3] < 128) continue;
      const L = lum(d[i], d[i+1], d[i+2]);
      if (L < donkerst) donkerst = L;
    }
    const hoog = Math.max(achter, donkerst), laag = Math.min(achter, donkerst);
    return { contrast: (hoog + 0.05) / (laag + 0.05) };
  }, png.toString('base64'));
  ok('logo steekt af tegen de kopbalk (>= 3:1)', uit.contrast >= 3,
     uit.contrast.toFixed(2) + ':1');
}

// --- terugval als het klembord geweigerd wordt ---
{
  const p3 = await ctx.newPage();
  let r3 = null;
  await p3.route('https://payment-links.mollie.com/**', r => { r3 = r.request().url();
    r.fulfill({ status:200, contentType:'text/html', body:'stub' }); });
  await p3.addInitScript(() => {
    // telefoon of browser die schrijven naar het klembord weigert
    Object.defineProperty(navigator, 'clipboard', { get(){ throw new Error('geweigerd'); } });
    document.execCommand = () => false;
  });
  await p3.goto('http://127.0.0.1:8731/', { waitUntil:'networkidle' });
  await p3.click('.teller__snel button[data-zet="24"]');
  await p3.click('#afrekenen');
  await p3.waitForTimeout(120);
  const t3 = await p3.textContent('#knoptekst');
  const h3 = (await p3.textContent('#hintbedrag')).replace(/\u00a0/g,' ');
  const zichtbaar = await p3.evaluate(() => !document.getElementById('hint').hidden);
  ok('terugval: geen valse kopieermelding', !/gekopieerd/.test(t3), t3);
  ok('terugval: bedrag staat er om over te typen', zichtbaar && h3.includes('72,00'), h3);
  await p3.waitForTimeout(1400);
  ok('terugval: toch doorgestuurd naar mollie', r3 !== null, String(r3));
  await p3.close();
}

// --- lettertype echt geladen ---
const fontOk = await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('800 34px Nunito'); });
ok('Nunito geladen', fontOk === true);

// --- bedankt.html ---
const p2 = await ctx.newPage();
const err2 = [];
p2.on('pageerror', e => err2.push(e.message));
p2.on('response', r => { if (r.status() >= 400) badreq.push(r.status()+' '+r.url()); });
await p2.goto('http://127.0.0.1:8731/bedankt.html', { waitUntil:'networkidle' });
const over2 = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('bedankt: geen overloop', over2 <= 0, 'over: '+over2);
ok('bedankt: geen fouten', err2.length === 0, err2.join(' | '));

const echteFouten = errors.filter(e => !/payment-links\.mollie\.com\/favicon/.test(e));
ok('geen console-fouten', echteFouten.length === 0, echteFouten.join(' | '));
ok('geen mislukte requests', badreq.length === 0, badreq.join(' | '));

await page.setViewportSize({ width:390, height:844 });
await page.goto('http://127.0.0.1:8731/', { waitUntil:'networkidle' });
await zet(24);
await page.screenshot({ path: path.join(ROOT, '.kassa-390.png'), fullPage:true });

await browser.close(); srv.close();
console.log('\n' + (fails.length ? 'MISLUKT: '+fails.length+'\n - '+fails.join('\n - ') : 'ALLES GOED'));
process.exit(fails.length ? 1 : 0);
