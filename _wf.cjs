const fs = require('fs'), zlib = require('zlib'), path = require('path');
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
        else {
          let p = z + 1; const cf = data[p]; p += 2;
          const l1 = data.indexOf(0, p); const l2 = data.indexOf(0, l1 + 1);
          txt = cf === 1 ? zlib.inflateSync(data.slice(l2 + 1)).toString('utf8') : data.slice(l2 + 1).toString('utf8');
        }
      } catch (e) { console.log('decode fail'); break; }
      const j = JSON.parse(txt);
      console.log('===== 完整工作流 =====');
      for (const id in j) {
        const n = j[id]; if (!n || !n.class_type) continue;
        const ins = n.inputs || {};
        const parts = [];
        for (const k in ins) {
          const v = ins[k];
          if (typeof v === 'string') parts.push(k + '=' + (v.length > 90 ? v.slice(0, 90) + '…' : v));
          else if (typeof v === 'number' || typeof v === 'boolean') parts.push(k + '=' + v);
          else if (Array.isArray(v)) parts.push(k + '=<-' + v[0]);
        }
        console.log('[' + id + '] ' + n.class_type + '  ' + ((n._meta && n._meta.title) || '') + '\n     ' + parts.join(' | '));
      }
      break;
    }
  }
  off += 12 + len;
  if (type === 'IEND') break;
}
