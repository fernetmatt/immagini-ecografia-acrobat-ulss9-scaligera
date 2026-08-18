<img src="assets/logo_ulss9_scaligera.png" alt="Regione del Veneto — ULSS 9 Scaligera" width="360">

# Immagini Ecografia Regione Veneto

Get your ultrasound images out of the PDF report that Regione Veneto (ULSS 9 Scaligera) gives you.

*Estrai le immagini ecografiche dal referto PDF della Regione Veneto, direttamente nel browser.*

## The problem

The referto PDF opens only in Adobe Acrobat. In other viewers you see one page with a "please wait" message. The ultrasound images are not on the pages: the PDF is an encrypted Adobe XFA form, and the images are base64 data inside the form. Normal "extract images from PDF" tools find nothing.

## What this tool does

Open the web page, drop the PDF, and the tool shows every embedded image. You can view each image full size and save it as a normal JPEG or PNG file.

- **Private by design.** The tool is one static web page. Your files stay in your browser. There is no upload, no server, and no analytics.
- It decrypts the PDF (AES-128, standard empty password) in the browser.
- It finds images in three layers:
  - images drawn on the PDF pages,
  - images inside the XFA form data (the ultrasound frames live here),
  - files attached inside the PDF, with recursion into attached PDFs.
- It skips duplicate images by content hash.

## Use

Open `lightbox.html` in a browser (double-click works — no server is needed). Then drop your referto PDF on the page.

## Details (technical)

- The page bundles [Mozilla pdf.js](https://mozilla.github.io/pdf.js/) for page images, attachments, and password handling.
- A small custom engine (`core.js` inside the page) parses the raw PDF: standard security handler decryption (RC4, AES-128, AES-256 with empty or given password), FlateDecode via `DecompressionStream`, then a base64 scan of text streams to find the XFA images.
- Everything is client-side JavaScript in one self-contained HTML file.

## License

MIT for the code in this repository. The bundled pdf.js is © Mozilla Foundation, Apache License 2.0 (license headers are kept in the bundled files).

The Regione del Veneto / ULSS 9 Scaligera logo belongs to its owner. This is an independent tool, not an official product of Regione del Veneto or ULSS 9 Scaligera.
