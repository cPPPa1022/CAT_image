const fs = require('fs'), zlib = require('zlib');
const f = process.argv[2];
const buf = fs.readFileSync(f);
let off = 8;
while (off < buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.toString('ascii', off + 4, off + 8);
  if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
    const data = buf.slice(off + 8, off + 8 + len);
    const z = data.indexOf(0);
    const kw = data.toString('latin1', 0, z);
    if (kw === 'prompt') {
      let txt = '';
      try {
        if (type === 'tEXt') txt = data.toString('utf8', z + 1);
        else if (type === 'zTXt') txt = zlib.inflateSync(data.slice(z + 2)).toString('utf8');
        else { let p = z + 1; const cf = data[p]; p += 2; const l1 = data.indexOf(0, p); const l2 = data.indexOf(0, l1 + 1); txt = cf === 1 ? zlib.inflateSync(data.slice(l2 + 1)).toString('utf8') : data.slice(l2 + 1).toString('utf8'); }
      } catch (e) { break; }
      const j = JSON.parse(txt);
      for (const id in j) {
        const n = j[id];
        if (n && n.class_type && /CLIPTextEncode/.test(n.class_type) && n.inputs && n.inputs.text) console.log(n.inputs.text);
      }
      break;
    }
  }
  off += 12 + len;
  if (type === 'IEND') break;
}
