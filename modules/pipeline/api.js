// ── SillyImage Lab 辅助 API 调用 ──
import { slLog, slErr } from '../log.js';
import { settings } from '../settings.js';

// ══════════════════════════════════════════════════════════════
// ── v1.13.5 思考强度选项已删除：辅助 AI 一律「关闭思考」 ──
//   实测（同一套破限 + 明确成人内容，每档 n=10）：
//     off → 拒绝 0/10 ｜ low → 拒绝 4/10 ｜ high → 拒绝 9/10
//   档位越高越容易被拒，画面质量却没有肉眼可见的提升 —— 性价比为负，直接砍掉选项。
// ⚠️ 协议：DeepSeek 服务端默认 thinking=enabled + effort=high，
//    所以「把 thinking 参数删掉」= 开到 high，**不是**关掉 —— 必须显式 disabled。
// ══════════════════════════════════════════════════════════════
var OUT_MAXTOKENS = 16384;

// ── v1.27.0 思考预算配对（恢复 v1.12.0 的表，v1.13.5 删档位时被一起删掉了）──
// reasoning 与 content **共享** max_tokens：开着思考却用 16k，就是"提前截断"和"晚点截断"两种结局。
// 这张表是开思考的硬前提；档位与预算必须同源，不能一处改一处不改。
var THINKING_BUDGET = { off: 16384, low: 32768, high: 65536, max: 98304 };

/**
 * 按思考档位设置 thinking / reasoning_effort，并把 max_tokens 抬到该档预算下限。
 * @param {object} body 请求体（原地改）
 * @param {string} level off | low | high | max（缺省 = off）
 */
function applyThinking(body, level) {
    var lv = String(level || 'off');
    if (lv !== 'low' && lv !== 'high' && lv !== 'max') lv = 'off';
    if (lv === 'off') {
        body.thinking = { type: 'disabled' };
        delete body.reasoning_effort;
    } else {
        body.thinking = { type: 'enabled' };
        body.reasoning_effort = lv;
    }
    var floor = THINKING_BUDGET[lv] || OUT_MAXTOKENS;
    body.max_tokens = Math.max(Number(body.max_tokens) || 0, floor);
    return body;
}

// ── CoT（思维链）剥离 ──
// DeepSeek 把思考放在独立的 reasoning_content 字段（正常不会混进 content）；
// 但有些网关会把思考合并进正文，或模型自己带 <thinking> 标记 → 统一剥掉，
// 别让思考污染 ---PROFILE--- / ---IMAGES--- 的解析。
export function stripCoT(text) {
    var t = String(text || '');
    if (!t) return t;
    t = t.replace(/<(thought|thinking|reasoning)>[\s\S]*?<\/\1\s*>/gi, '');
    t = t.replace(/<(thought|thinking|reasoning)\s*\/>/gi, '');
    t = t.replace(/(^|\n)[ \t]*(思考过程|推理过程|分析过程|Thought process)[ \t]*[：:][\s\S]*?(?=\n[ \t]*---|\n\n|$)/gi, '\n');
    var p = t.search(/---\s*PROFILE\s*---/);
    if (p > 0) t = t.slice(p);
    var reEnd = /---\s*END\s*---/g, mm, lastIdx = -1;
    while ((mm = reEnd.exec(t)) !== null) lastIdx = mm.index + mm[0].length;
    if (lastIdx > 0) {
        // v1.27.3：多段输出时，最后一个 ---END--- 之后**可能还有尾段**。
        // 实测：3 份「PROFILE/IMAGES/END」时，最后那份的 ---CHECK--- 不带 END，
        // 旧实现把它当思考残留砍掉（1788 字 → 1730 字，正好一段 CHECK）。
        // 判据：残余里还有段标记就不截，只有纯废话才砍。
        var tail = t.slice(lastIdx);
        if (!/---\s*(?:PROFILE|IMAGES|CHECK|WARDROBE|STATUSES)\s*---/.test(tail)) {
            t = t.slice(0, lastIdx);
        }
    }
    return t.trim();
}

async function _post(endpoint, headers, body, timeoutMs) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs);
    try {
        return await fetch(endpoint, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
        throw new Error(e && e.name === 'AbortError' ? '辅助API请求超时(' + timeoutMs + 'ms)' : (e ? e.message : 'fetch失败'));
    } finally { clearTimeout(timer); }
}

/**
 * 辅助 API 调用（原始版）：返回 { content, finish, reasoningLen, truncated }。
 * v1.27.0：**finish_reason 必须回传**——旧实现只把它打进日志就 return content，
 * 导致下游无法区分「模型拒绝」和「被 max_tokens 截断」，截断只能被压缩成 empty/short，
 * 重试策略只能靠猜（截断被当成空回 → 整轮重发 → 思考白烧一遍）。
 *
 * @param {string|Array} systemPrompt 字符串（system 单条）或多条消息数组
 * @param {string|null} userMessage    systemPrompt 是数组时传 null
 * @param {number} maxTokens           与思考档位配对，见 THINKING_BUDGET
 * @param {number} temperature
 * @param {string} forceModel
 * @param {string} thinkingLevel       off | low | high | max（缺省 off）
 */
