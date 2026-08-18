<img src="assets/logo_ulss9_scaligera.png" alt="Regione del Veneto — ULSS 9 Scaligera" width="360">

# Immagini Ecografia Regione Veneto

Estrai le immagini ecografiche dal referto PDF della Regione Veneto (ULSS 9 Scaligera), direttamente nel browser.

## Il problema

Il referto PDF si apre solo con Adobe Acrobat. Negli altri lettori PDF vedi una sola pagina con un messaggio di attesa. Le immagini non sono nelle pagine. Il PDF è un modulo Adobe XFA cifrato. Le immagini sono dati base64 dentro il modulo. Gli strumenti comuni di estrazione non trovano niente.

## Che cosa fa questo strumento

Apri la pagina web e trascina il PDF. Lo strumento mostra tutte le immagini incorporate. Puoi vedere ogni immagine a schermo intero. Puoi salvare ogni immagine come file JPEG o PNG normale.

- **Privato per costruzione.** Lo strumento è una pagina web statica. I tuoi file restano nel browser. Non c'è upload, non c'è un server, non c'è tracciamento.
- Lo strumento decifra il PDF nel browser (AES-128, password vuota standard).
- Lo strumento trova le immagini in tre livelli:
  - le immagini disegnate sulle pagine del PDF,
  - le immagini dentro i dati del modulo XFA (qui ci sono i fotogrammi ecografici),
  - i file allegati dentro il PDF, con ricerca anche dentro i PDF allegati.
- Lo strumento salta le immagini doppie con un controllo del contenuto (hash).

## Uso

Apri **https://fernetmatt.github.io/immagini-ecografia-acrobat-ulss9-scaligera/** e trascina il tuo referto PDF sulla pagina.

Uso senza internet: scarica `lightbox.html` (un solo file completo) e aprilo con un doppio clic. Non serve un server. Non serve una connessione.

## Sviluppo

- `index.html` + `app.js` + `core.js` + `vendor/` sono il codice sorgente. GitHub Pages li serve direttamente.
- `node build.mjs` genera di nuovo `lightbox.html`, il file singolo per l'uso senza internet.

## Dettagli tecnici

- La pagina include [Mozilla pdf.js](https://mozilla.github.io/pdf.js/) per le immagini di pagina, gli allegati e le password.
- Un piccolo motore separato (`core.js`) legge il PDF in modo diretto: decifratura standard (RC4, AES-128, AES-256, con password vuota o inserita), decompressione FlateDecode con `DecompressionStream`, poi una scansione base64 dei flussi di testo per trovare le immagini XFA.
- Tutto è JavaScript lato client.

## Licenza

Il codice di questo repository è con licenza MIT. Il pdf.js incluso è © Mozilla Foundation, licenza Apache 2.0 (le intestazioni di licenza restano nei file inclusi).

Il logo Regione del Veneto / ULSS 9 Scaligera appartiene al suo proprietario. Questo è uno strumento indipendente. Non è un prodotto ufficiale della Regione del Veneto o della ULSS 9 Scaligera.
