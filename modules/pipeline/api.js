// ── SillyImage Lab 辅助 API 调用 ──
import { slLog, slErr } from '../log.js';
import { settings } from '../settings.js';

// ══════════════════════════════════════════════════════════════
// ── v1.12.0 思考档位（协议依据：deepseek-harness 的 dsh-llm-deepseek 适配器）──
//   off          → thinking:{type:'disabled'}（**不发** reasoning_effort）
//   low/high/max → thinking:{type:'enabled'} + reasoning_effort:<档位>
// ⚠️ 关键：DeepSeek 服务端默认 thinking=enabled + effort=high。
//    所以「把 thinking 参数删掉」= 开到 high，**不是**关掉 —— 旧实现遇到 400 就 delete，
//    于是"降级"反而把思考打开，reasoning 吃光 max_tokens → content 为空（v1.12.0 修）。
// ══════════════════════════════════════════════════════════════
export var THINKING_LEVELS = ['off', 'low', 'high', 'max'];
var THINKING_MAXTOKENS = { off: 16384, low: 32768, high: 65536, max: 98304 };

export function currentThinkingLevel() {
    var lv = String(settings.auxThinking || 'off').toLowerCase();
    return THINKING_LEVELS.indexOf(lv) >= 0 ? lv : 'off';
}

function applyThinking(body, level) {
    if (level === 'off') {
        body.thinking = { type: 'disabled' };
        delete body.reasoning_effort;
    } else {
        body.thinking = { type: 'enabled' };
        body.reasoning_effort = level;
    }
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
    if (lastIdx > 0) t = t.slice(0, lastIdx);
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

export async function auxApiCall(systemPrompt, userMessage, maxTokens, temperature, forceModel) {
    var model = forceModel || settings.auxModel;
    if (!settings.auxUrl || !model) {
        slLog('auxApiCall: auxUrl或model未配置');
        throw new Error('辅助API未配置');
    }
    var endpoint = settings.auxUrl.replace(/\/+$/, '');
    if (!/\/chat\/completions$/.test(endpoint)) endpoint += '/chat/completions';
    var level = currentThinkingLevel();
    slLog('auxApiCall →', endpoint, 'model:', model, '| thinking:', level);

    var headers = { 'Content-Type': 'application/json' };
    if (settings.auxKey) headers['Authorization'] = 'Bearer ' + settings.auxKey;

    var messages = Array.isArray(systemPrompt) ? systemPrompt : [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }];

    // 开思考时自动抬高 max_tokens（思考也算输出 token；DS V4 Flash 单次上限 256k，放心抬）
    var mt = Math.max(Number(maxTokens) || 0, THINKING_MAXTOKENS[level] || 0) || 8192;
    var body = {
        messages: messages,
        max_tokens: mt,
        temperature: temperature != null ? temperature : 0.3,
        stream: false,
        model: model
    };
    applyThinking(body, level);

    var timeoutMs = (settings.cTimeout || 180) * 1000;
    var response = await _post(endpoint, headers, body, timeoutMs);
    slLog('auxApiCall 响应状态:', response.status, '| thinking=' + level + ' max_tokens=' + mt);

    if (!response.ok) {
        var errorText = await response.text().catch(function () { return ''; });
        // [Fix v1.12.0] 旧实现这里是 delete body.thinking —— 在 DeepSeek 上等于「打开 high 思考」。
        // 现在明确降级为「关闭思考」再重试，绝不落到服务端默认。
        if (/thinking|reasoning|parameter|invalid|unknown|max_tokens/i.test(errorText)) {
            slErr('辅助API拒绝参数, 降级为「关闭思考」重试:', errorText.slice(0, 200));
            applyThinking(body, 'off');
            body.max_tokens = Math.max(Number(maxTokens) || 0, THINKING_MAXTOKENS.off);
            response = await _post(endpoint, headers, body, timeoutMs);
            slLog('auxApiCall 降级重试响应状态:', response.status);
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
    slLog('auxApiCall 返回: finish=' + finish + ', content_len=' + content.length + ', reasoning_len=' + reasoning.length + ', thinking=' + level);

    // [Fix v1.12.0] 开了思考但正文为空 → 自动关思考重试一次。
    // 不重试的话这一轮就是 0 条提示词 → 走中文兜底 → 出烂图（历史上"偶发中文提示词"的入口）。
    if (!content && level !== 'off') {
        slErr('⚠️ 开了思考但正文为空（reasoning ' + reasoning.length + ' 字）→ 自动关思考重试一次');
        applyThinking(body, 'off');
        body.max_tokens = Math.max(Number(maxTokens) || 0, THINKING_MAXTOKENS.off);
        var res2 = await _post(endpoint, headers, body, timeoutMs);
        if (res2.ok) {
            var d2 = await res2.json();
            var c2 = (d2 && d2.choices && d2.choices[0]) || {};
            var m2 = c2.message || {};
            content = stripCoT(m2.content || '');
            slLog('auxApiCall 关思考重试: content_len=' + content.length + ', finish=' + (c2.finish_reason || ''));
        } else {
            slErr('auxApiCall 关思考重试失败:', res2.status);
        }
    }

    if (!content && finish === 'length') {
        slErr('⚠️ 输出被max_tokens截断: reasoning耗尽了token, content为空');
    }
    if (!content && !reasoning && finish === 'stop') {
        slErr('⚠️ 模型主动输出空内容 (finish=stop, 无reasoning), 响应前300字: ' + JSON.stringify(data).slice(0, 300));
    }
    return content;
}