export async function auxApiCallRaw(systemPrompt, userMessage, maxTokens, temperature, forceModel, thinkingLevel) {
    var model = forceModel || settings.auxModel;
    if (!settings.auxUrl || !model) {
        slLog('auxApiCall: auxUrl或model未配置');
        throw new Error('辅助API未配置');
    }
    var endpoint = settings.auxUrl.replace(/\/+$/, '');
    if (!/\/chat\/completions$/.test(endpoint)) endpoint += '/chat/completions';
    slLog('auxApiCall →', endpoint, 'model:', model);

    var headers = { 'Content-Type': 'application/json' };
    if (settings.auxKey) headers['Authorization'] = 'Bearer ' + settings.auxKey;

    var messages = Array.isArray(systemPrompt) ? systemPrompt : [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }];

    var mt = Math.max(Number(maxTokens) || 0, OUT_MAXTOKENS);
    var body = {
        messages: messages,
        max_tokens: mt,
        temperature: temperature != null ? temperature : 0.3,
        stream: false,
        model: model
    };
    applyThinking(body, thinkingLevel);

    var timeoutMs = (settings.cTimeout || 180) * 1000;
    var response = await _post(endpoint, headers, body, timeoutMs);
    slLog('auxApiCall 响应状态:', response.status, '| max_tokens=' + mt + ' | thinking=' + (thinkingLevel || 'off'));

    if (!response.ok) {
        var errorText = await response.text().catch(function () { return ''; });
        // 网关不认 thinking 字段时的兜底：去掉该字段重试一次。
        // ⚠️ 只有「不接受 thinking 参数的网关」会走到这里；对 DeepSeek 官方来说去掉参数 = 开到 high，
        //    所以日志里必须标出来，不能让这件事悄悄发生。
        if (/thinking|reasoning|parameter|invalid|unknown/i.test(errorText)) {
            slErr('辅助API拒绝参数, 去掉 thinking 字段重试（⚠️ 对端若按服务端默认，等于开到 high）:', errorText.slice(0, 200));
            delete body.thinking;
            delete body.reasoning_effort;
            // v1.27.0：删掉 thinking 字段 = 对端按服务端默认（DeepSeek 官方是 enabled + high）
            // → reasoning 会开始吃 token。这里必须同步把预算抬到 high 档，否则必然截断。
            body.max_tokens = Math.max(Number(body.max_tokens) || 0, THINKING_BUDGET.high);
            response = await _post(endpoint, headers, body, timeoutMs);
            slLog('auxApiCall 降级重试响应状态:', response.status, '| max_tokens 已按 high 档抬到 ' + body.max_tokens);
            if (!response.ok) {
                var errorText2 = await response.text().catch(function () { return ''; });
                slErr('auxApiCall失败(降级后):', response.status, errorText2.slice(0, 500));
                throw new Error('HTTP ' + response.status + ': ' + errorText2.slice(0, 300));
            }
        } else {
            slErr('auxApiCall失败:', response.status, errorText.slice(0, 500));
            throw new Error('HTTP ' + response.status + ': ' + errorText.slice(0, 300));
        }
    }

    var data = await response.json();
    var choice = data && data.choices && data.choices[0];
    var msg = (choice && choice.message) || {};
    var reasoning = (msg.reasoning_content || msg.reasoning || '');
    var finish = (choice && choice.finish_reason) || '';
    var content = stripCoT(msg.content || '');
    slLog('auxApiCall 返回: finish=' + finish + ', content_len=' + content.length + ', reasoning_len=' + reasoning.length);

    if (!content && finish === 'length') {
        slErr('⚠️ 输出被max_tokens截断: content为空（reasoning 吃了 ' + reasoning.length + ' 字）');
    }
    if (!content && !reasoning && finish === 'stop') {
        slErr('⚠️ 模型主动输出空内容 (finish=stop, 无reasoning), 响应前300字: ' + JSON.stringify(data).slice(0, 300));
    }
    return {
        content: content,
        finish: finish,
        reasoningLen: reasoning.length,
        // 截断的**权威判据**：finish_reason=length。下游靠它把「截断」和「拒绝/空回」分开。
        truncated: finish === 'length',
    };
}

/**
 * 兼容包装：老签名、老返回值（string content）。
 * 现存调用点（story.js / profile.js / 管线首调）零改动；需要 finish 的地方改用 auxApiCallRaw。
 */
export async function auxApiCall(systemPrompt, userMessage, maxTokens, temperature, forceModel) {
    var r = await auxApiCallRaw(systemPrompt, userMessage, maxTokens, temperature, forceModel);
    return r.content;
}
