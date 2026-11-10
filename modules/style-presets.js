// ── SillyImage Lab · Krea 2 风格预设（v1.28.0）──
// 事实依据（2026-11 官方文档）：
//   Krea 2 的「风格」不是模型里的一排内置开关，官方给的是四条控制路径：
//   ① prompt 语言（媒介 / 质感 / 镜头 / 色调）② 风格参考图（最多 4 张，各自强度）
//   ③ 情绪板（taste profile / keywords / avoids）④ Krea 风格 LoRA（训练 / 公开风格）
//   —— 见 https://www.krea.ai/docs/user-guide/features/krea-2
//
// 所以这里收录的不是"官方内置风格 ID"，而是**官方示例与文档覆盖到的风格大类**，
// 每条给一句**纯风格英文**（不含主体、不含具体光源/地点），由插件统一前置到每张提示词最前面。
//
// 为什么要落到代码：辅助模型每轮独立调用、无记忆，提示词里写"跨轮同词"它做不到；
// 只有插件统一前置的这一句能保证同一场聊天里媒介/质感不漂。

export var KREA2_STYLES = [
    {
        id: '',
        group: '通用',
        label: '自动（不锁风格）',
        note: '由提示词与工作流决定（媒介可能在多张之间漂）',
        prompt: '',
    },
    {
        id: 'cinematic',
        group: '摄影',
        label: '🎞 电影感摄影',
        note: 'cinematic photograph · 35mm 镜头感 · 浅景深 · 细颗粒',
        prompt: 'cinematic photograph, 35mm lens look, shallow depth of field, fine film grain, natural skin texture',
    },
    {
        id: 'film35',
        group: '摄影',
        label: '📷 35mm 胶片',
        note: '35mm film photograph · 可见颗粒 · 柔和高光溢出 · 模拟色调',
        prompt: '35mm film photograph, visible grain, soft halation, muted analog color',
    },
    {
        id: 'editorial',
        group: '摄影',
        label: '💄 时尚杂志',
        note: 'high-fashion editorial photograph · 清晰细节 · 杂志质感',
        prompt: 'high-fashion editorial photograph, crisp detail, magazine-quality finish',
    },
    {
        id: 'macro',
        group: '摄影',
        label: '🔬 微距特写',
        note: 'macro photograph · 极浅景深 · 表面细节',
        prompt: 'macro photograph, extremely shallow depth of field, precise surface detail',
    },
    {
        id: 'anime',
        group: '二次元',
        label: '🎬 动漫插画',
        note: 'anime illustration · 干净线稿 · 赛璐璐上色 · 柔和渐变',
        prompt: 'anime illustration, clean linework, cel shading, soft gradients, detailed eyes',
    },
    {
        id: 'cel90s',
        group: '二次元',
        label: '📺 90s 赛璐璐动画',
        note: '1990s cel animation still · 平涂 · 可见线条 · 复古低饱和',
        prompt: '1990s cel animation still, flat shading, visible linework, muted retro palette, film grain',
    },
    {
        id: 'digital',
        group: '绘画',
        label: '🖌 数字绘画',
        note: 'digital painting · 表现性笔触 · 饱满色彩 · 绘画质感',
        prompt: 'digital painting, expressive brushstrokes, rich color, painterly texture',
    },
    {
        id: 'oil',
        group: '绘画',
        label: '🎨 厚涂油画',
        note: 'oil painting · 厚笔触 · 画布纹理 · 深色',
        prompt: 'oil painting, thick impasto brushstrokes, canvas texture, deep color',
    },
    {
        id: 'ink',
        group: '绘画',
        label: '🖋 黑白墨线',
        note: 'black-and-white ink illustration · 交叉排线 · 高反差 · 纸纹',
        prompt: 'black-and-white ink illustration, fine cross-hatching, high contrast, paper texture',
    },
    {
        id: 'flat',
        group: '平面',
        label: '🔷 扁平矢量',
        note: 'flat-color vector illustration · 几何形状 · 极少阴影 · 色块',
        prompt: 'flat-color vector illustration, clean geometric shapes, minimal shading, bold color blocks',
    },
    {
        id: 'collage',
        group: '平面',
        label: '✂️ 复古拼贴',
        note: 'vintage analog collage · 剪纸形状 · 纸纹 · 中世纪印刷感',
        prompt: 'vintage analog collage, cut-out shapes, grainy paper texture, mid-century print aesthetic',
    },
    {
        id: 'render3d',
        group: '3D / 实验',
        label: '🧸 3D 渲染',
        note: '3D render · 哑光乙烯基质感 · 柔和阴影 · 高细节',
        prompt: '3D render, smooth vinyl texture, soft shadows, high detail',
    },
    {
        id: 'airbrush',
        group: '3D / 实验',
        label: '🌈 80s 喷枪',
        note: '1980s airbrush illustration · 平滑渐变 · 铬高光 · 霓虹 · 复古未来',
        prompt: '1980s airbrush illustration, smooth gradients, chrome highlights, neon accents, retro-futuristic',
    },
];

// id → 预设（找不到返回 null，'' = 自动）
export function krea2StyleById(id) {
    var key = String(id == null ? '' : id);
    for (var i = 0; i < KREA2_STYLES.length; i++) {
        if (KREA2_STYLES[i].id === key) return KREA2_STYLES[i];
    }
    return null;
}

// 当前生效的风格句（自动 / 未知 id → 空串）
export function krea2StylePrompt(id) {
    var s = krea2StyleById(id);
    return (s && s.prompt) ? s.prompt : '';
}
