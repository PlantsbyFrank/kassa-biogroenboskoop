# Kassapagina BioGroen Boskoop

Drie bestanden, verder niets. Geen server, geen database, geen sleutels.
Zet ze naast elkaar op een https-adres en het werkt.

| bestand | wat het is |
|---|---|
| `index.html` | de rekenpagina: aantal invullen, totaal zien, bedrag kopiëren, door naar Mollie |
| `bedankt.html` | de pagina waar Mollie de klant na het betalen op terugzet |
| `bgb-fonts.css` | Nunito, in het bestand zelf meegebakken |
| `Biogroen boskoop LOGO.svg` | Het aangeleverde logo. De pagina gebruikt dit bestand niet rechtstreeks: het logo zit in de pagina zelf gebakken, zodat het schijfje achter het blaadje de kleur van zijn ondergrond kan krijgen. Dit is de bron. |
| `test-kassa.mjs` | 47 controles; draaien met `npm install playwright && node test-kassa.mjs` |

## Hoe het loopt

1. Klant scant de QR op het stoepbord en komt op `index.html`.
2. Hij tikt het aantal planten in. Vanaf 24 stuks zakt de prijs van € 3,50 naar € 3,00.
3. Hij drukt op **Kopieer bedrag & betaal**. Het totaal gaat naar het klembord.
4. Hij komt op de Mollie-betaallink met **open bedrag** en plakt of typt het totaal.
5. Na betalen zet Mollie hem op `bedankt.html`.

## Wat je hiervan moet weten

**De klant vult het bedrag zelf in.** De betaallink staat op open bedrag, dus
iemand die dat wil kan een lager bedrag typen dan de pagina laat zien. Dit is
geen bug, het is wat een opstelling zonder server nu eenmaal kost.

In de praktijk: leg je Mollie-overzicht af en toe naast wat er uit de kas weg is.
Wil je het bedrag echt vastzetten, dan moet er alsnog iets tussen staan dat per
bestelling een eigen betaling aanmaakt. Dat is beschreven in `betaalfunctie/`.

## Instellen

- De betaallink staat bovenin `index.html` in het blok `WINKEL`.
- Die link moet in Mollie op **herbruikbaar** staan, anders is hij na één
  betaling op. Een herbruikbare link is maximaal twee jaar geldig.
- De prijzen in `WINKEL` zijn alleen om te tonen. Houd ze gelijk aan het
  stoepbord, anders schrikt de klant.
- Zet in Mollie de **redirect-URL** op `bedankt.html`, anders blijft de klant
  op de Mollie-pagina hangen.

## Onderhoud

Alles staat live en is met een echte betaling doorlopen. Wat er in de gaten
gehouden moet worden:

- **De Mollie-link verloopt.** Een herbruikbare betaallink is maximaal twee
  jaar geldig. Daarna komt er een nieuwe, en dan is het hier één regel in
  `index.html`. Het stoepbord hoeft niet opnieuw: de QR wijst naar deze
  pagina, niet naar Mollie.
- **Prijzen.** Staan in het blok `WINKEL` bovenin `index.html`, en nog een
  keer in de tekst eromheen. Wijzig je ze, loop dan ook het bord langs.
- **Het bedrag staat open.** Zie de waarschuwing hierboven: leg je
  Mollie-overzicht af en toe naast wat er van het erf verdwijnt.
- **Instellingen die aan moeten blijven staan** in Mollie: de link op
  *herbruikbaar*, het bedrag op *open*, en de redirect-URL op
  `https://kassa.biogroenboskoop.nl/bedankt.html`. En in GitHub:
  Settings -> Pages met *Enforce HTTPS* aan, want zonder https weigert de
  telefoon het kopiëren van het bedrag.

## Waar dit draait

Deze repo is openbaar omdat GitHub Pages alleen op een openbare repo gratis is.
Er staat niets geheims in: de betaallink hieronder komt straks op een bord op
straat te hangen, dus die is per definitie openbaar. Er is geen sleutel, geen
wachtwoord en geen server.

Pages serveert `index.html` vanaf de hoofdmap. Alle verwijzingen zijn relatief,
dus het werkt zowel op `plantsbyfrank.github.io/kassa-biogroenboskoop/` als op
een eigen (sub)domein.
