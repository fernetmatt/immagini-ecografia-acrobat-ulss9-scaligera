/* PDF embedded-image extraction core.
 * Two engines:
 *  - rawScan: parses the PDF file directly. Decrypts streams (RC4, AES-128,
 *    AES-256, empty or given password), inflates FlateDecode, then finds
 *    base64 images in text streams (XFA forms) and embedded files.
 *  - the pdf.js engine lives in the host page / node test, not here.
 * Runs in browser and Node (needs DecompressionStream, crypto.subtle, atob).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PdfImageCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- small utils ----------
  function concat(arrays) {
    let len = 0;
    for (const a of arrays) len += a.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const a of arrays) { out.set(a, o); o += a.length; }
    return out;
  }
  function toBin(bytes) { // Uint8Array -> latin1 string
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return s;
  }
  function fromBin(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }
  function fromLatin1(str) { return fromBin(str); }

  async function sha256hex(bytes) {
    const d = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function inflate(bytes) {
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const chunks = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return concat(chunks);
  }

  const MAGIC = [
    { ext: 'jpg', mime: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    { ext: 'png', mime: 'image/png', test: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
    { ext: 'gif', mime: 'image/gif', test: b => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
    { ext: 'bmp', mime: 'image/bmp', test: b => b[0] === 0x42 && b[1] === 0x4d },
    { ext: 'webp', mime: 'image/webp', test: b => b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
    { ext: 'tif', mime: 'image/tiff', test: b => (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x2a) },
  ];
  function imageMagic(bytes) {
    if (!bytes || bytes.length < 16) return null;
    for (const m of MAGIC) if (m.test(bytes)) return m;
    return null;
  }
  function isPdf(bytes) {
    if (!bytes || bytes.length < 8) return false;
    const head = toBin(bytes.subarray(0, 1024));
    return head.indexOf('%PDF-') >= 0;
  }

  // ---------- MD5 (needed for RC4/AES-128 key derivation) ----------
  function md5(bytes) {
    const s = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
    const K = new Int32Array(64);
    for (let i = 0; i < 64; i++) K[i] = (Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    const len = bytes.length;
    const nBlocks = ((len + 8) >> 6) + 1;
    const buf = new Uint8Array(nBlocks * 64);
    buf.set(bytes);
    buf[len] = 0x80;
    const bitLen = len * 8;
    const dv = new DataView(buf.buffer);
    dv.setUint32(nBlocks * 64 - 8, bitLen >>> 0, true);
    dv.setUint32(nBlocks * 64 - 4, Math.floor(bitLen / 4294967296), true);
    let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    const M = new Int32Array(16);
    for (let blk = 0; blk < nBlocks; blk++) {
      for (let i = 0; i < 16; i++) M[i] = dv.getUint32(blk * 64 + i * 4, true);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
        else { F = C ^ (B | ~D); g = (7 * i) & 15; }
        F = (F + A + K[i] + M[g]) | 0;
        A = D; D = C; C = B;
        B = (B + ((F << s[i]) | (F >>> (32 - s[i])))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    const out = new Uint8Array(16);
    const ov = new DataView(out.buffer);
    ov.setInt32(0, a0, true); ov.setInt32(4, b0, true);
    ov.setInt32(8, c0, true); ov.setInt32(12, d0, true);
    return out;
  }

  // ---------- RC4 ----------
  function rc4(key, data) {
    const S = new Uint8Array(256);
    for (let i = 0; i < 256; i++) S[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + S[i] + key[i % key.length]) & 255;
      const t = S[i]; S[i] = S[j]; S[j] = t;
    }
    const out = new Uint8Array(data.length);
    let i = 0; j = 0;
    for (let k = 0; k < data.length; k++) {
      i = (i + 1) & 255;
      j = (j + S[i]) & 255;
      const t = S[i]; S[i] = S[j]; S[j] = t;
      out[k] = data[k] ^ S[(S[i] + S[j]) & 255];
    }
    return out;
  }

  // ---------- AES-CBC via WebCrypto ----------
  async function importAes(key) {
    return crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['encrypt', 'decrypt']);
  }
  // PDF stream content: first 16 bytes are the IV, rest is PKCS#7-padded.
  async function aesDecryptStream(keyBytes, data) {
    if (data.length < 32 || (data.length & 15)) return null;
    const k = await importAes(keyBytes);
    try {
      const out = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: data.subarray(0, 16) }, k, data.subarray(16));
      return new Uint8Array(out);
    } catch (e) { return null; }
  }
  // no-padding helpers (AES-256 key derivation)
  async function aesEncryptNoPad(keyBytes, iv, data) {
    const k = await importAes(keyBytes);
    const out = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, k, data));
    return out.subarray(0, data.length);
  }
  async function aesDecryptNoPad(keyBytes, iv, data) {
    const k = await importAes(keyBytes);
    // append a valid padding block so WebCrypto accepts it
    const padBlock = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv: data.subarray(data.length - 16) }, k, new Uint8Array(0)));
    const full = concat([data, padBlock]);
    const out = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, k, full));
    return out.subarray(0, data.length);
  }

  // ---------- minimal PDF object model ----------
  const WS = ' \t\r\n\f\0';
  const DELIM = '()<>[]{}/%';
  function isWs(ch) { return WS.indexOf(ch) >= 0; }

  function Lexer(s, pos) { this.s = s; this.pos = pos; }
  Lexer.prototype.skipWs = function () {
    for (;;) {
      while (this.pos < this.s.length && isWs(this.s[this.pos])) this.pos++;
      if (this.s[this.pos] === '%') {
        while (this.pos < this.s.length && this.s[this.pos] !== '\n' && this.s[this.pos] !== '\r') this.pos++;
      } else break;
    }
  };
  Lexer.prototype.parseValue = function () {
    this.skipWs();
    const s = this.s;
    const ch = s[this.pos];
    if (ch === '<') {
      if (s[this.pos + 1] === '<') return this.parseDict();
      return this.parseHexString();
    }
    if (ch === '(') return this.parseLiteralString();
    if (ch === '/') return this.parseName();
    if (ch === '[') return this.parseArray();
    if (ch === ']' || ch === '>') return undefined;
    // number, ref, or keyword
    const m = /^[-+0-9.]+/.exec(s.slice(this.pos, this.pos + 32));
    if (m) {
      const save = this.pos;
      this.pos += m[0].length;
      const n1 = parseFloat(m[0]);
      // maybe "n g R"
      const rest = s.slice(this.pos, this.pos + 24);
      const rm = /^\s+(\d+)\s+R(?![a-zA-Z0-9])/.exec(rest);
      if (rm && Number.isInteger(n1) && n1 >= 0) {
        this.pos += rm[0].length;
        return { ref: [n1, parseInt(rm[1], 10)] };
      }
      // not a ref; keep n1
      void save;
      return n1;
    }
    const km = /^(true|false|null)/.exec(s.slice(this.pos, this.pos + 6));
    if (km) { this.pos += km[1].length; return km[1] === 'true' ? true : km[1] === 'false' ? false : null; }
    this.pos++; // unknown byte, skip
    return undefined;
  };
  Lexer.prototype.parseName = function () {
    const s = this.s;
    let i = this.pos + 1, out = '/';
    while (i < s.length && !isWs(s[i]) && DELIM.indexOf(s[i]) < 0) {
      if (s[i] === '#' && /[0-9a-fA-F]{2}/.test(s.slice(i + 1, i + 3))) {
        out += String.fromCharCode(parseInt(s.slice(i + 1, i + 3), 16));
        i += 3;
      } else out += s[i++];
    }
    this.pos = i;
    return out;
  };
  Lexer.prototype.parseHexString = function () {
    const s = this.s;
    let i = this.pos + 1, hex = '';
    while (i < s.length && s[i] !== '>') {
      if (/[0-9a-fA-F]/.test(s[i])) hex += s[i];
      i++;
    }
    this.pos = i + 1;
    if (hex.length & 1) hex += '0';
    const bytes = new Uint8Array(hex.length / 2);
    for (let k = 0; k < bytes.length; k++) bytes[k] = parseInt(hex.substr(k * 2, 2), 16);
    return { str: bytes };
  };
  Lexer.prototype.parseLiteralString = function () {
    const s = this.s;
    let i = this.pos + 1, depth = 1;
    const out = [];
    while (i < s.length && depth > 0) {
      const c = s[i];
      if (c === '\\') {
        const n = s[i + 1];
        i += 2;
        if (n === 'n') out.push(10);
        else if (n === 'r') out.push(13);
        else if (n === 't') out.push(9);
        else if (n === 'b') out.push(8);
        else if (n === 'f') out.push(12);
        else if (n === '(') out.push(40);
        else if (n === ')') out.push(41);
        else if (n === '\\') out.push(92);
        else if (n >= '0' && n <= '7') {
          let oct = n, k = 0;
          while (k < 2 && s[i] >= '0' && s[i] <= '7') { oct += s[i++]; k++; }
          out.push(parseInt(oct, 8) & 255);
        } else if (n === '\r') { if (s[i] === '\n') i++; }
        else if (n === '\n') { /* continuation */ }
        else out.push(n.charCodeAt(0));
      } else if (c === '(') { depth++; out.push(40); i++; }
      else if (c === ')') { depth--; if (depth > 0) out.push(41); i++; }
      else { out.push(c.charCodeAt(0) & 255); i++; }
    }
    this.pos = i;
    return { str: new Uint8Array(out) };
  };
  Lexer.prototype.parseArray = function () {
    this.pos++; // [
    const arr = [];
    for (;;) {
      this.skipWs();
      if (this.pos >= this.s.length) break;
      if (this.s[this.pos] === ']') { this.pos++; break; }
      const v = this.parseValue();
      if (v === undefined) { this.pos++; continue; }
      arr.push(v);
    }
    return arr;
  };
  Lexer.prototype.parseDict = function () {
    this.pos += 2; // <<
    const d = {};
    for (;;) {
      this.skipWs();
      if (this.pos >= this.s.length) break;
      if (this.s[this.pos] === '>' && this.s[this.pos + 1] === '>') { this.pos += 2; break; }
      if (this.s[this.pos] !== '/') { this.pos++; continue; }
      const key = this.parseName();
      const val = this.parseValue();
      d[key] = val;
    }
    return d;
  };

  // ---------- raw file scan ----------
  function findObjects(bin) {
    // returns [{num, gen, dict, dictEnd, streamStart, streamEnd}]
    const objs = [];
    const re = /(\d{1,7})\s+(\d{1,5})\s+obj\b/g;
    let m;
    while ((m = re.exec(bin))) {
      const num = parseInt(m[1], 10), gen = parseInt(m[2], 10);
      const lx = new Lexer(bin, re.lastIndex);
      lx.skipWs();
      let dict = null;
      if (bin[lx.pos] === '<' && bin[lx.pos + 1] === '<') dict = lx.parseDict();
      else continue;
      let streamStart = -1, streamEnd = -1;
      lx.skipWs();
      if (bin.startsWith('stream', lx.pos)) {
        let p = lx.pos + 6;
        if (bin[p] === '\r') p++;
        if (bin[p] === '\n') p++;
        streamStart = p;
        let len = dict['/Length'];
        if (typeof len === 'number' && bin.startsWith('endstream', seekEndstream(bin, p + len))) {
          streamEnd = p + len;
        } else {
          const e = bin.indexOf('endstream', p);
          if (e < 0) continue;
          streamEnd = e;
          while (streamEnd > p && (bin[streamEnd - 1] === '\n' || bin[streamEnd - 1] === '\r')) streamEnd--;
        }
        re.lastIndex = streamEnd;
      }
      objs.push({ num, gen, dict, streamStart, streamEnd });
    }
    return objs;
  }
  function seekEndstream(bin, p) {
    // allow EOL before endstream
    if (bin[p] === '\r') p++;
    if (bin[p] === '\n') p++;
    return p;
  }

  function resolveRef(v, objByNum) {
    let depth = 0;
    while (v && typeof v === 'object' && v.ref && depth++ < 8) {
      const o = objByNum.get(v.ref[0]);
      v = o ? o.dict : undefined;
      if (o && o.inlineValue !== undefined) v = o.inlineValue;
    }
    return v;
  }

  const PAD = new Uint8Array([
    0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
    0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
  ]);

  // Standard security handler key derivation, revisions 2-4.
  function computeKeyR234(enc, password) {
    const n = (enc.length || 40) / 8;
    const pwd = new Uint8Array(32);
    const pb = password || new Uint8Array(0);
    pwd.set(pb.subarray(0, 32));
    if (pb.length < 32) pwd.set(PAD.subarray(0, 32 - pb.length), pb.length);
    const p = new Uint8Array(4);
    new DataView(p.buffer).setInt32(0, enc.P, true);
    const parts = [pwd, enc.O.subarray(0, 32), p, enc.id0];
    if (enc.R >= 4 && !enc.encryptMetadata) parts.push(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
    let h = md5(concat(parts));
    if (enc.R >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, n));
    return h.subarray(0, enc.R === 2 ? 5 : n);
  }

  // Revision 6 (AES-256) hash, ISO 32000-2 algorithm 2.B
  async function hash2B(password, salt, udata) {
    let K = new Uint8Array(await crypto.subtle.digest('SHA-256', concat([password, salt, udata])));
    for (let round = 0; ; round++) {
      const K1parts = [];
      for (let i = 0; i < 64; i++) K1parts.push(password, K, udata);
      const K1 = concat(K1parts);
      const E = await aesEncryptNoPad(K.subarray(0, 16), K.subarray(16, 32), K1);
      let sum = 0;
      for (let i = 0; i < 16; i++) sum += E[i];
      const alg = ['SHA-256', 'SHA-384', 'SHA-512'][sum % 3];
      K = new Uint8Array(await crypto.subtle.digest(alg, E));
      if (round >= 63 && E[E.length - 1] <= round - 32) break;
    }
    return K.subarray(0, 32);
  }

  async function computeKeyR56(enc, password) {
    const pwd = (password || new Uint8Array(0)).subarray(0, 127);
    const U = enc.U, UE = enc.UE, O = enc.O, OE = enc.OE;
    async function tryOne(saltOff, keyOff, hashed, encKey, udata) {
      let inter;
      if (enc.R === 5) {
        inter = new Uint8Array(await crypto.subtle.digest('SHA-256', concat([pwd, hashed.subarray(saltOff, saltOff + 8), udata])));
      } else {
        inter = await hash2B(pwd, hashed.subarray(saltOff, saltOff + 8), udata);
      }
      let ok = true;
      for (let i = 0; i < 32; i++) if (inter[i] !== hashed[i]) { ok = false; break; }
      if (!ok) return null;
      let ikey;
      if (enc.R === 5) {
        ikey = new Uint8Array(await crypto.subtle.digest('SHA-256', concat([pwd, hashed.subarray(keyOff, keyOff + 8), udata])));
      } else {
        ikey = await hash2B(pwd, hashed.subarray(keyOff, keyOff + 8), udata);
      }
      return aesDecryptNoPad(ikey, new Uint8Array(16), encKey);
    }
    // user password
    let k = await tryOne(32, 40, U, UE, new Uint8Array(0));
    if (k) return k;
    // owner password (udata = full U, 48 bytes)
    k = await tryOne(32, 40, O, OE, U.subarray(0, 48));
    return k;
  }

  async function decryptStream(enc, key, num, gen, data) {
    if (!enc || !key) return data;
    if (enc.cfm === '/Identity') return data;
    if (enc.cfm === '/AESV3' || enc.V === 5) {
      return (await aesDecryptStream(key, data)) || data;
    }
    // per-object key
    const numB = new Uint8Array([num & 255, (num >> 8) & 255, (num >> 16) & 255]);
    const genB = new Uint8Array([gen & 255, (gen >> 8) & 255]);
    if (enc.cfm === '/AESV2') {
      const h = md5(concat([key, numB, genB, new Uint8Array([0x73, 0x41, 0x6c, 0x54])]));
      const okey = h.subarray(0, Math.min(key.length + 5, 16));
      return (await aesDecryptStream(okey, data)) || data;
    }
    const h = md5(concat([key, numB, genB]));
    return rc4(h.subarray(0, Math.min(key.length + 5, 16)), data);
  }

  function parseEncrypt(bin, objByNum) {
    // find /Encrypt N G R in a trailer or xref-stream dict
    const em = /\/Encrypt\s+(\d+)\s+(\d+)\s+R/.exec(bin);
    if (!em) return null;
    const eobj = objByNum.get(parseInt(em[1], 10));
    if (!eobj || !eobj.dict) return null;
    const d = eobj.dict;
    if (d['/Filter'] !== '/Standard') return { unsupported: 'security handler ' + d['/Filter'] };
    const enc = {
      V: resolveRef(d['/V'], objByNum) || 0,
      R: resolveRef(d['/R'], objByNum) || 2,
      P: resolveRef(d['/P'], objByNum) | 0,
      length: resolveRef(d['/Length'], objByNum) || 40,
      encryptMetadata: resolveRef(d['/EncryptMetadata'], objByNum) !== false,
      cfm: null,
    };
    for (const k of ['O', 'U', 'OE', 'UE']) {
      const v = resolveRef(d['/' + k], objByNum);
      if (v && v.str) enc[k] = v.str;
    }
    if (enc.V >= 4) {
      const cf = resolveRef(d['/CF'], objByNum);
      const stmf = d['/StmF'] || '/Identity';
      if (stmf === '/Identity') enc.cfm = '/Identity';
      else if (cf && cf[stmf]) {
        const f = resolveRef(cf[stmf], objByNum);
        enc.cfm = f['/CFM'];
        if (f['/Length']) enc.length = f['/Length'] <= 40 ? f['/Length'] * 8 : f['/Length'];
      }
    } else enc.cfm = enc.V ? '/V2' : '/V2';
    // first /ID element
    let id0 = new Uint8Array(0);
    const idm = /\/ID\s*\[\s*<([0-9a-fA-F\s]*)>/.exec(bin);
    if (idm) {
      const hex = idm[1].replace(/\s/g, '');
      id0 = new Uint8Array(hex.length >> 1);
      for (let i = 0; i < id0.length; i++) id0[i] = parseInt(hex.substr(i * 2, 2), 16);
    } else {
      const idm2 = /\/ID\s*\[\s*\(/.exec(bin);
      if (idm2) {
        const lx = new Lexer(bin, idm2.index + idm2[0].length - 1);
        const v = lx.parseLiteralString();
        if (v && v.str) id0 = v.str;
      }
    }
    enc.id0 = id0;
    return enc;
  }

  // find base64 image blobs inside text (XFA XML and similar)
  function scanBase64Images(bin, minLen) {
    minLen = minLen || 1024;
    const out = [];
    const isB64 = c => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '+' || c === '/';
    let i = 0;
    const N = bin.length;
    while (i < N) {
      if (!isB64(bin[i])) { i++; continue; }
      let j = i, count = 0;
      let cleaned = '';
      while (j < N) {
        const c = bin[j];
        if (isB64(c)) { cleaned += c; count++; j++; }
        else if (c === '\r' || c === '\n' || c === ' ' || c === '\t') j++;
        else break;
      }
      while (j < N && bin[j] === '=') { cleaned += bin[j]; j++; }
      if (count >= minLen) {
        try {
          const raw = fromBin(atob(cleaned.slice(0, cleaned.length - (cleaned.length % 4 === 1 ? 1 : 0))));
          const magic = imageMagic(raw);
          if (magic) out.push({ bytes: raw, magic });
        } catch (e) { /* not valid base64 */ }
      }
      i = j + 1;
    }
    return out;
  }

  function applyFilters(dict, data) {
    // returns {data, filters:[..]} — only FlateDecode is applied; others reported
    let filters = dict['/Filter'];
    if (!filters) return { data, filters: [] };
    if (!Array.isArray(filters)) filters = [filters];
    return { data, filters };
  }

  /**
   * rawScan(bytes, {password}) →
   *   { images: [{bytes, ext, mime, origin}], embedded: [{name?, bytes}],
   *     encrypted: bool, needsPassword: bool }
   * Finds base64 images in decoded text streams (XFA) and embedded files.
   */
  async function rawScan(bytes, opts) {
    opts = opts || {};
    const bin = toBin(bytes);
    const objs = findObjects(bin);
    const objByNum = new Map();
    for (const o of objs) if (!objByNum.has(o.num)) objByNum.set(o.num, o);
    // capture plain (non-dict) values for indirect /Length etc.
    const re2 = /(\d{1,7})\s+(\d{1,5})\s+obj\s+(\d+(?:\.\d+)?)\s+endobj/g;
    let mm;
    while ((mm = re2.exec(bin))) {
      const n = parseInt(mm[1], 10);
      if (!objByNum.has(n)) objByNum.set(n, { num: n, dict: null, inlineValue: parseFloat(mm[3]) });
    }

    const result = { images: [], embedded: [], encrypted: false, needsPassword: false, notes: [] };
    let enc = parseEncrypt(bin, objByNum);
    let key = null;
    if (enc && enc.unsupported) {
      result.notes.push('Unsupported encryption: ' + enc.unsupported);
      enc = null;
    }
    if (enc) {
      result.encrypted = true;
      const pwdBytes = opts.password ? new TextEncoder().encode(opts.password) : new Uint8Array(0);
      if (enc.R >= 5) {
        key = await computeKeyR56(enc, pwdBytes);
        if (!key) { result.needsPassword = true; return result; }
      } else {
        key = computeKeyR234(enc, pwdBytes);
        // no U-check here: bad password just produces garbage streams,
        // which the magic checks below reject. Flag it if nothing decodes.
      }
    }

    let anyDecodeOk = false;
    for (const o of objs) {
      if (o.streamStart < 0 || o.streamEnd <= o.streamStart) continue;
      const d = o.dict || {};
      const type = d['/Type'];
      if (type === '/XRef' || type === '/Metadata' || type === '/Font' || d['/Subtype'] === '/CIDFontType0C') continue;
      let raw = bytes.subarray(o.streamStart, o.streamEnd);
      if (raw.length > 64 * 1024 * 1024) continue;
      let data = raw;
      if (enc && key) data = await decryptStream(enc, key, o.num, o.gen, data);
      const { filters } = applyFilters(d, data);
      let decoded = data;
      let flateOk = true;
      if (filters.includes('/FlateDecode')) {
        try { decoded = await inflate(data); anyDecodeOk = true; }
        catch (e) { flateOk = false; }
      }
      if (!flateOk) continue;
      const isImageXObject = d['/Subtype'] === '/Image';
      const magic = imageMagic(decoded);
      if (isImageXObject) continue; // page images: the pdf.js engine handles these with correct color
      if (type === '/EmbeddedFile' || magic || isPdf(decoded)) {
        if (isPdf(decoded)) {
          result.embedded.push({ bytes: decoded });
          continue;
        }
        if (magic) {
          result.images.push({ bytes: decoded, ext: magic.ext, mime: magic.mime, origin: 'embedded-file' });
          continue;
        }
      }
      // text stream? scan for base64 images (XFA forms store them this way)
      if (decoded.length > 2048) {
        const head = toBin(decoded.subarray(0, 256));
        if (/[<\w]/.test(head)) {
          const found = scanBase64Images(toBin(decoded));
          for (const f of found) {
            result.images.push({ bytes: f.bytes, ext: f.magic.ext, mime: f.magic.mime, origin: 'xfa' });
          }
          if (found.length) anyDecodeOk = true;
        }
      }
    }
    if (enc && enc.R < 5 && result.images.length === 0 && result.embedded.length === 0 && !anyDecodeOk) {
      result.needsPassword = true;
    }
    return result;
  }

  return {
    rawScan, scanBase64Images, imageMagic, isPdf, sha256hex, concat, toBin, fromBin,
    md5, rc4, inflate, // exposed for tests
  };
});
