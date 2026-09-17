/* Controle van de kassapagina.
   Eenmalig:  npm install playwright  (in deze map)
   Draaien:   node test-kassa.mjs
   Staat er al een chromium op de machine, wijs hem dan aan:
              CHROMIUM=/pad/naar/chrome node test-kassa.mjs          */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

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
const ok = (naam, cond, extra='') => {
  console.log((cond?'  ok  ':'FAIL  ')+naam+(extra?'  — '+extra:''));
  if(!cond) fails.push(naam);
};

// welke betaallink DE PAGINA zelf zegt te gebruiken
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const BETAALLINK = (HTML.match(/betaalLink:\s*'([^']+)'/) || [])[1];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2,
  permissions:['clipboard-read','clipboard-write'] });
const page = await ctx.newPage();

const errors = [], badreq = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()+' @ '+JSON.stringify(m.location())); });
page.on('pageerror', e => errors.push('pageerror: '+e.message));
page.on('response', r => { if (r.status() >= 400) badreq.push(r.status()+' '+r.url()); });

let redirect = null;
await page.route('https://payment-links.mollie.com/**', route => {
  redirect = route.request().url();
  route.fulfill({ status:200, contentType:'text/html', body:'<h1>mollie-stub</h1>' });
});

await page.goto('http://127.0.0.1:8731/', { waitUntil:'networkidle' });

const schoon = t => t.replace(/ | /g,' ').trim();
const lees = () => page.evaluate(() => {
  const s = t => t.replace(/ | /g,' ').trim();
  return {
    totaal: s(document.getElementById('totaal').textContent),
    spec:   s(document.getElementById('specificatie').textContent),
    knop:   document.getElementById('afrekenen').disabled,
    leeg:   !document.getElementById('leegmelding').hidden,
    hint:   !document.getElementById('hint').hidden,
    regels: [...document.querySelectorAll('.regel')].map(r => ({
      id:    r.dataset.id,
      naam:  s(r.querySelector('.regel__naam').textContent),
      pot:   s(r.querySelector('.regel__pot').textContent),
      prijs: s(r.querySelector('.regel__prijs').textContent),
      som:   s(r.querySelector('.regel__som').textContent),
      veld:  r.querySelector('.regel__veld').value,
      min:   r.querySelector('button[data-stap="-1"]').disabled,
      meter: r.querySelector('.meter__tekst') ? s(r.querySelector('.meter__tekst').textContent) : null,
      vul:   r.querySelector('.meter__vul') ? r.querySelector('.meter__vul').style.width : null,
    })),
  };
});
const veld = id => page.locator(`.regel[data-id="${id}"] .regel__veld`);
const zet  = async (id, n) => { await veld(id).fill(String(n)); await page.waitForTimeout(25); };
const leeg = async () => { for (const id of ['vast','struik','boom']) await zet(id, 0); };

// ---------------- de drie producten staan er ----------------
let s = await lees();
ok('drie productregels', s.regels.length === 3, s.regels.map(r=>r.id).join(', '));
const verwacht = [
  ['vast',   'Vaste planten', '9 cm pot',     '3,50', '3,00 vanaf 24'],
  ['struik', 'Fruitstruiken', '15 cm pot',    '7,50', null],
  ['boom',   'Fruitbomen',    '11 liter pot', '17,95', null],
];
for (const [i,[id,naam,pot,prijs,staffel]] of verwacht.entries()) {
  const r = s.regels[i];
  ok(`regel ${i+1}: ${naam} (${pot}, € ${prijs})`,
     r.id===id && r.naam===naam && r.pot===pot && r.prijs.includes(prijs),
     `${r.naam} / ${r.pot} / ${r.prijs}`);
  if (staffel) ok('  toont de staffelprijs', r.prijs.includes('3,00') && r.prijs.includes('24'), r.prijs);
  else ok(`  ${naam}: geen staffel`, r.meter === null && !r.prijs.includes('vanaf'), r.prijs);
}

