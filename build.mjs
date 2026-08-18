// Builds lightbox.html: a single self-contained file for offline use.
// It takes index.html and replaces every <script src="..."> with the
// inlined file content. Run: node build.mjs
import { readFileSync, writeFileSync } from 'node:fs';

function inline(src) {
  const code = readFileSync(src, 'utf8');
  if (code.includes('</script')) throw new Error(src + ' contains </script>');
  return '<script>\n' + code + '\n</script>';
}

let html = readFileSync('index.html', 'utf8');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  // the worker file is not referenced by a script tag; inline it right
  // after pdf.js so the single file works from file:// too (pdf.js then
  // uses the main-thread worker it finds in globalThis.pdfjsWorker)
  if (src === 'vendor/pdf.min.js') {
    return inline(src) + '\n' + inline('vendor/pdf.worker.min.js');
  }
  return inline(src);
});
writeFileSync('lightbox.html', html);
console.log('wrote lightbox.html (' + (html.length / 1048576).toFixed(1) + ' MB)');
