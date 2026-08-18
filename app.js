/* PDF Lightbox — app logic. Engines: pdf.js (page images, attachments) +
 * PdfImageCore.rawScan (XFA base64 images, embedded files, decryption). */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const core = window.PdfImageCore;
  const pdfjs = window.pdfjsLib;
  // Multi-file page on http(s): pdf.js starts a real Web Worker from this URL.
  // file:// or the single-file build (inline pdfjsWorker): pdf.js falls back
  // to the main-thread worker on its own.
  pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  let downloads = null;
  let downloadsReady = (window.claude && window.claude.use)
    ? window.claude.use('downloads').then(d => { downloads = d; refreshSaveUI(); })
    : Promise.resolve(null);
  let canDownloadFallback = false;
  try {
    // outside the claude.ai viewer (e.g. a local copy), <a download> works
    canDownloadFallback = !(window.claude && window.claude.use);
  } catch (e) { /* ignore */ }

  const state = {
    items: [],          // {id, bytes, ext, mime, origin, w, h, filename, url, sourceEl}
    hashes: new Set(),  // sha256 of image bytes
    pdfHashes: new Set(),
    totalDupes: 0,
    busy: false,
  };

  // ---------- UI helpers ----------
  function status(msg, busy) {
    const el = $('status');
    el.textContent = msg || '';
    el.classList.toggle('busy', !!busy);
  }
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function sanitize(name) {
    return name.replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 48);
  }
  function refreshSummary() {
    const bar = $('summarybar');
    if (!state.items.length) { bar.classList.remove('show'); return; }
    bar.classList.add('show');
    let s = state.items.length + (state.items.length === 1 ? ' image' : ' images');
    if (state.totalDupes) s += ' · ' + state.totalDupes + ' duplicates skipped';
    $('summary').textContent = s;
  }
  function refreshSaveUI() {
    const usable = !!downloads || canDownloadFallback;
    $('saveall').style.display = usable ? '' : 'none';
    document.querySelectorAll('.tile-save, #modal-save').forEach(b => {
      b.style.display = usable ? '' : 'none';
    });
    if (!usable && state.items.length) {
      status('Saving is not available in this view. Open the artifact on claude.ai to save images.');
    }
  }

  const BADGE = {
    page: { cls: 'page', label: 'PAGE', title: 'Image drawn on a PDF page' },
    xfa: { cls: 'xfa', label: 'FORM', title: 'Image stored in XFA form data' },
    'embedded-file': { cls: 'file', label: 'FILE', title: 'Image attached as a file' },
    attachment: { cls: 'file', label: 'FILE', title: 'Image attached as a file' },
  };

  function makeSourceSection(label) {
    const wrap = document.createElement('section');
    wrap.className = 'source';
    wrap.innerHTML =
      '<div class="source-head"><span class="source-name"></span>' +
      '<span class="source-meta"></span></div>' +
      '<div class="notes"></div><div class="grid"></div>';
    wrap.querySelector('.source-name').textContent = label;
    $('sources').appendChild(wrap);
    return {
      el: wrap,
      grid: wrap.querySelector('.grid'),
      meta: wrap.querySelector('.source-meta'),
      notes: wrap.querySelector('.notes'),
      count: 0,
      dupes: 0,
      label,
      update() {
        const parts = [this.count + (this.count === 1 ? ' image' : ' images')];
        if (this.dupes) parts.push(this.dupes + ' dup');
        this.meta.textContent = parts.join(' · ');
      },
      note(msg) {
        const d = document.createElement('div');
        d.className = 'source-note';
        d.textContent = msg;
        this.notes.appendChild(d);
      },
    };
  }

  async function addItem(src, bytes, ext, mime, origin, w, h) {
    const hash = await core.sha256hex(bytes);
    if (state.hashes.has(hash)) { src.dupes++; state.totalDupes++; src.update(); return null; }
    state.hashes.add(hash);
    src.count++;
    const idx = src.count;
    const item = {
      bytes, ext, mime, origin, w: w || 0, h: h || 0,
      filename: sanitize(src.label.split(' › ').pop()) + '_' + String(idx).padStart(2, '0') + '.' + ext,
      url: URL.createObjectURL(new Blob([bytes], { type: mime })),
    };
    state.items.push(item);

    const tile = document.createElement('div');
    tile.className = 'tile';
    const badge = BADGE[origin] || BADGE.page;
    const viewable = ['jpg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
    tile.innerHTML =
      '<button class="thumb" title="View full size">' +
      (viewable ? '<img loading="lazy" alt="">' : '<span class="noview">' + ext.toUpperCase() + ' — no preview</span>') +
      '</button>' +
      '<div class="tile-info"><div class="tile-data">' +
      '<div class="fname"></div><div class="dims"></div></div>' +
      '<button class="tile-save" title="Save this image">Save</button></div>';
    tile.querySelector('.fname').textContent = item.filename;
    const dims = tile.querySelector('.dims');
    const badgeEl = document.createElement('span');
    badgeEl.className = 'badge ' + badge.cls;
    badgeEl.textContent = badge.label;
    badgeEl.title = badge.title;
    function setDims() {
      dims.textContent = (item.w && item.h ? item.w + '×' + item.h + ' · ' : '') + fmtSize(bytes.length) + ' ';
      dims.appendChild(badgeEl);
    }
    setDims();
    if (viewable) {
      const img = tile.querySelector('img');
      img.src = item.url;
      img.alt = item.filename;
      if (!item.w) img.addEventListener('load', () => {
        item.w = img.naturalWidth; item.h = img.naturalHeight; setDims();
      });
    }
    tile.querySelector('.thumb').addEventListener('click', () => openModal(item));
    tile.querySelector('.tile-save').addEventListener('click', e => saveItem(item, e.target));
    src.grid.appendChild(tile);
    src.update();
    refreshSummary();
    refreshSaveUI();
    return item;
  }

  // ---------- saving ----------
  async function toSavable(item) {
    // convert formats outside the download allowlist to PNG
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(item.ext)) {
      return { filename: item.filename, data: item.bytes };
    }
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res; img.onerror = () => rej(new Error('cannot decode ' + item.ext));
      img.src = item.url;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    return { filename: item.filename.replace(/\.\w+$/, '.png'), data: new Uint8Array(await blob.arrayBuffer()) };
  }

  async function saveItem(item, btn) {
    if (btn) btn.disabled = true;
    try {
      const payload = await toSavable(item);
      if (downloads) {
        await downloads.save(payload);
        status('Saved ' + payload.filename);
      } else if (canDownloadFallback) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([payload.data], { type: item.mime }));
        a.download = payload.filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
      return true;
    } catch (e) {
      if (e && e.code === 'declined') status('Save cancelled.');
      else status('Save failed: ' + (e.message || e));
      return e && e.code === 'rate_limited' ? 'retry' : false;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  $('saveall').addEventListener('click', async () => {
    const btn = $('saveall');
    btn.disabled = true;
    try {
      for (let i = 0; i < state.items.length; i++) {
        status('Saving image ' + (i + 1) + ' of ' + state.items.length + '…', true);
        let r = await saveItem(state.items[i]);
        if (r === 'retry') {
          await new Promise(res => setTimeout(res, 2000));
          r = await saveItem(state.items[i]);
        }
        if (r !== true) { status('Stopped. Saved ' + i + ' of ' + state.items.length + ' images.'); return; }
      }
      status('Saved all ' + state.items.length + ' images.');
    } finally { btn.disabled = false; }
  });

  // ---------- modal ----------
  let modalItem = null;
  function openModal(item) {
    if (!['jpg', 'png', 'gif', 'webp', 'bmp'].includes(item.ext)) return;
    modalItem = item;
    $('modal-img').src = item.url;
    $('modal-img').alt = item.filename;
    $('modal-meta').textContent = item.filename + ' · ' +
      (item.w ? item.w + '×' + item.h + ' · ' : '') + fmtSize(item.bytes.length);
    $('modal').classList.add('show');
    $('modal-close').focus();
  }
  function closeModal() { $('modal').classList.remove('show'); modalItem = null; }
  $('modal-close').addEventListener('click', closeModal);
  $('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  $('modal-save').addEventListener('click', e => { if (modalItem) saveItem(modalItem, e.target); });

  // ---------- extraction ----------
  function kindToCanvas(img) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    const id = ctx.createImageData(img.width, img.height);
    const d = id.data, s = img.data, w = img.width, h = img.height;
    if (img.kind === 3) {
      d.set(s.subarray(0, w * h * 4));
    } else if (img.kind === 2) {
      for (let i = 0, o = 0; i < w * h * 3; i += 3, o += 4) {
        d[o] = s[i]; d[o + 1] = s[i + 1]; d[o + 2] = s[i + 2]; d[o + 3] = 255;
      }
    } else if (img.kind === 1) {
      const bpr = (w + 7) >> 3;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = ((s[y * bpr + (x >> 3)] >> (7 - (x & 7))) & 1) ? 255 : 0;
        const o = (y * w + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
      }
    } else return null;
    ctx.putImageData(id, 0, 0);
    return c;
  }

  async function pdfjsPass(src, bytes, password, depth) {
    let doc;
    try {
      doc = await pdfjs.getDocument({
        data: bytes.slice(), password,
        isOffscreenCanvasSupported: false, verbosity: 0, stopAtErrors: false,
      }).promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') return { needsPassword: true };
      src.note('Page reader error: ' + (e.message || e));
      return {};
    }
    const seen = new Set();
    for (let p = 1; p <= doc.numPages; p++) {
      status('Reading ' + src.label + ' — page ' + p + ' of ' + doc.numPages + '…', true);
      try {
        const page = await doc.getPage(p);
        const ops = await page.getOperatorList();
        for (let i = 0; i < ops.fnArray.length; i++) {
          const fn = ops.fnArray[i];
          let imgObj = null;
          if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintImageXObjectRepeat) {
            const id = ops.argsArray[i][0];
            if (seen.has(id)) continue;
            seen.add(id);
            try {
              imgObj = id.startsWith('g_') ? page.commonObjs.get(id) : page.objs.get(id);
            } catch (e) { continue; }
          } else if (fn === pdfjs.OPS.paintInlineImageXObject) {
            imgObj = ops.argsArray[i][0];
          }
          if (!imgObj || !imgObj.width) continue;
          let canvas = null;
          if (imgObj.bitmap) {
            canvas = document.createElement('canvas');
            canvas.width = imgObj.width; canvas.height = imgObj.height;
            canvas.getContext('2d').drawImage(imgObj.bitmap, 0, 0);
          } else if (imgObj.data) {
            canvas = kindToCanvas(imgObj);
          }
          if (!canvas) continue;
          const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
          if (!blob) continue;
          const out = new Uint8Array(await blob.arrayBuffer());
          await addItem(src, out, 'png', 'image/png', 'page', imgObj.width, imgObj.height);
        }
        page.cleanup();
      } catch (e) {
        src.note('Page ' + p + ' error: ' + (e.message || e));
      }
    }
    // attachments
    try {
      const atts = await doc.getAttachments();
      if (atts) {
        for (const key of Object.keys(atts)) {
          const att = atts[key];
          const content = att.content instanceof Uint8Array ? att.content : new Uint8Array(att.content || []);
          if (!content.length) continue;
          if (core.isPdf(content)) {
            await processPdf(content, src.label + ' › ' + (att.filename || key), depth + 1, password);
          } else {
            const magic = core.imageMagic(content);
            if (magic) await addItem(src, content, magic.ext, magic.mime, 'attachment', 0, 0);
          }
        }
      }
    } catch (e) { /* no attachments */ }
    await doc.destroy();
    return {};
  }

  async function processPdf(bytes, label, depth, password) {
    if (depth > 3) return;
    const pdfHash = await core.sha256hex(bytes);
    if (state.pdfHashes.has(pdfHash)) {
      if (depth === 0) {
        const dup = makeSourceSection(label);
        dup.note('Skipped: this file was already processed (same content).');
      }
      return;
    }
    state.pdfHashes.add(pdfHash);

    const src = makeSourceSection(label);
    src.update();

    // Engine A: pdf.js — page images + attachments
    const a = await pdfjsPass(src, bytes, password, depth);

    // Engine B: raw scan — XFA form images + embedded files + decryption
    status('Deep scan of ' + label + '…', true);
    let b = { images: [], embedded: [], needsPassword: false, notes: [] };
    try {
      b = await core.rawScan(bytes, { password });
    } catch (e) {
      src.note('Deep scan error: ' + (e.message || e));
    }
    for (const im of b.images) {
      await addItem(src, im.bytes, im.ext, im.mime, im.origin, 0, 0);
    }
    for (const n of b.notes || []) src.note(n);
    for (const [i, emb] of (b.embedded || []).entries()) {
      await processPdf(emb.bytes, label + ' › embedded file ' + (i + 1), depth + 1, password);
    }

    if ((a.needsPassword || b.needsPassword) && src.count === 0) {
      src.note('This file is protected. Enter the password, then process it again.');
      const row = document.createElement('div');
      row.className = 'pwd-row';
      row.innerHTML = '<input type="password" placeholder="password" aria-label="PDF password">' +
        '<button>Unlock</button>';
      src.notes.appendChild(row);
      row.querySelector('button').addEventListener('click', async () => {
        const pwd = row.querySelector('input').value;
        row.remove();
        src.el.remove();
        state.pdfHashes.delete(pdfHash);
        state.busy = true;
        await processPdf(bytes, label, depth, pwd);
        state.busy = false;
        status('Done.');
      });
    } else if (src.count === 0 && src.dupes === 0) {
      src.note('No images found in this file.');
    }
    src.update();
  }

  // ---------- intake ----------
  async function handleFiles(files) {
    if (state.busy) return;
    const pdfs = Array.from(files);
    if (!pdfs.length) return;
    state.busy = true;
    try {
      for (const f of pdfs) {
        if (f.size > 200 * 1048576) { status('Skipped ' + f.name + ': larger than 200 MB.'); continue; }
        status('Reading ' + f.name + '…', true);
        const bytes = new Uint8Array(await f.arrayBuffer());
        if (!core.isPdf(bytes)) {
          const magic = core.imageMagic(bytes);
          if (magic) {
            const src = makeSourceSection(f.name);
            await addItem(src, bytes, magic.ext, magic.mime, 'attachment', 0, 0);
          } else {
            status('Skipped ' + f.name + ': not a PDF file.');
          }
          continue;
        }
        await processPdf(bytes, f.name, 0, undefined);
      }
      status(state.items.length
        ? 'Done. ' + state.items.length + ' images ready.'
        : 'Done. No images found.');
    } catch (e) {
      status('Error: ' + (e.message || e));
    } finally {
      state.busy = false;
      refreshSummary();
      refreshSaveUI();
    }
  }

  const dz = $('dropzone');
  dz.addEventListener('click', () => $('fileinput').click());
  dz.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileinput').click(); }
  });
  $('fileinput').addEventListener('change', e => { handleFiles(e.target.files); e.target.value = ''; });
  ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault(); dz.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault(); dz.classList.remove('drag');
  }));
  dz.addEventListener('drop', e => handleFiles(e.dataTransfer.files));

  downloadsReady.then(refreshSaveUI);
})();