ok('start: knop uit', s.knop === true);
ok('start: leegmelding aan', s.leeg === true);
ok('start: alle minknoppen uit', s.regels.every(r => r.min === true));
ok('start: totaal 0,00', /0,00/.test(s.totaal), s.totaal);

// ---------------- rekenen per product ----------------
const proeven = [
  [{vast:1},                '3,50'],
  [{vast:23},               '80,50'],
  [{vast:24},               '72,00'],
  [{vast:25},               '75,00'],
  [{vast:999},              '2.997,00'],
  [{struik:1},              '7,50'],
  [{struik:4},              '30,00'],
  [{struik:24},             '180,00'],   // struiken kennen geen staffel
  [{boom:1},                '17,95'],
  [{boom:3},                '53,85'],
  [{boom:24},               '430,80'],
  [{vast:23, struik:4},     '110,50'],   // 80,50 + 30,00, staffel niet gehaald
  [{vast:24, struik:2, boom:1}, '104,95'], // 72,00 + 15,00 + 17,95
  [{vast:2, struik:1, boom:1},  '32,45'],  // 7,00 + 7,50 + 17,95
];
for (const [mand, totaal] of proeven) {
  await leeg();
  for (const [id, n] of Object.entries(mand)) await zet(id, n);
  s = await lees();
  const naam = Object.entries(mand).map(([k,v])=>`${v} ${k}`).join(' + ');
  ok(`${naam} => € ${totaal}`, s.totaal.includes(totaal), s.totaal);
}

// ---------------- de staffel telt alleen zijn eigen stuks ----------------
await leeg(); await zet('vast', 20); await zet('struik', 10);
s = await lees();
ok('20 vast + 10 struik: staffel NIET gehaald',
   !/Staffel gehaald/.test(s.regels[0].meter) && s.totaal.includes('145,00'), s.totaal);
ok('  meter zegt nog 4 planten', /Nog 4 planten/.test(s.regels[0].meter), s.regels[0].meter);

await leeg(); await zet('vast', 24);
s = await lees();
ok('24 vast: staffel gehaald', /Staffel gehaald/.test(s.regels[0].meter), s.regels[0].meter);
ok('  kortingsregel 12,00', /Staffelkorting/.test(s.spec) && /12,00/.test(s.spec), s.spec);
ok('  meter vol', s.regels[0].vul === '100%', s.regels[0].vul);
await zet('vast', 23); s = await lees();
ok('23 vast: geen kortingsregel', !/Staffelkorting/.test(s.spec), s.spec);

// ---------------- de specificatie moet optellen naar het totaal ----------------
// Dit is de controle die de vorige versie zou hebben gepakt: daar stond de
// regel tegen de staffelprijs en de korting er nog eens onder, dus de klant
// die meerekende kwam 12 euro te laag uit.
for (const mand of [{vast:24}, {vast:24, struik:2, boom:1}, {vast:30, boom:2}, {struik:3}]) {
  await leeg();
  for (const [id, n] of Object.entries(mand)) await zet(id, n);
  const uit = await page.evaluate(() => {
    const naarCent = t => Math.round(parseFloat(
      t.replace(/[^0-9.,-]/g,'').replace(/\./g,'').replace(',','.')) * 100);
    const rijen = [...document.querySelectorAll('#specificatie .totaal__rij')].map(r => {
      const c = naarCent(r.lastElementChild.textContent);
      return r.classList.contains('totaal__rij--korting') ? -c : c;
    });
    return { som: rijen.reduce((a,b)=>a+b,0),
             totaal: naarCent(document.getElementById('totaal').textContent) };
  });
  const naam = Object.entries(mand).map(([k,v])=>`${v} ${k}`).join(' + ');
  ok(`specificatie telt op naar het totaal (${naam})`, uit.som === uit.totaal,
     `regels ${(uit.som/100).toFixed(2)} vs totaal ${(uit.totaal/100).toFixed(2)}`);
}

