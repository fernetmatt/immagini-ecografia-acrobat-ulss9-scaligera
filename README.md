<img src="assets/logo_ulss9_scaligera.png" alt="Regione del Veneto — ULSS 9 Scaligera" width="360">

# Immagini Ecografia Regione Veneto

Estrai le immagini ecografiche dai referti PDF della Regione Veneto (ULSS 9 Scaligera), direttamente nel browser.

## Il problema

I referti ecografici distribuiti dalla Regione Veneto si aprono correttamente solo con Adobe Acrobat: qualsiasi altro lettore mostra una pagina vuota con un messaggio di attesa. Il motivo è che non si tratta di normali PDF, ma di moduli Adobe XFA cifrati, in cui le immagini ecografiche non compaiono su nessuna pagina: sono codificate in base64 all'interno dei dati del modulo. Per questo i comuni strumenti di estrazione immagini non trovano nulla.

## Cosa fa questo strumento

Apri la pagina, trascina il referto PDF e lo strumento tira fuori tutte le immagini incorporate: puoi visualizzarle a schermo intero e salvarle come normali file JPEG o PNG.

- **Privacy garantita dall'architettura**: è una pagina statica, senza server, senza upload e senza tracciamento. I file non lasciano mai il tuo browser.
- Decifra il PDF direttamente nel browser (AES-128 con la password vuota standard).
- Cerca le immagini su tre livelli:
  - quelle disegnate sulle pagine del PDF,
  - quelle nei dati del modulo XFA (è qui che si trovano i fotogrammi ecografici),
  - quelle nei file allegati al PDF, ispezionando ricorsivamente anche gli eventuali PDF allegati.
- Scarta automaticamente i duplicati confrontando il contenuto (hash).

## Come si usa

Apri **https://fernetmatt.github.io/immagini-ecografia-acrobat-ulss9-scaligera/** e trascina il tuo referto sulla pagina.

Per usarlo offline: scarica `lightbox.html` (un unico file autosufficiente) e aprilo con un doppio clic. Non servono né un server né una connessione a internet.

## Sviluppo

- Il sorgente è composto da `index.html`, `app.js`, `core.js` e `vendor/`; GitHub Pages li serve così come sono.
- `node build.mjs` rigenera `lightbox.html`, la versione a file singolo per l'uso offline.

## Dettagli tecnici

- La pagina incorpora [Mozilla pdf.js](https://mozilla.github.io/pdf.js/) per le immagini di pagina, gli allegati e la gestione delle password.
- Un piccolo motore dedicato (`core.js`) analizza il PDF a basso livello: decifratura con il security handler standard (RC4, AES-128, AES-256, con password vuota o fornita dall'utente), decompressione FlateDecode tramite `DecompressionStream` e infine una scansione dei flussi di testo alla ricerca di blocchi base64 che contengono le immagini XFA.
- Tutto gira in JavaScript lato client.

## Licenza

Il codice di questo repository è rilasciato con licenza MIT. La copia di pdf.js inclusa è © Mozilla Foundation, con licenza Apache 2.0 (le intestazioni originali sono conservate nei file).

Il logo Regione del Veneto / ULSS 9 Scaligera appartiene al rispettivo proprietario. Questo è uno strumento indipendente e non è un prodotto ufficiale della Regione del Veneto né della ULSS 9 Scaligera.
