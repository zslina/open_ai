// ==UserScript==
// @name         🌐 网页全面汉化助手 (Chinese Translator Pro)
// @name:zh-CN   🌐 网页全面汉化助手
// @namespace    https://github.com/chinese-translator-pro
// @version      2.0.0
// @description  一键将任意英文网页翻译为简体中文，调用 MyMemory 免费 API，无需 API Key，支持动态内容检测
// @description:zh-CN 一键将任意英文网页翻译为简体中文，调用 MyMemory 免费 API，无需 API Key，支持动态内容检测
// @author       Chinese Translator Pro
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      api.mymemory.translated.net
// @connect      translate.googleapis.com
// @run-at       document-idle
// @license      MIT
// @homepage     https://github.com/chinese-translator-pro
// ==/UserScript==

(function () {
    'use strict';

    // ========== 配置项 ==========
    const CONFIG = {
        // 翻译 API 选择: 'mymemory' | 'google_free'
        API: 'mymemory',

        // 每批翻译的节点数量 (避免请求过大)
        BATCH_SIZE: 8,

        // 请求间隔 (毫秒)，避免被限流
        REQUEST_DELAY: 300,

        // 最短翻译字符数 (太短的词不翻译)
        MIN_CHAR_LENGTH: 2,

        // 最长单次翻译字符数
        MAX_CHAR_LENGTH: 500,

        // 是否翻译 placeholder、alt、title 等属性
        TRANSLATE_ATTRIBUTES: true,

        // 是否启用动态内容监听 (MutationObserver)
        ENABLE_MUTATION_OBSERVER: true,

        // 跳过翻译的标签
        SKIP_TAGS: new Set([
            'SCRIPT', 'STYLE', 'CODE', 'PRE', 'KBD', 'VAR', 'SAMP',
            'MATH', 'SVG', 'NOSCRIPT', 'IFRAME', 'TEMPLATE', 'TEXTAREA'
        ]),

        // 跳过翻译的 class 关键词
        SKIP_CLASS_KEYWORDS: ['code', 'highlight', 'prism', 'hljs', 'language-', 'math', 'formula'],
    };

    // ========== 状态管理 ==========
    const STATE = {
        isTranslating: false,
        isTranslated: false,
        translatedNodes: new Map(),   // node -> originalText
        nodeQueue: [],
        observer: null,
        totalNodes: 0,
        doneNodes: 0,
        errors: 0,
    };

    // ========== UI 注入 ==========
    GM_addStyle(`
        #ctp-panel {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 2147483647;
            font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
            user-select: none;
        }

        #ctp-btn {
            width: 52px;
            height: 52px;
            border-radius: 50%;
            background: linear-gradient(135deg, #1a73e8 0%, #0d47a1 100%);
            color: white;
            border: none;
            cursor: pointer;
            box-shadow: 0 4px 16px rgba(26,115,232,0.45), 0 2px 6px rgba(0,0,0,0.2);
            font-size: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            outline: none;
        }

        #ctp-btn:hover {
            transform: scale(1.08);
            box-shadow: 0 6px 20px rgba(26,115,232,0.55), 0 3px 8px rgba(0,0,0,0.25);
        }

        #ctp-btn:active {
            transform: scale(0.96);
        }

        #ctp-btn.translating {
            background: linear-gradient(135deg, #f57c00 0%, #e65100 100%);
            box-shadow: 0 4px 16px rgba(245,124,0,0.45);
            animation: ctp-pulse 1.2s ease-in-out infinite;
        }

        #ctp-btn.translated {
            background: linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%);
            box-shadow: 0 4px 16px rgba(46,125,50,0.45);
        }

        @keyframes ctp-pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.06); }
        }

        #ctp-tooltip {
            position: absolute;
            bottom: 62px;
            right: 0;
            background: rgba(15,15,15,0.92);
            color: #fff;
            font-size: 12px;
            padding: 6px 12px;
            border-radius: 8px;
            white-space: nowrap;
            pointer-events: none;
            opacity: 0;
            transform: translateY(6px);
            transition: opacity 0.2s ease, transform 0.2s ease;
            backdrop-filter: blur(4px);
            letter-spacing: 0.02em;
        }

        #ctp-panel:hover #ctp-tooltip {
            opacity: 1;
            transform: translateY(0);
        }

        #ctp-progress {
            position: absolute;
            bottom: 62px;
            right: 0;
            background: rgba(15,15,15,0.92);
            color: #fff;
            font-size: 12px;
            padding: 10px 14px;
            border-radius: 10px;
            white-space: nowrap;
            min-width: 180px;
            backdrop-filter: blur(4px);
            display: none;
            line-height: 1.6;
        }

        #ctp-progress-bar-wrap {
            background: rgba(255,255,255,0.2);
            border-radius: 4px;
            height: 4px;
            margin-top: 8px;
            overflow: hidden;
        }

        #ctp-progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #42a5f5, #66bb6a);
            border-radius: 4px;
            width: 0%;
            transition: width 0.3s ease;
        }

        #ctp-settings-btn {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: rgba(255,255,255,0.15);
            border: 1px solid rgba(255,255,255,0.3);
            color: white;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            justify-content: center;
            position: absolute;
            top: -6px;
            left: -6px;
            transition: background 0.2s;
        }

        #ctp-settings-btn:hover {
            background: rgba(255,255,255,0.25);
        }

        #ctp-settings-panel {
            position: absolute;
            bottom: 62px;
            right: 0;
            background: #fff;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.18);
            padding: 16px;
            min-width: 240px;
            display: none;
            font-size: 13px;
            color: #333;
        }

        #ctp-settings-panel h3 {
            margin: 0 0 12px;
            font-size: 14px;
            font-weight: 600;
            color: #1a73e8;
        }

        #ctp-settings-panel label {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            cursor: pointer;
        }

        #ctp-settings-panel select {
            width: 100%;
            margin-top: 8px;
            padding: 6px 8px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 12px;
        }
    `);

    function buildUI() {
        const panel = document.createElement('div');
        panel.id = 'ctp-panel';

        panel.innerHTML = `
            <div id="ctp-progress">
                <div id="ctp-progress-text">准备翻译...</div>
                <div id="ctp-progress-bar-wrap"><div id="ctp-progress-bar"></div></div>
            </div>
            <div id="ctp-settings-panel">
                <h3>⚙️ 翻译设置</h3>
                <label>翻译引擎：</label>
                <select id="ctp-api-select">
                    <option value="mymemory">MyMemory (推荐，免费)</option>
                    <option value="google_free">Google 翻译 (备用)</option>
                </select>
                <label style="margin-top:10px">
                    <input type="checkbox" id="ctp-attr-check" checked> 翻译属性 (placeholder/alt/title)
                </label>
                <label>
                    <input type="checkbox" id="ctp-observe-check" checked> 监听动态内容
                </label>
            </div>
            <div style="position:relative; width:52px; height:52px;">
                <button id="ctp-btn" title="网页全面汉化">中</button>
                <button id="ctp-settings-btn" title="设置">⚙</button>
            </div>
            <div id="ctp-tooltip">点击开始翻译</div>
        `;

        document.body.appendChild(panel);
        bindEvents();
    }

    function bindEvents() {
        const btn = document.getElementById('ctp-btn');
        const settingsBtn = document.getElementById('ctp-settings-btn');
        const settingsPanel = document.getElementById('ctp-settings-panel');
        const apiSelect = document.getElementById('ctp-api-select');
        const attrCheck = document.getElementById('ctp-attr-check');
        const observeCheck = document.getElementById('ctp-observe-check');

        // 读取保存的设置
        apiSelect.value = GM_getValue('ctp_api', 'mymemory');
        attrCheck.checked = GM_getValue('ctp_attr', true);
        observeCheck.checked = GM_getValue('ctp_observe', true);
        CONFIG.API = apiSelect.value;
        CONFIG.TRANSLATE_ATTRIBUTES = attrCheck.checked;
        CONFIG.ENABLE_MUTATION_OBSERVER = observeCheck.checked;

        btn.addEventListener('click', () => {
            if (STATE.isTranslating) return;
            if (STATE.isTranslated) {
                restoreOriginal();
            } else {
                startTranslation();
            }
        });

        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = settingsPanel.style.display === 'block';
            settingsPanel.style.display = isVisible ? 'none' : 'block';
        });

        document.addEventListener('click', () => {
            settingsPanel.style.display = 'none';
        });

        apiSelect.addEventListener('change', () => {
            CONFIG.API = apiSelect.value;
            GM_setValue('ctp_api', apiSelect.value);
        });

        attrCheck.addEventListener('change', () => {
            CONFIG.TRANSLATE_ATTRIBUTES = attrCheck.checked;
            GM_setValue('ctp_attr', attrCheck.checked);
        });

        observeCheck.addEventListener('change', () => {
            CONFIG.ENABLE_MUTATION_OBSERVER = observeCheck.checked;
            GM_setValue('ctp_observe', observeCheck.checked);
        });
    }

    // ========== 节点采集 ==========
    function shouldSkipElement(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
        if (CONFIG.SKIP_TAGS.has(el.tagName)) return true;
        const cls = (el.className || '').toString().toLowerCase();
        return CONFIG.SKIP_CLASS_KEYWORDS.some(k => cls.includes(k));
    }

    function isMainlyEnglish(text) {
        const clean = text.trim();
        if (!clean || clean.length < CONFIG.MIN_CHAR_LENGTH) return false;
        // 如果包含超过30%的中文字符，跳过
        const chineseChars = (clean.match(/[\u4e00-\u9fff]/g) || []).length;
        if (chineseChars / clean.length > 0.3) return false;
        // 必须含有英文字母
        const englishChars = (clean.match(/[a-zA-Z]/g) || []).length;
        return englishChars >= 2;
    }

    function collectTextNodes(root) {
        const nodes = [];
        const walker = document.createTreeWalker(
            root || document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    if (shouldSkipElement(parent)) return NodeFilter.FILTER_REJECT;
                    // 检查祖先
                    let el = parent;
                    while (el && el !== document.body) {
                        if (shouldSkipElement(el)) return NodeFilter.FILTER_REJECT;
                        el = el.parentElement;
                    }
                    const text = node.textContent.trim();
                    if (!isMainlyEnglish(text)) return NodeFilter.FILTER_SKIP;
                    if (text.length > CONFIG.MAX_CHAR_LENGTH) return NodeFilter.FILTER_SKIP;
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );
        let node;
        while ((node = walker.nextNode())) {
            nodes.push(node);
        }
        return nodes;
    }

    function collectAttributeNodes(root) {
        if (!CONFIG.TRANSLATE_ATTRIBUTES) return [];
        const attrNodes = [];
        const attrs = ['placeholder', 'title', 'alt', 'aria-label', 'data-tooltip'];
        const els = (root || document.body).querySelectorAll(attrs.map(a => `[${a}]`).join(','));
        els.forEach(el => {
            if (shouldSkipElement(el)) return;
            attrs.forEach(attr => {
                const val = el.getAttribute(attr);
                if (val && isMainlyEnglish(val) && val.length <= CONFIG.MAX_CHAR_LENGTH) {
                    attrNodes.push({ el, attr, original: val });
                }
            });
        });
        return attrNodes;
    }

    // ========== 翻译 API ==========
    function translateMyMemory(text) {
        return new Promise((resolve, reject) => {
            const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN&de=translator@example.com`;
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                timeout: 8000,
                onload(res) {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.responseStatus === 200) {
                            resolve(data.responseData.translatedText);
                        } else {
                            reject(new Error(data.responseDetails || 'API error'));
                        }
                    } catch (e) {
                        reject(e);
                    }
                },
                onerror: reject,
                ontimeout: () => reject(new Error('Timeout')),
            });
        });
    }

    function translateGoogleFree(text) {
        return new Promise((resolve, reject) => {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                timeout: 8000,
                onload(res) {
                    try {
                        const data = JSON.parse(res.responseText);
                        let translated = '';
                        if (Array.isArray(data[0])) {
                            data[0].forEach(part => {
                                if (part && part[0]) translated += part[0];
                            });
                        }
                        resolve(translated || text);
                    } catch (e) {
                        reject(e);
                    }
                },
                onerror: reject,
                ontimeout: () => reject(new Error('Timeout')),
            });
        });
    }

    function translate(text) {
        if (CONFIG.API === 'google_free') return translateGoogleFree(text);
        return translateMyMemory(text);
    }

    // ========== 批量翻译队列 ==========
    async function processBatch(textNodes, attrNodes) {
        STATE.totalNodes = textNodes.length + attrNodes.length;
        STATE.doneNodes = 0;
        STATE.errors = 0;

        updateProgress(0, `共 ${STATE.totalNodes} 个节点`);

        // 文本节点翻译
        for (let i = 0; i < textNodes.length; i += CONFIG.BATCH_SIZE) {
            if (!STATE.isTranslating) break;
            const batch = textNodes.slice(i, i + CONFIG.BATCH_SIZE);
            await Promise.allSettled(batch.map(async (node) => {
                const original = node.textContent;
                try {
                    const translated = await translate(original.trim());
                    if (translated && translated !== original.trim()) {
                        STATE.translatedNodes.set(node, original);
                        // 保留首尾空白
                        const leading = original.match(/^\s*/)[0];
                        const trailing = original.match(/\s*$/)[0];
                        node.textContent = leading + translated + trailing;
                    }
                } catch {
                    STATE.errors++;
                }
                STATE.doneNodes++;
                updateProgress(STATE.doneNodes / STATE.totalNodes * 100);
            }));
            await sleep(CONFIG.REQUEST_DELAY);
        }

        // 属性节点翻译
        for (let i = 0; i < attrNodes.length; i += CONFIG.BATCH_SIZE) {
            if (!STATE.isTranslating) break;
            const batch = attrNodes.slice(i, i + CONFIG.BATCH_SIZE);
            await Promise.allSettled(batch.map(async (item) => {
                try {
                    const translated = await translate(item.original);
                    if (translated && translated !== item.original) {
                        STATE.translatedNodes.set(item, item.original);
                        item.el.setAttribute(item.attr, translated);
                    }
                } catch {
                    STATE.errors++;
                }
                STATE.doneNodes++;
                updateProgress(STATE.doneNodes / STATE.totalNodes * 100);
            }));
            await sleep(CONFIG.REQUEST_DELAY);
        }
    }

    // ========== 启动翻译 ==========
    async function startTranslation() {
        STATE.isTranslating = true;
        STATE.isTranslated = false;
        STATE.translatedNodes.clear();

        const btn = document.getElementById('ctp-btn');
        const tooltip = document.getElementById('ctp-tooltip');
        const progress = document.getElementById('ctp-progress');

        btn.classList.add('translating');
        btn.textContent = '⏳';
        tooltip.textContent = '翻译中...';
        progress.style.display = 'block';

        const textNodes = collectTextNodes();
        const attrNodes = collectAttributeNodes();

        if (textNodes.length + attrNodes.length === 0) {
            showToast('未检测到需要翻译的英文内容');
            resetBtn();
            return;
        }

        try {
            await processBatch(textNodes, attrNodes);
        } catch (e) {
            console.error('[CTP] Translation error:', e);
        }

        STATE.isTranslating = false;
        STATE.isTranslated = true;
        btn.classList.remove('translating');
        btn.classList.add('translated');
        btn.textContent = '✓';
        tooltip.textContent = `翻译完成 (${STATE.translatedNodes.size} 处) • 点击还原`;
        progress.style.display = 'none';

        if (CONFIG.ENABLE_MUTATION_OBSERVER) {
            startObserver();
        }
    }

    // ========== 还原原文 ==========
    function restoreOriginal() {
        stopObserver();
        STATE.translatedNodes.forEach((original, nodeOrItem) => {
            try {
                if (nodeOrItem instanceof Text) {
                    nodeOrItem.textContent = original;
                } else if (nodeOrItem.el && nodeOrItem.attr) {
                    nodeOrItem.el.setAttribute(nodeOrItem.attr, original);
                }
            } catch { }
        });
        STATE.translatedNodes.clear();
        STATE.isTranslated = false;
        resetBtn();
        showToast('已还原为原文');
    }

    function resetBtn() {
        const btn = document.getElementById('ctp-btn');
        const tooltip = document.getElementById('ctp-tooltip');
        if (!btn) return;
        btn.classList.remove('translating', 'translated');
        btn.textContent = '中';
        tooltip.textContent = '点击开始翻译';
    }

    // ========== MutationObserver 监听动态内容 ==========
    function startObserver() {
        if (STATE.observer) return;
        let debounceTimer = null;
        STATE.observer = new MutationObserver((mutations) => {
            if (!STATE.isTranslated) return;
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                const newRoots = new Set();
                mutations.forEach(m => {
                    m.addedNodes.forEach(n => {
                        if (n.nodeType === Node.ELEMENT_NODE) newRoots.add(n);
                    });
                });
                if (newRoots.size === 0) return;
                for (const root of newRoots) {
                    const textNodes = collectTextNodes(root);
                    const attrNodes = collectAttributeNodes(root);
                    if (textNodes.length + attrNodes.length > 0) {
                        await processBatch(textNodes, attrNodes);
                    }
                }
            }, 600);
        });
        STATE.observer.observe(document.body, { childList: true, subtree: true });
    }

    function stopObserver() {
        if (STATE.observer) {
            STATE.observer.disconnect();
            STATE.observer = null;
        }
    }

    // ========== 工具函数 ==========
    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    function updateProgress(percent, label) {
        const bar = document.getElementById('ctp-progress-bar');
        const text = document.getElementById('ctp-progress-text');
        if (!bar || !text) return;
        bar.style.width = Math.min(100, percent).toFixed(1) + '%';
        if (label) {
            text.textContent = label;
        } else {
            const done = STATE.doneNodes;
            const total = STATE.totalNodes;
            const errTxt = STATE.errors > 0 ? ` (${STATE.errors} 失败)` : '';
            text.textContent = `翻译中 ${done}/${total}${errTxt}`;
        }
    }

    function showToast(msg) {
        const existing = document.getElementById('ctp-toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'ctp-toast';
        toast.style.cssText = `
            position:fixed;bottom:90px;right:24px;
            background:rgba(15,15,15,0.9);color:#fff;
            padding:10px 18px;border-radius:10px;
            font-size:13px;z-index:2147483647;
            font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
            backdrop-filter:blur(4px);
            animation:fadeIn .2s ease;
        `;
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // ========== 初始化 ==========
    function init() {
        if (document.getElementById('ctp-panel')) return;
        buildUI();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