// ---------------- regeltotalen per kaart ----------------
await leeg(); await zet('vast', 24); await zet('struik', 2); await zet('boom', 1);
s = await lees();
ok('regeltotaal vaste planten 72,00',  s.regels[0].som.includes('72,00'),  s.regels[0].som);
ok('regeltotaal fruitstruiken 15,00',  s.regels[1].som.includes('15,00'),  s.regels[1].som);
ok('regeltotaal fruitbomen 17,95',     s.regels[2].som.includes('17,95'),  s.regels[2].som);

// ---------------- knoppen ----------------
await leeg();
await page.click('.regel[data-id="boom"] button[data-stap="1"]');
await page.click('.regel[data-id="boom"] button[data-stap="1"]');
ok('plus twee keer op fruitbomen => 2', (await veld('boom').inputValue()) === '2');
await page.click('.regel[data-id="boom"] button[data-stap="-1"]');
ok('min één keer => 1', (await veld('boom').inputValue()) === '1');
ok('andere regels blijven 0',
   (await veld('vast').inputValue()) === '0' && (await veld('struik').inputValue()) === '0');
await page.click('.regel[data-id="vast"] .regel__snel button[data-zet="24"]');
s = await lees();
ok('snelknop 24 raakt alleen de vaste planten',
   s.regels[0].veld === '24' && s.regels[2].veld === '1', s.regels.map(r=>r.veld).join('/'));
ok('  alleen die regel heeft snelknoppen',
   (await page.locator('.regel__snel').count()) === 1);

// ---------------- grenswaarden ----------------
for (const [in_, uit] of [['1500','999'],['-4','0'],['3.9','3'],['','0']]) {
  await zet('struik', in_);
  ok(`invoer "${in_}" => ${uit}`, (await veld('struik').inputValue()) === uit,
     'werd '+JSON.stringify(await veld('struik').inputValue()));
}
await leeg(); await zet('vast', 12);
await veld('vast').click();
await page.keyboard.press('Control+a');
await page.keyboard.type('abc');
await page.waitForTimeout(50);
{
  const v = await veld('vast').inputValue();
  s = await lees();
  ok('letters intypen: geen rest in veld', v === '' || v === '0', JSON.stringify(v));
  ok('letters intypen: totaal 0,00', /0,00/.test(s.totaal), s.totaal);
  ok('letters intypen: knop uit', s.knop === true);
}

// ---------------- tapdoelen en overloop ----------------
await leeg(); await zet('vast', 24);
const klein = await page.evaluate(() => {
  const uit = [];
  document.querySelectorAll('button, a[href], input').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.right < 0 || r.bottom < 0) return;   // buiten beeld (skiplink)
    if (r.height < 44 || r.width < 44) uit.push((el.id||el.className||el.tagName)+' '+Math.round(r.width)+'x'+Math.round(r.height));
  });
  return uit;
});
ok('alle tapdoelen >= 44px', klein.length === 0, klein.join(' | '));

for (const w of [320, 360, 390, 768, 1280]) {
  await page.setViewportSize({ width:w, height:844 });
  await page.waitForTimeout(60);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(`geen overloop op ${w}px`, over <= 0, 'over: '+over);
}
await page.setViewportSize({ width:390, height:844 });

// ---------------- klembord en doorsturen ----------------
await leeg(); await zet('vast', 24); await zet('struik', 2); await zet('boom', 1);
await page.click('#afrekenen');
await page.waitForTimeout(120);
ok('klembord bevat 104,95', (await page.evaluate(() => navigator.clipboard.readText())) === '104,95',
   JSON.stringify(await page.evaluate(() => navigator.clipboard.readText())));
s = await lees();
ok('hint zichtbaar na klik', s.hint === true);
ok('hint toont € 104,95', schoon(await page.textContent('#hintbedrag')).includes('104,95'));
ok('knoptekst bevestigt kopie', /104,95/.test(await page.textContent('#knoptekst')));
await page.waitForTimeout(1400);
ok('betaallink is een https mollie-betaallink',
   /^https:\/\/payment-links\.mollie\.com\/payment\/[A-Za-z0-9]+$/.test(BETAALLINK || ''), String(BETAALLINK));
