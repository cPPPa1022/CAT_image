// ── SillyImage Lab 设置中心 ──
export var settings = {};

export function getDefaults() {
    return {
        pluginOn: true,
        autoGen: 1,
        cUrl: 'http://localhost:8181',
        cTimeout: 180,
        cWf: '',
        cWfName: '',
        auxUrl: '',
        auxKey: '',
        auxModel: '',
        // v1.12.0 兜底策略：warn（默认·兜底只报警不擅改模型输出）| patch（旧行为·缺什么补什么原文）
        fallbackMode: 'warn',
        profileModel: '',
        userName: '',
        userDesc: '',
        profiles: {},
        msgMap: {},
        stylePreset: '',
        enhancedTheme: '默认',
        nsfwEnhance: false,
        modelType: 'zit',
        promptPrefix: '',
        uiTheme: '雪白猫',  // [Fix] 原默认 '奶糖小猫' 主题不存在，每次启动被重置为'雪白猫'（C9）
        textTheme: '默认',
        debugMode: false,
        // 多轮记忆：每次管线额外重放最近 N 轮角色消息正文（0 = 关闭，默认 5）
        historyRounds: 5,
        // [C11] 补齐「代码在用但 defaults 缺失」的键：原实现依赖 undefined 碰巧等于默认值
        storyMode: 'narrative',
        animeQualityPrefix: '',
        animeArtist: '',
        neg: '',
        workflows: {},
        // 剧情库（长期记忆）：存档开关 / 总结触发条目数 / 总结最小间隔轮数
        storyLib: true,
        summaryThreshold: 40,
        summaryGap: 15,
        // 配图偏好：always 总是配图（默认，强制+鼓励）/ encourage 鼓励配图（纯信息轮可零图） / key 关键场景
        imageMode: 'always',
        // v1.5.0 造型库：服装/发型/鞋袜/配饰/妆容 —— 按 [角色卡][聊天ID] 存
        wardrobe: {},
        // ── v2.4 占位符协作（v1.2 起画师模式已移除，只剩导演模式）──
        // 保留该键仅为兼容旧存档的 UI/日志；代码不再按它分支
        imgMode: 'main',
        // 酒馆AI模式：是否每轮向主LLM注入【生图协作卡+人物档案索引】（setExtensionPrompt）
        injectCards: true,
        // 图块是否显示完整生成提示词（默认隐藏——详细字段只走生成链，不外显；调试时可打开）
        showGenPrompt: false,
        // 图块尺寸档位：100%(大) / 75%(中) / 55%(小·默认) / 40%(迷你)
        imgBlockWidth: '55%',
        // 导演模式：是否把扫描的卡库档案作为"人物基础档案"导入人物表。
        // true=默认（人物档案规则：扫描过→用插件档案作为权威 base，酒馆AI发来的只做动态 live）；
        // false=扫描仅用于立绘/档案查看，人物表只保留酒馆AI收集的信息（更省 token，一致性弱）。
        // 档案跟着聊天走：同卡不同聊天【不继承】。开启后才会把卡级旧扫描档案导入新聊天（一般不需要）
    directorCastImport: false,
    // v1.9.0 状态库（时效性状态：晒黑/吻痕/淤青/染发…）—— 按 [角色卡][聊天ID] 存，和造型库同构
    statuses: {},
    // v1.21.0 图库：所有产出过的图都记一份账 → settings.gallery[角色卡][聊天ID][文件名] = { ts, url, kind }
    // 独立于 msgMap（v1.22 起 msgMap 住 IndexedDB、不再随设置落盘；图库是"这张图属于哪场聊天"的账本）
    gallery: {},
        // ── v1.1.2 前端卡桥（重前端卡支持）──
        // feBridge: 接管"前端卡"（酒馆助手 iframe 应用）配图。这类卡的叙事正文由卡自己调
        //   TavernHelper.generate 生成、画在自己的 UI 里，从不进聊天消息 → 插件扫描永远扫不到。
        //   打开后：从 generate 返回值截获叙事 → 走导演管线 → 图卡注入前端应用叙事区。
        feBridge: true,
        // 图卡注入位置：true=优先注入前端应用自己的叙事区（推荐）；false=只放应用内浮层
        feBridgeInline: true,
        // 前端卡走哪条管线（v1.2 起画师管线已移除）：
        //   auto（默认）—— 本轮剧情里有 [img:] → 导演管线（占位符原位出图）；没有 → 本轮跳过
        //   director    —— 强制导演，并把 [img:] 占位符指令注入卡内请求（预设里没缝小猫指令时用）
        feBridgeMode: 'auto',
    };
}

export var COLORS = {
    page: '#ffffff',
    card: '#f5f5f7',
    input: '#ebebed',
    text: '#1d1d1f',
    sub: '#6e6e73',
    mute: '#aeaeb2',
    line: '#d1d1d6',
    blue: '#0A84FF',
    orange: '#FF9F0A',
    green: '#30d158',
    red: '#ff3b30'
};

// ── 运行时依赖（从 index.js 注入） ──
var _getContext = null;
var _extensionSettings = null;

export function initSettings(getContextFn, extSettings) {
    _getContext = getContextFn;
    _extensionSettings = extSettings;
}

export function getSTContext() {
    if (!_getContext) throw new Error('settings not initialized');
    return _getContext();
}

export function getSTHeaders() {
    return getSTContext().getRequestHeaders();
}

export function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    // [Fix] div.innerHTML 不转义双引号/单引号，直接用于 data-prompt/title 等属性会被提前闭合
    // （LLM 输出的提示词常含英文引号 → 属性注入/HTML 破坏）。统一补转义。
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── 设置持久化（localStorage + extension_settings 双存） ──
export function saveSettings() {
    try {
        // v1.22：msgMap / msgMapTs **不再随设置落盘**——它们现在住 IndexedDB（modules/imgstore.js）。
        // 原因：saveSettings 写的是整份 settings，localStorage 只有几 MB，
        // 图片缓存只能被压到 50 条（还是全库共享）→ 几十轮后历史图消失。
        var _blob = settings;
        if (settings.msgMap || settings.msgMapTs) {
            _blob = Object.assign({}, settings);
            delete _blob.msgMap;
            delete _blob.msgMapTs;
        }
        localStorage.setItem('sillab_settings', JSON.stringify(_blob));
        if (_extensionSettings) {
            if (!_extensionSettings.sillab) _extensionSettings.sillab = {};
            _extensionSettings.sillab = JSON.parse(JSON.stringify(_blob));
        }
    } catch (e) { console.log('[sillab] saveSettings异常: ' + e.message); }
}

// ── 统一模式查询 ──
// 返回角色卡锁定的模式（meta.modelMode），无锁定则返回 settings.modelType（可修改值）
// 所有需要查模式的地方统一走此函数，确保逻辑一致
export function getActiveMode() {
    try {
        var ctx = getSTContext();
        var charName = ctx.characters?.[ctx.characterId]?.data?.name || '';
        if (charName && settings.profiles && settings.profiles[charName] && settings.profiles[charName].meta) {
            var locked = settings.profiles[charName].meta.modelMode;
            if (locked) return locked;
        }
    } catch (e) {}
    return settings.modelType || 'zit';
}

// ── 是否「英文提示词」模式（anime / anime_tag / anima 三种都输出英文）──
// 统一入口：以后新增英文模式只改这里，不用再去各处撒 if
export function isEnglishMode(mode) {
    var m = mode || getActiveMode();
    return m === 'anime' || m === 'anime_tag' || m === 'anima';
}
