// ── SillyImage Lab v3.1 状态猫（Kawaii 贴纸猫：实心填充 + 腮红 + 大眼高光 + 胡须 + W嘴） ──
// 状态：idle（打盹zzz）/ queuing（弯眼开心）/ busy（专注+爪影）/ error（X_X）/ healthy（眨眼）
// 配色跟随主题：脸=卡片色，描边/胡须=容器 color（通常 accent），腮红/耳内=粉色

function eyePair(state) {
  if (state === 'error') {
    return '<path d="M21 32 L28 39 M28 32 L21 39" stroke="#3a3a3e" stroke-width="2.8" stroke-linecap="round" fill="none"/>'
         + '<path d="M36 32 L43 39 M43 32 L36 39" stroke="#3a3a3e" stroke-width="2.8" stroke-linecap="round" fill="none"/>';
  }
  if (state === 'queuing') {
    return '<path d="M20.5 36 q4.5 -5 9 0" stroke="#3a3a3e" stroke-width="2.6" stroke-linecap="round" fill="none"/>'
         + '<path d="M35.5 36 q4.5 -5 9 0" stroke="#3a3a3e" stroke-width="2.6" stroke-linecap="round" fill="none"/>';
  }
  // healthy / idle / busy：大圆眼+高光
  var g = '<g class="sl-cat-eyes">';
  g += '<circle cx="25" cy="35.5" r="4.6" fill="#3a3a3e"/>';
  g += '<circle cx="26.4" cy="33.8" r="1.5" fill="#fff"/>';
  g += '<circle cx="39" cy="35.5" r="4.6" fill="#3a3a3e"/>';
  g += '<circle cx="40.4" cy="33.8" r="1.5" fill="#fff"/>';
  g += '</g>';
  return g;
}

export function catSVG(state, size, opts) {
  var s = size || 48;
  var st = state || 'idle';
  var o = opts || {};
  var cls = 'sl-cat-anim sl-cat-' + st;
  var svg = '<svg class="' + cls + '" width="' + s + '" height="' + s + '" viewBox="0 0 64 64">';
  // 底色背景圆（贴纸感）
  svg += '<circle cx="32" cy="33" r="29" fill="var(--sl-card,#fff)" stroke="currentColor" stroke-width="2.5"/>';
  // 耳朵（外向大三角圆角，耳内粉）
  svg += '<path d="M13 17 L10 4.5 Q9.6 1.6 12.2 2.6 L20 6.2" fill="var(--sl-card,#fff)" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>';
  svg += '<path d="M13.5 8.5 A23 23 0 0 1 15.5 13.5" fill="none" stroke="none"/>';
  svg += '<path d="M51 17 L54 4.5 Q54.4 1.6 51.8 2.6 L44 6.2" fill="var(--sl-card,#fff)" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>';
  // 耳内粉色
  svg += '<path d="M12.6 6.8 L15 13.2 L17.4 8.9 Z" fill="#ffb3c0" opacity="0.9"/>';
  svg += '<path d="M51.4 6.8 L49 13.2 L46.6 8.9 Z" fill="#ffb3c0" opacity="0.9"/>';
  // 耳朵毛簇（可爱）
  svg += '<path d="M30 6 q1 -3.4 3 -4.2 q-0.4 2.6 1 3.8" fill="currentColor" opacity="0.9"/>';
  // 眼睛
  svg += eyePair(st);
  // 腮红
  svg += '<ellipse cx="16.5" cy="42" rx="4.6" ry="2.8" fill="#ffb3c0" opacity="0.75"/>';
  svg += '<ellipse cx="47.5" cy="42" rx="4.6" ry="2.8" fill="#ffb3c0" opacity="0.75"/>';
  // 鼻子（粉色小三角）
  svg += '<path d="M29.8 43.5 L34.2 43.5 L32 46.2 Z" fill="#ff9b9b"/>';
  // 嘴（W 形）
  svg += '<path d="M32 46.2 V47.5 M32 47.5 C30 47.5 28.6 46.4 28.6 45 M32 47.5 C34 47.5 35.4 46.4 35.4 45" stroke="#3a3a3e" stroke-width="1.9" stroke-linecap="round" fill="none"/>';
  // 胡须
  svg += '<path d="M6.5 38 H15.5 M7 43.5 H14.5 M57.5 38 H48.5 M57 43.5 H49.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.8"/>';
  // 状态装饰
  if (st === 'idle' || st === 'sleeping') {
    svg += '<path d="M20.5 53 q0 -0.2 0.2 -0.4" stroke="#a8d8b9" stroke-width="3" stroke-linecap="round" fill="none"/>'; // 呼吸肚皮省
    svg += '<g class="sl-cat-zzz" fill="currentColor" opacity="0.85"><text x="49" y="15" font-size="11" font-weight="800">z</text><text x="55" y="9" font-size="8" font-weight="800">z</text></g>';
  } else if (st === 'busy') {
    svg += '<g class="sl-cat-paw" fill="currentColor" opacity="0.9"><ellipse cx="12" cy="54" rx="4" ry="2.6"/>';
    svg += '<ellipse cx="52" cy="54" rx="4" ry="2.6"/></g>';
    svg += '<path d="M44 8.5 L59 15.5" stroke="#ffd166" stroke-width="3.5" stroke-linecap="round"/>';
    svg += '<circle cx="58" cy="8" r="2.2" fill="#ffd166"/>';
  } else if (st === 'queuing') {
    svg += '<path d="M18.5 51.5 h7" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.5"/>';
    svg += '<path d="M38.5 51.5 h7" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.5"/>';
  }
  svg += '</svg>';
  return svg;
}

export function catStatusText(state) {
  return { idle: '懒洋洋地趴着', queuing: '尾巴摇摇等叫号', busy: '爪子在画图', error: '机器坏掉了…', healthy: '随时待命' }[state] || '随时待命';
}
export function catFace(state) {
  return { idle: '=^_^=', queuing: '^_^', busy: '*o*', error: '>_<', healthy: '=^_^=' }[state] || '=^_^=';
}