ok('doorgestuurd naar de link die de pagina zelf noemt', redirect === BETAALLINK, String(redirect));

// ---------------- logo op de kopbalk ----------------
await page.goto('http://127.0.0.1:8731/', { waitUntil:'networkidle' });
await page.locator('.kop').screenshot({ path: path.join(ROOT, '.kop.png') });
{
  const png = fs.readFileSync(path.join(ROOT, '.kop.png'));
  const uit = await page.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const lum = (r,g,b) => { const f = v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
      return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
    const achter = lum(d[0], d[1], d[2]);
    let donkerst = 1;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i+3] < 128) continue;
      const L = lum(d[i], d[i+1], d[i+2]);
      if (L < donkerst) donkerst = L;
    }
    const hoog = Math.max(achter, donkerst), laag = Math.min(achter, donkerst);
    return (hoog + 0.05) / (laag + 0.05);
  }, png.toString('base64'));
  ok('logo steekt af tegen de kopbalk (>= 3:1)', uit >= 3, uit.toFixed(2)+':1');
}

// ---------------- terugval als het klembord geweigerd wordt ----------------
{
  const p3 = await ctx.newPage();
  let r3 = null;
  await p3.route('https://payment-links.mollie.com/**', r => { r3 = r.request().url();
    r.fulfill({ status:200, contentType:'text/html', body:'stub' }); });
  await p3.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { get(){ throw new Error('geweigerd'); } });
    document.execCommand = () => false;
  });
  await p3.goto('http://127.0.0.1:8731/', { waitUntil:'networkidle' });
  await p3.locator('.regel[data-id="boom"] .regel__veld').fill('2');
  await p3.click('#afrekenen');
  await p3.waitForTimeout(120);
  const t3 = await p3.textContent('#knoptekst');
  ok('terugval: geen valse kopieermelding', !/gekopieerd/.test(t3), t3);
  ok('terugval: bedrag staat er om over te typen',
     (await p3.evaluate(() => !document.getElementById('hint').hidden)) &&
     schoon(await p3.textContent('#hintbedrag')).includes('35,90'),
     schoon(await p3.textContent('#hintbedrag')));
  await p3.waitForTimeout(1400);
  ok('terugval: toch doorgestuurd naar mollie', r3 !== null, String(r3));
  await p3.close();
}

const fontOk = await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('800 34px Nunito'); });
ok('Nunito geladen', fontOk === true);

// ---------------- bedankpagina ----------------
const p2 = await ctx.newPage();
const err2 = [];
p2.on('pageerror', e => err2.push(e.message));
p2.on('response', r => { if (r.status() >= 400) badreq.push(r.status()+' '+r.url()); });
await p2.goto('http://127.0.0.1:8731/bedankt.html', { waitUntil:'networkidle' });
ok('bedankt: geen overloop',
   (await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
ok('bedankt: geen fouten', err2.length === 0, err2.join(' | '));
ok('bedankt: doet geen uitspraak over de betaling',
   !/betaling is (binnen|gelukt|geslaagd|ontvangen)/i.test(await p2.textContent('body')));

const echteFouten = errors.filter(e => !/payment-links\.mollie\.com\/favicon/.test(e));
ok('geen console-fouten', echteFouten.length === 0, echteFouten.join(' | '));
ok('geen mislukte requests', badreq.length === 0, badreq.join(' | '));

await page.setViewportSize({ width:390, height:844 });
await leeg(); await zet('vast', 24); await zet('struik', 2); await zet('boom', 1);
await page.screenshot({ path: path.join(ROOT, '.kassa-390.png'), fullPage:true });

await browser.close(); srv.close();
console.log('\n' + (fails.length ? 'MISLUKT: '+fails.length+'\n - '+fails.join('\n - ') : 'ALLES GOED'));
process.exit(fails.length ? 1 : 0);
