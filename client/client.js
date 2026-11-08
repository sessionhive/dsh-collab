/**
 * workbench-core · client（设置页「会话协作」v4 · dh029）
 *
 * 静态手写 __ModuleLoader__ 格式（照 插件\启动动画\client\client.js），无需打包。
 * 三区：① 全局规范 ② 会话协作（分组 + 技能多选/编辑） ③ 其他设置（催办/自动索引/数据目录/插件版本）。
 * 数据全走同源 host 路由 /plugins/workbench-core/*（cache:'no-store'）：
 *   /global-rules、/scenes、/scene、/groups、/sessions、/skills、/skill、/notice、
 *   /rebuild-index、/plugin-info、/open。
 *
 * v4：技能多选 + 行内编辑器 + 新建技能；Tab③ 收拢其他设置；UI 术语统一为「会话/协作会话」。
 * 生效：保存即写数据文件；client 注入插件要**重启工作台**才加载新版本。
 */
window.__ModuleLoader__.load({
  id: 'dsh-workbench-core',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require('react');
    var h = react.createElement;
    var reactDom = null;
    try { reactDom = require('react-dom'); } catch (e) { reactDom = null; }
    var createPortal = reactDom && typeof reactDom.createPortal === 'function' ? reactDom.createPortal : null;
    var useState = react.useState;
    var useEffect = react.useEffect;

    var API = '/plugins/workbench-core';
    var MAX_FALLBACK = 32768;
    var SKILL_MAX = 16384;
    var ID_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;
    var ORIGIN = (typeof location !== 'undefined' && location.origin && location.origin !== 'null') ? location.origin : '';
    function placeMenu(x, y, mw, mh, vw, vh) {
      var gap = 8;
      var left = x + mw > vw - gap ? Math.max(gap, x - mw) : x;
      var top = y + mh > vh - gap ? Math.max(gap, y - mh) : y;
      return { left: left, top: top };
    }
    function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v } catch (e) { return d } }
    function lsSet(k, v) { try { localStorage.setItem(k, String(v)) } catch (e) { /* ignore */ } }
    var TABS = [
      { id: 'rules', label: '全局规范' },
      { id: 'scenes', label: '会话协作' },
      { id: 'other', label: '其他设置' },
    ];

    var S = {
      wrap: { padding: '4px 2px 18px', fontSize: '14px', lineHeight: 1.6, color: 'var(--dsw-alias-text-primary, #e6e9ef)' },
      h1: { fontSize: '16px', fontWeight: 600, margin: '0 0 2px' },
      sub: { color: 'var(--dsw-alias-text-secondary, #8b93a1)', fontSize: '12.5px', marginBottom: '12px' },
      tabs: { display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'nowrap', alignItems: 'center', overflowX: 'auto' },
      tab: { height: '26px', padding: '0 10px', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap', flex: 'none', border: '1px solid var(--dsw-alias-border-default, #2a2f3a)', background: 'var(--dsw-alias-bg-layer-2, #1b1e26)', color: 'var(--dsw-alias-text-secondary, #8b93a1)' },
      tabOn: { borderColor: 'var(--dsw-alias-state-business-primary, #4f8cff)', color: 'var(--dsw-alias-state-business-primary, #4f8cff)', background: 'var(--dsw-alias-bg-layer-3, #232733)', fontWeight: 600 },
      card: { padding: '10px', borderRadius: '12px', border: '1px solid var(--dsw-alias-border-default, #2a2f3a)', background: 'var(--dsw-alias-bg-layer-2, #1b1e26)', marginBottom: '6px' },
      lbl: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' },
      between: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' },
      hint: { fontSize: '12px', color: 'var(--dsw-alias-text-tertiary, #6b7383)', marginTop: '4px', wordBreak: 'break-all' },
      hint2: { fontSize: '12px', color: 'var(--dsw-alias-text-secondary, #8b93a1)' },
      info: { fontSize: '11.5px', color: 'var(--dsw-alias-text-tertiary, #6b7383)', marginLeft: '4px', cursor: 'help' },
      note: { margin: '4px 0 10px', padding: '8px 10px', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-1, #161920)', border: '1px solid var(--dsw-alias-border-default, #2a2f3a)', fontSize: '12px', color: 'var(--dsw-alias-text-secondary, #8b93a1)', lineHeight: 1.65 },
      ta: { width: '100%', boxSizing: 'border-box', minHeight: '260px', resize: 'vertical', padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--dsw-alias-border-default, #2a2f3a)', background: 'var(--dsw-alias-bg-base, #14161c)', color: 'var(--dsw-alias-text-primary, #e6e9ef)', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: '12.5px', lineHeight: 1.55, outline: 'none' },
      row: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px', flexWrap: 'wrap' },
      btn: { flex: 'none', padding: '7px 12px', borderRadius: '9px', cursor: 'pointer', border: '1px solid var(--dsw-alias-state-business-primary, #4f8cff)', background: 'var(--dsw-alias-bg-layer-2, #1b1e26)', color: 'var(--dsw-alias-state-business-primary, #4f8cff)', fontSize: '12.5px', fontWeight: 600 },
      btnMini: { padding: '4px 10px', borderRadius: '8px', cursor: 'pointer', border: '1px solid var(--dsw-alias-border-default, #2a2f3a)', background: 'transparent', color: 'var(--dsw-alias-text-secondary, #8b93a1)', fontSize: '12px' },
      btnOff: { opacity: 0.45, cursor: 'default' },
      err: { marginTop: '8px', fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #ff5d5d)', wordBreak: 'break-all' },
      errInline: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #ff5d5d)', marginTop: '4px' },
      ok: { marginTop: '8px', fontSize: '12px', color: 'var(--dsw-alias-state-success-primary, #3ecf8e)', wordBreak: 'break-all' },
      count: { fontSize: '12px', color: 'var(--dsw-alias-text-secondary, #8b93a1)', fontFamily: 'ui-monospace, Consolas, monospace' },
      badCount: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #ff5d5d)', fontFamily: 'ui-monospace, Consolas, monospace' },
      sec: { marginTop: '12px', border: '1px solid var(--dsw-alias-border-default, #2a2f3a)', borderRadius: '10px', overflow: 'hidden', background: 'var(--dsw-alias-bg-layer-1, #161920)' },
      secHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '6px 10px', background: 'var(--dsw-alias-bg-layer-3, #232733)' },
      secTitle: { display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 4px', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '13px', fontWeight: 600, textAlign: 'left' },
      secBody: { padding: '0 8px 8px' },
      item: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-default, #2a2f3a)', background: 'var(--dsw-alias-bg-layer-2, #1b1e26)', marginTop: '6px' },
      itemName: { fontSize: '14px', fontWeight: 600 },
      itemRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'nowrap', minWidth: '320px' },
      itemTitle: { minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      actBar: { display: 'flex', alignItems: 'center', gap: '6px', flex: 'none', overflowX: 'auto', whiteSpace: 'nowrap', paddingBottom: '1px' },
      btnAct: { height: '26px', minWidth: '0', padding: '0 8px', fontSize: '12px', lineHeight: '24px', borderRadius: '7px', cursor: 'pointer', border: '1px solid var(--dsw-alias-border-default, #2a2f3a)', background: 'transparent', color: 'var(--dsw-alias-text-secondary, #8b93a1)', whiteSpace: 'nowrap', flex: 'none' },
      btnActOff: { height: '26px', padding: '0 8px', fontSize: '12px', lineHeight: '24px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-default, #2a2f3a)', background: 'transparent', color: 'var(--dsw-alias-text-tertiary, #6b7383)', opacity: 0.45, cursor: 'not-allowed', whiteSpace: 'nowrap', flex: 'none' },
      btnActDanger: { height: '26px', padding: '0 8px', fontSize: '12px', lineHeight: '24px', borderRadius: '7px', cursor: 'pointer', border: '1px solid rgba(255,93,93,.55)', background: 'transparent', color: 'var(--dsw-alias-state-error-primary, #ff5d5d)', whiteSpace: 'nowrap', flex: 'none' },
      btnActPrimary: { height: '26px', padding: '0 8px', fontSize: '12px', lineHeight: '24px', borderRadius: '7px', cursor: 'pointer', border: '1px solid var(--dsw-alias-state-business-primary, #4f8cff)', background: 'transparent', color: 'var(--dsw-alias-state-business-primary, #4f8cff)', whiteSpace: 'nowrap', flex: 'none', fontWeight: 600 },
      menu: { position: 'absolute', top: '30px', right: '0', zIndex: 20, minWidth: '150px', padding: '6px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-default, #2a2f3a)', background: 'var(--dsw-alias-bg-layer-3, #232733)', boxShadow: '0 8px 24px rgba(0,0,0,.35)', display: 'flex', flexDirection: 'column', gap: '4px' },
      menuItem: { height: '26px', padding: '0 8px', fontSize: '12px', textAlign: 'left', borderRadius: '7px', cursor: 'pointer', border: '1px solid transparent', background: 'transparent', color: 'var(--dsw-alias-text-secondary, #8b93a1)' },
      scenesHead: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', flexWrap: 'nowrap', overflowX: 'auto' },
      searchInput: { height: '26px', padding: '0 9px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-default, #2a2f3a)', background: 'var(--dsw-alias-bg-base, #14161c)', color: 'var(--dsw-alias-text-primary, #e6e9ef)', fontSize: '12px', minWidth: '180px' },
      dragOver: { borderColor: 'var(--dsw-alias-state-business-primary, #4f8cff)' },
      ghost: { opacity: 0.45 },
      dropGroup: { borderColor: 'var(--dsw-alias-state-business-primary, #4f8cff)', boxShadow: '0 0 0 1px var(--dsw-alias-state-business-primary, #4f8cff) inset' },
      insertLine: { height: '2px', margin: '2px 0', background: 'var(--dsw-alias-state-business-primary, #4f8cff)', borderRadius: '2px' },
      popover: { position: 'absolute', top: '22px', left: '0', zIndex: 30, minWidth: '320px', maxWidth: '520px', maxHeight: '260px', overflowY: 'auto', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-default, #2a2f3a)', background: 'var(--dsw-alias-bg-layer-3, #232733)', boxShadow: '0 8px 24px rgba(0,0,0,.35)' },
      tabUnified: { height: '26px', padding: '0 10px', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', border: '1px solid var(--dsw-alias-border-default, #2a2f3a)', background: 'var(--dsw-alias-bg-layer-2, #1b1e26)', color: 'var(--dsw-alias-text-secondary, #8b93a1)' },
      tag: { fontSize: '11px', marginLeft: '6px', padding: '0 6px', borderRadius: '999px', border: '1px solid currentColor', color: 'var(--dsw-alias-text-tertiary, #6b7383)', fontWeight: 400 },
      tagGroup: { fontSize: '11px', marginLeft: '6px', padding: '0 6px', borderRadius: '999px', border: '1px solid currentColor', color: 'var(--dsw-alias-state-business-primary, #4f8cff)', fontWeight: 400 },
      badgeWarn: { fontSize: '11px', marginLeft: '6px', padding: '0 6px', borderRadius: '999px', border: '1px solid currentColor', color: '#ffd84d', fontWeight: 500 },
      badgeMuted: { fontSize: '11px', marginLeft: '6px', padding: '0 6px', borderRadius: '999px', border: '1px solid currentColor', color: 'var(--dsw-alias-text-tertiary, #6b7383)', fontWeight: 400 },
      code: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '11.5px', padding: '0 4px', borderRadius: '4px', background: 'var(--dsw-alias-bg-layer-3, #232733)', color: 'var(--dsw-alias-text-secondary, #8b93a1)' },
      form: { marginTop: '8px', marginBottom: '10px', padding: '10px 12px', borderRadius: '10px', border: '1px dashed var(--dsw-alias-border-default, #2a2f3a)', background: 'var(--dsw-alias-bg-layer-1, #161920)' },
      formTitle: { fontSize: '12.5px', fontWeight: 600, marginBottom: '6px' },
      field: { display: 'block', marginBottom: '8px' },
      fieldLbl: { display: 'block', fontSize: '12px', color: 'var(--dsw-alias-text-secondary, #8b93a1)', marginBottom: '3px' },
      input: { width: '100%', boxSizing: 'border-box', padding: '6px 9px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-default, #2a2f3a)', background: 'var(--dsw-alias-bg-base, #14161c)', color: 'var(--dsw-alias-text-primary, #e6e9ef)', fontSize: '12.5px', outline: 'none' },
      grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 12px' },
      radios: { display: 'flex', gap: '14px', margin: '4px 0 6px', flexWrap: 'wrap' },
      radio: { display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12.5px', color: 'var(--dsw-alias-text-secondary, #8b93a1)', cursor: 'pointer' },
      checks: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '2px 10px', maxHeight: '150px', overflow: 'auto', padding: '6px 8px', border: '1px solid var(--dsw-alias-border-default, #2a2f3a)', borderRadius: '8px', background: 'var(--dsw-alias-bg-base, #14161c)' },
      check: { display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--dsw-alias-text-secondary, #8b93a1)', cursor: 'pointer' },
      skillList: { marginTop: '4px', border: '1px solid var(--dsw-alias-border-default, #2a2f3a)', borderRadius: '8px', background: 'var(--dsw-alias-bg-base, #14161c)', padding: '2px 8px', maxHeight: '200px', overflow: 'auto' },
      skillRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '3px 2px', borderBottom: '1px solid var(--dsw-alias-border-default, #2a2f3a)' },
      skillName: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', color: 'var(--dsw-alias-text-primary, #e6e9ef)' },
      skillMeta: { fontSize: '11.5px', color: 'var(--dsw-alias-text-tertiary, #6b7383)', marginLeft: '6px' },
      warn: { fontSize: '11.5px', color: 'var(--dsw-alias-state-warning-primary, #e0a33e)', marginLeft: '6px' },
      skillEditor: { marginTop: '8px', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-default, #2a2f3a)', background: 'var(--dsw-alias-bg-base, #14161c)' },
      steps: { marginTop: '8px', maxHeight: '160px', overflow: 'auto', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-default, #2a2f3a)', background: 'var(--dsw-alias-bg-base, #14161c)', padding: '6px 8px' },
      step: { display: 'flex', gap: '6px', alignItems: 'baseline', fontSize: '11.5px', padding: '2px 0', wordBreak: 'break-all' },
      confirmBar: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '8px', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-state-warning-primary, #e0a33e)', background: 'var(--dsw-alias-bg-layer-3, #232733)', fontSize: '12px' },
    };

    // ---------------- 通用工具 ----------------
    function utf8Bytes(s) {
      var t = String(s == null ? '' : s);
      try { return new Blob([t]).size; } catch (e) { /* 备选 */ }
      try { return new TextEncoder().encode(t).length; } catch (e2) { return t.length; }
    }
    function msg(e) { return String((e && e.message) || e); }
    function trim(v) { return String(v == null ? '' : v).trim(); }
    function shortId(v) { var s = String(v || ''); return s.length > 10 ? s.slice(0, 10) + '…' : s; }
    function tailPath(p) {
      var parts = String(p || '').replace(/\\/g, '/').split('/').filter(Boolean);
      return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : parts.join('/');
    }
    function fmtTime(sec) {
      if (!sec) return '—';
      try {
        var d = new Date(Number(sec) * 1000), p2 = function (n) { return (n < 10 ? '0' : '') + n; };
        return (d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
      } catch (e) { return '—'; }
    }
    function kb(bytes) { var k = Number(bytes || 0) / 1024; return (k >= 10 ? Math.round(k) : k.toFixed(1)) + ' KB'; }
    // host 错误文案兜底：旧术语（两字，U+573A U+666F）→ 协作会话；用码点构造正则，源码不出现该词
    var OLD_TERM_RE = new RegExp(String.fromCharCode(22330, 26223), 'g');
    function errOf(j) {
      var t = (j && (j.hint || j.error)) ? String(j.hint || j.error) : '未知错误';
      return t.replace(OLD_TERM_RE, '协作会话');
    }
    function ruleOf(j) { return (j && j.rule) ? '（' + j.rule + '）' : ''; }
    function api(method, p, body) {
      var opt = { method: method, cache: 'no-store', headers: {} };
      if (body !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
      return fetch(ORIGIN + API + p, opt).then(function (r) {
        return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; });
      });
    }
    function notRoleOf(card) {
      var b = (card && card.boundaries) || [];
      return b.length ? String(b[0] || '').replace(/^我不负责：/, '') : '';
    }
    function getJson(path, onOk, onErr) {
      api('GET', path).then(function (j) {
        if (!j || !j.ok) { onErr(errOf(j)); return; }
        onOk(j);
      }).catch(function (e) { onErr(msg(e)); });
    }

    // ---------------- ① 左栏图标 DOM 补丁（lucide users SVG） ----------------
    // settings.section 没有 icon 选项（宿主 navIcon 只认 account/models/agent-presets/
    // plugins/archived-sessions，其它回退齿轮）。所以设置弹层里 nav button 出现后，
    // 把「会话协作」那颗按钮里的第一个 svg 换成内联 lucide users 图标（保留 class，16px）。
    var SVG_NS = 'http://www.w3.org/2000/svg';
    function makeUsersSvg(oldSvg) {
      function mk(tag, attrs) {
        var n = document.createElementNS(SVG_NS, tag);
        Object.keys(attrs).forEach(function (k) { n.setAttribute(k, String(attrs[k])); });
        return n;
      }
      var svg = mk('svg', {
        class: (oldSvg && oldSvg.getAttribute('class')) || 'navIcon',
        viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor',
        'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'aria-hidden': 'true', 'data-wb-users': '1',
      });
      [
        ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
        ['circle', { cx: '9', cy: '7', r: '4' }],
        ['path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }],
        ['path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }],
      ].forEach(function (x) { svg.appendChild(mk(x[0], x[1])); });
      return svg;
    }
    function findNavButtons() {
      var out = [];
      if (typeof document === 'undefined') return out;
      var root = document.querySelector('[data-shortcut-modal="settings"]');
      if (!root) return out;                       // 设置弹层没开，无事可做
      var btns = root.querySelectorAll('nav button');
      if (!btns.length) btns = root.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var t = String(btns[i].textContent || '').trim();
        if (t && t.length <= 12 && t.indexOf('会话协作') >= 0) out.push(btns[i]);
      }
      return out;
    }
    function patchNavIcon() {
      var btns = findNavButtons(), n = 0;
      for (var i = 0; i < btns.length; i++) {
        var svg = btns[i].querySelector('svg');
        if (!svg || !svg.parentNode || svg.getAttribute('data-wb-users') === '1') continue;
        svg.parentNode.replaceChild(makeUsersSvg(svg), svg);
        n++;
      }
      return n;
    }
    function installNavIconPatch() {
      if (typeof document === 'undefined' || typeof window === 'undefined' || typeof MutationObserver === 'undefined') return;
      // 可重入：重复 apply（含 HMR 重载）不叠 observer/interval，但要保证"补丁还在跑"
      var st = window.__wbSceneNavPatch;
      if (st && st.version === 2) { try { ensureNavLoop(st); patchNavIcon(); } catch (e) { /* ignore */ } return; }
      st = { version: 2, observer: null, timer: 0, loop: 0 };
      window.__wbSceneNavPatch = st;
      function kick() {
        if (st.timer) return;
        st.timer = setTimeout(function () {
          st.timer = 0;
          try { patchNavIcon(); } catch (e) { /* 补丁失败不影响功能 */ }
        }, 40);
      }
      function ensureNavLoop(state) {
        if (state.loop) return;
        // 兜底轮询：设置弹层重渲染/切 tab/HMR 后即使 observer 丢了也能在 ~800ms 内补回
        state.loop = setInterval(function () {
          try { patchNavIcon(); } catch (e) { /* ignore */ }
        }, 800);
      }
      try {
        st.observer = new MutationObserver(kick);
        st.observer.observe(document.documentElement || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-shortcut-modal'] });
        if (document.body && document.body !== document.documentElement) st.observer.observe(document.body, { childList: true, subtree: true });
      } catch (e) { /* 环境不支持时静默 */ }
      // 打开设置 / 切 tab 常伴随 click / keydown，补一次
      try {
        document.addEventListener('click', kick, true);
        document.addEventListener('keydown', kick, true);
      } catch (e) { /* ignore */ }
      ensureNavLoop(st);
      kick();                                      // 弹层已开时立即补一次
      try {
        window.addEventListener('beforeunload', function () {
          try {
            if (st.observer) st.observer.disconnect();
            if (st.timer) clearTimeout(st.timer);
            if (st.loop) clearInterval(st.loop);
          } catch (e) { /* 卸载不报错 */ }
          window.__wbSceneNavPatch = null;
        });
      } catch (e) { /* ignore */ }
    }

    // ---------------- Section ----------------
    function Section() {
      var _a = useState(lsGet('wb.tab', 'rules')), tab = _a[0], setTab = _a[1];
      var _b = useState(null), rules = _b[0], setRules = _b[1];
      var _c = useState(''), rulesText = _c[0], setRulesText = _c[1];
      var _d = useState(true), rulesLoading = _d[0], setRulesLoading = _d[1];
      var _e = useState(''), rulesErr = _e[0], setRulesErr = _e[1];
      var _f = useState(''), rulesOk = _f[0], setRulesOk = _f[1];
      var _g = useState(false), rulesSaving = _g[0], setRulesSaving = _g[1];
      var _i = useState(null), scenesData = _i[0], setScenesData = _i[1];
      var _lf = useState(lsGet('wb.lifeFilter', 'active') === 'archived' ? 'archived' : 'active'), lifeFilter = _lf[0], setLifeFilter = _lf[1];
      var _ao = useState(false), archivedOpen = _ao[0], setArchivedOpen = _ao[1];
      var _q = useState(''), scenesQuery = _q[0], setScenesQuery = _q[1];
      var _so = useState(false), searchOpen = _so[0], setSearchOpen = _so[1];
      var _mf = useState(null), menuFor = _mf[0], setMenuFor = _mf[1];
      var _ex = useState(null), exportInfo = _ex[0], setExportInfo = _ex[1];
      var _drag = useState(null), dragState = _drag[0], setDragState = _drag[1];
      var _dg = useState(null), dragOverGroup = _dg[0], setDragOverGroup = _dg[1];
      var _dt = useState(null), dropTarget = _dt[0], setDropTarget = _dt[1];
      var _j = useState(true), scenesLoading = _j[0], setScenesLoading = _j[1];
      var _k = useState(''), scenesErr = _k[0], setScenesErr = _k[1];
      var _l = useState(''), scenesOk = _l[0], setScenesOk = _l[1];
      var _m = useState(''), editing = _m[0], setEditing = _m[1];
      var _n = useState({}), editForm = _n[0], setEditForm = _n[1];
      var _eb = useState({}), editBaseline = _eb[0], setEditBaseline = _eb[1];
      var _o = useState(null), confirmReq = _o[0], setConfirmReq = _o[1];
      var _p = useState(false), editSaving = _p[0], setEditSaving = _p[1];
      var _q = useState(false), newOpen = _q[0], setNewOpen = _q[1];
      var _r = useState({}), newForm = _r[0], setNewForm = _r[1];
      var _s = useState(false), newSaving = _s[0], setNewSaving = _s[1];
      var _rb = useState(null), rebindFor = _rb[0], setRebindFor = _rb[1];
      var _rbs = useState(''), rebindSession = _rbs[0], setRebindSession = _rbs[1];
      var _rba = useState(false), rebindAuto = _rba[0], setRebindAuto = _rba[1];
      var _rbc = useState(''), rebindCwd = _rbc[0], setRebindCwd = _rbc[1];
      var _rbp = useState(false), previewOpen = _rbp[0], setPreviewOpen = _rbp[1];
      var _rbd = useState(null), previewData = _rbd[0], setPreviewData = _rbd[1];
      var _t = useState(null), groupsData = _t[0], setGroupsData = _t[1];
      var _w1 = useState(null), workspacesData = _w1[0], setWorkspacesData = _w1[1];
      var _w2 = useState(''), newWorkspaceId = _w2[0], setNewWorkspaceId = _w2[1];
      var _w3 = useState(''), newGroupId = _w3[0], setNewGroupId = _w3[1];
      var _doc = useState(null), doctorData = _doc[0], setDoctorData = _doc[1];
      var _dh = useState(false), docHover = _dh[0], setDocHover = _dh[1];
      var _sh = useState(false), selfHover = _sh[0], setSelfHover = _sh[1];
      var _dlg = useState(null), inlineConfirm = _dlg[0], setInlineConfirm = _dlg[1];
      var _ep = useState(null), enginePortData = _ep[0], setEnginePortData = _ep[1];
      var _epv = useState(''), enginePortInput = _epv[0], setEnginePortInput = _epv[1];
      var _epm = useState(''), enginePortMsg = _epm[0], setEnginePortMsg = _epm[1];
      function requestInlineConfirm(text, onOk) {        setInlineConfirm({ text: String(text || ''), onOk: typeof onOk === 'function' ? onOk : null });
      }
      function closeInlineConfirm() { setInlineConfirm(null); }
      function runInlineConfirm() {
        var c = inlineConfirm;
        setInlineConfirm(null);
        if (c && c.onOk) { try { c.onOk() } catch (e) { /* ignore */ } }
      }
      var _u = useState(''), groupsErr = _u[0], setGroupsErr = _u[1];
      var _v = useState(''), groupsOk = _v[0], setGroupsOk = _v[1];
      var _w = useState(''), groupEditing = _w[0], setGroupEditing = _w[1];
      var _x = useState({}), groupForm = _x[0], setGroupForm = _x[1];
      var _y = useState(false), groupSaving = _y[0], setGroupSaving = _y[1];
      var _gc = useState(null), groupConfirm = _gc[0], setGroupConfirm = _gc[1];
      var _z = useState((function () { try { return JSON.parse(lsGet('wb.collapsed', '{}')) || {} } catch (e) { return {} } })()), collapsed = _z[0], setCollapsed = _z[1];
      var _A = useState(null), sessionsData = _A[0], setSessionsData = _A[1];
      var _B = useState(''), sessionsErr = _B[0], setSessionsErr = _B[1];
      var _C = useState(null), skillsData = _C[0], setSkillsData = _C[1];
      var _D = useState(''), skillsErr = _D[0], setSkillsErr = _D[1];
      var _E = useState(null), noticeData = _E[0], setNoticeData = _E[1];
      var _F = useState(false), noticeEnabled = _F[0], setNoticeEnabled = _F[1];
      var _G = useState(20), noticeMinutes = _G[0], setNoticeMinutes = _G[1];
      var _H = useState(true), noticeLoading = _H[0], setNoticeLoading = _H[1];
      var _I = useState(''), noticeErr = _I[0], setNoticeErr = _I[1];
      var _J = useState(''), noticeOk = _J[0], setNoticeOk = _J[1];
      var _K = useState(false), noticeSaving = _K[0], setNoticeSaving = _K[1];
      var _L = useState(''), skEditId = _L[0], setSkEditId = _L[1];
      var _M = useState(''), skText = _M[0], setSkText = _M[1];
      var _N = useState(true), skLoading = _N[0], setSkLoading = _N[1];
      var _O = useState(''), skErr = _O[0], setSkErr = _O[1];
      var _P = useState(''), skOk = _P[0], setSkOk = _P[1];
      var _Q = useState(false), skSaving = _Q[0], setSkSaving = _Q[1];
      var _R = useState(''), skNewId = _R[0], setSkNewId = _R[1];
      var _S = useState(false), skCreating = _S[0], setSkCreating = _S[1];
      var _X = useState(false), skNewMode = _X[0], setSkNewMode = _X[1];
      var _T = useState(null), dirState = _T[0], setDirState = _T[1];
      var _V = useState(null), plugInfo = _V[0], setPlugInfo = _V[1];
        var _I18N = useState(null), i18nData = _I18N[0], setI18nData = _I18N[1];
      var _W = useState(''), plugErr = _W[0], setPlugErr = _W[1];
      // ---- 「其他设置」v6：运维/预算/清理（dh039）----
      var _r1 = useState(null), opsInfoData = _r1[0], setOpsInfoData = _r1[1];
      var _r2 = useState(null), selfCheckData = _r2[0], setSelfCheckData = _r2[1];
      var _r3 = useState(null), trashData = _r3[0], setTrashData = _r3[1];
      var _r4 = useState(null), backupsData = _r4[0], setBackupsData = _r4[1];
      var _r5 = useState(null), eventsData = _r5[0], setEventsData = _r5[1];
      var _r6 = useState(null), tempData = _r6[0], setTempData = _r6[1];
      var _r7 = useState([]), selBackups = _r7[0], setSelBackups = _r7[1];
      var _r8 = useState(''), trashConfirm = _r8[0], setTrashConfirm = _r8[1];
      var _r8b = useState([]), selTrash = _r8b[0], setSelTrash = _r8b[1];
      var _ctx = useState(null), ctxMenu = _ctx[0], setCtxMenu = _ctx[1];
      useEffect(function () {
        if (!ctxMenu) return;
        function onDoc(e) {
          if (e && e.type === 'keydown' && String(e.key || '') === 'Escape') { setCtxMenu(null); return; }
          if (e && e.target && e.target.closest && e.target.closest('.wb-ctx-menu')) return;
          setCtxMenu(null);
        }
        document.addEventListener('mousedown', onDoc);
        document.addEventListener('keydown', onDoc);
        window.addEventListener('scroll', onDoc, true);
        window.addEventListener('resize', onDoc);
        return function () { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onDoc); window.removeEventListener('scroll', onDoc, true); window.removeEventListener('resize', onDoc); };
      }, [ctxMenu]);
      var _r9 = useState(1000), eventsKeep = _r9[0], setEventsKeep = _r9[1];
      var _selEv = useState([]), selectedEvents = _selEv[0], setSelectedEvents = _selEv[1];
      var _sd = useState(''), searchDraft = _sd[0], setSearchDraft = _sd[1];
      var _r10 = useState(false), advOpen = _r10[0], setAdvOpen = _r10[1];
      var _r11 = useState({ tokenEnabled: false, warnContextTokens: 60000, contextThresholdTokens: 120000 }), budgetForm = _r11[0], setBudgetForm = _r11[1];
      var _r12 = useState(''), opsMsg = _r12[0], setOpsMsg = _r12[1];
      var _r13 = useState(''), budgetMsg = _r13[0], setBudgetMsg = _r13[1];

      // ---------- 读取 ----------
      function loadRules() {
        setRulesLoading(true); setRulesErr('');
        api('GET', '/global-rules').then(function (j) {
          setRulesLoading(false);
          if (!j || !j.ok) { setRulesErr('读取全局规范失败：' + errOf(j)); return; }
          setRules(j); setRulesText(String(j.text || ''));
        }).catch(function (e) { setRulesLoading(false); setRulesErr('读取全局规范失败：' + msg(e)); });
      }
      function loadScenes() {
        setScenesLoading(true); setScenesErr('');
        api('GET', '/scenes').then(function (j) {
          setScenesLoading(false);
          if (!j || !j.ok) { setScenesErr('读取协作会话失败：' + errOf(j)); return; }
          setScenesData(j);
        }).catch(function (e) { setScenesLoading(false); setScenesErr('读取协作会话失败：' + msg(e)); });
      }
      function loadGroups() { getJson('/groups', function (j) { setGroupsErr(''); setGroupsData(j); }, function (e) { setGroupsErr('读取分组失败：' + e); }); }
      function loadWorkspaces() { getJson('/workspaces', function (j) { setWorkspacesData(j); }, function (e) { setWorkspacesData({ ok: false, workspaces: [], error: String(e) }); }); }
      function loadDoctor() {
        setDoctorData(function (old) { return Object.assign({}, old || {}, { loading: true }); });
        getJson('/doctor', function (j) { setDoctorData(j); }, function (e) { setDoctorData({ ok: false, error: String(e) }); });
      }
      function loadEnginePort() {
        getJson('/ops/engine-port', function (j) { setEnginePortData(j); setEnginePortInput(String(j.enginePort || '')); }, function (e) { setEnginePortMsg('读取失败：' + e); });
      }
      function saveEnginePortAct(auto) {
        var body = auto ? { auto: true } : { port: Number(enginePortInput) };
        api('POST', '/ops/engine-port', body).then(function (j) {
          if (!j || !j.ok) { setEnginePortMsg('保存失败：' + (j && (j.hint || j.reason) || '未知错误')); return; }
          setEnginePortMsg('已' + (auto ? '自动探测并保存' : '保存') + '：' + j.enginePort);
          loadEnginePort();
        }).catch(function (e) { setEnginePortMsg('保存失败：' + msg(e)); });
      }
      function loadSessions() { getJson('/sessions', function (j) { setSessionsErr(''); setSessionsData(j); }, function (e) { setSessionsErr('读取会话失败：' + e); }); }
      function loadSkills() { getJson('/skills', function (j) { setSkillsErr(''); setSkillsData(j); }, function (e) { setSkillsErr('读取技能失败：' + e); }); }
      function loadNotice() {
        setNoticeLoading(true); setNoticeErr('');
        api('GET', '/notice').then(function (j) {
          setNoticeLoading(false);
          if (!j || !j.ok) { setNoticeErr('读取催办配置失败：' + errOf(j)); return; }
          setNoticeData(j);
          var n = j.notice || {};
          setNoticeEnabled(!!n.enabled);
          setNoticeMinutes(n.minutes != null ? n.minutes : 20);
        }).catch(function (e) { setNoticeLoading(false); setNoticeErr('读取催办配置失败：' + msg(e)); });
      }
      function loadPluginInfo() { getJson('/plugin-info', function (j) { setPlugErr(''); setPlugInfo(j); }, function (e) { setPlugErr('读取插件信息失败：' + e); }); }
      function loadOps() {
        getJson('/ops/info', function (j) { setOpsInfoData(j); }, function () { /* ignore */ });
        getJson('/ops/config', function (j) {
          if (j && j.ok) {
            setBudgetForm({
              tokenEnabled: j.token.enabled === true,
              warnContextTokens: j.token.warnContextTokens,
              contextThresholdTokens: j.token.contextThresholdTokens,
            });
            getJson('/i18n?lang=' + encodeURIComponent(String(j.lang || 'zh')), function (r) { if (r && r.ok) setI18nData(r.values || null); }, function () { /* ignore */ });
          }
        }, function () { /* ignore */ });
        getJson('/ops/trash', function (j) { setTrashData(j); }, function () { /* ignore */ });
        getJson('/ops/backups', function (j) { setBackupsData(j); }, function () { /* ignore */ });
        getJson('/ops/events', function (j) { setEventsData(j); }, function () { /* ignore */ });
        getJson('/ops/temp', function (j) { setTempData(j); }, function () { /* ignore */ });
      }
      function runSelfCheck() {
        setSelfCheckData({ running: true });
        setOpsMsg('');
        api('POST', '/ops/selfcheck').then(function (j) {
          setSelfCheckData(j);
          setOpsMsg(j && j.ok ? '自检通过 ' + j.passed + '/' + j.total : '自检有失败项');
        }).catch(function (e) { setSelfCheckData(null); setOpsMsg('自检失败：' + msg(e)); });
      }
      function openOpsTarget(target) {
        api('POST', '/ops/open', { target: target }).then(function (j) {
          setOpsMsg(j && j.ok ? '已打开：' + (j.path || target) : '打开失败：' + errOf(j));
        }).catch(function (e) { setOpsMsg('打开失败：' + msg(e)); });
      }
      function copyText(text) {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { setOpsMsg('已复制'); }, function () { setOpsMsg('复制失败（可手动选择）'); });
          } else {
            var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); document.body.removeChild(ta); setOpsMsg('已复制');
          }
        } catch (e) { setOpsMsg('复制失败：' + msg(e)); }
      }
      function selfCheckText() {
        var r = selfCheckData || {};
        return ['workbench-core 自检 ' + (r.at || '未运行'), (r.passed || 0) + '/' + (r.total || 0) + ' 通过'].concat((r.items || []).map(function (x) {
          return (x.ok ? '✓' : '✗') + ' ' + x.name + '（' + (x.ms || 0) + 'ms）' + (x.summary ? '：' + x.summary : '');
        })).join('\n');
      }
      function diagText() {
        var o = opsInfoData || {};
        return ['插件：' + ((o.plugin && o.plugin.name) || '') + ' v' + ((o.plugin && o.plugin.version) || ''),
          '引擎：' + ((o.engine && o.engine.version) || ''),
          '工作台根：' + (o.root || ''),
          '数据根：' + (o.dataRoot || ''),
          '最近自检：' + selfCheckText()].join('\n');
      }
      function saveToken() {
        setBudgetMsg('保存中…');
        api('POST', '/ops/token', { enabled: !!budgetForm.tokenEnabled, warnContextTokens: Number(budgetForm.warnContextTokens), contextThresholdTokens: Number(budgetForm.contextThresholdTokens) }).then(function (j) {
          if (!j || !j.ok) { setBudgetMsg('保存失败：' + errOf(j)); return; }
          setBudgetMsg('已保存 · ' + j.path);
        }).catch(function (e) { setBudgetMsg('保存失败：' + msg(e)); });
      }
      function toggleTrash(name) {
        setSelTrash(function (old) { var a = (old || []).slice(); var i = a.indexOf(name); if (i >= 0) a.splice(i, 1); else a.push(name); return a; });
      }
      function deleteTrashAct() {
        var names = (selTrash || []).slice();
        if (!names.length) { setOpsMsg('先勾选要删除的回收站条目'); return; }
        requestInlineConfirm('删除选中 ' + names.length + ' 项（不可回滚），确定？', function () {
          api('POST', '/ops/trash/delete', { names: names }).then(function (j) {
            if (!j || !j.ok) { setOpsMsg('删除失败：' + errOf(j)); return; }
            setOpsMsg('已删除 ' + j.removed + ' 项');
            setSelTrash([]); loadOps();
          }).catch(function (e) { setOpsMsg('删除失败：' + msg(e)); });
        });
      }
      function openItem(kind, name, action) {
        api('POST', '/ops/open-item', { kind: kind, name: name, action: action }).then(function (j) {
          setCtxMenu(null);
          if (!j || !j.ok) setOpsMsg('打开失败：' + errOf(j));
        }).catch(function (e) { setOpsMsg('打开失败：' + msg(e)); });
      }
      function clearTrashAct() {
        requestInlineConfirm('清空回收站不可回滚，确定？', function () {
          api('POST', '/ops/trash/clear', { confirm: '清空' }).then(function (j) {
            if (!j || !j.ok) { setOpsMsg('清空失败：' + errOf(j)); return; }
            setOpsMsg('已清空 ' + j.removed + ' 项（' + kb(j.bytes) + '，不可回滚）');
            setSelTrash([]); loadOps();
          }).catch(function (e) { setOpsMsg('清空失败：' + msg(e)); });
        });
      }
      function toggleBackup(name) {
        setSelBackups(function (old) { var a = (old || []).slice(); var i = a.indexOf(name); if (i >= 0) a.splice(i, 1); else a.push(name); return a; });
      }
      function deleteBackupsAct() {
        if (!selBackups.length) { setOpsMsg('先勾选要删除的备份（会移入回收站）'); return; }
        requestInlineConfirm('把选中的 ' + selBackups.length + ' 个备份移入回收站？', function () {
          api('POST', '/ops/backups/delete', { names: selBackups, confirm: true }).then(function (j) {
            if (!j || !j.ok) { setOpsMsg('删除失败：' + errOf(j)); return; }
            setOpsMsg('已移入回收站 ' + ((j.moved || []).length) + ' 项');
            setSelBackups([]); loadOps();
          }).catch(function (e) { setOpsMsg('删除失败：' + msg(e)); });
        });
      }
      function trimEventsAct() {
        var keep = Math.max(0, Math.floor(Number(eventsKeep) || 0));
        requestInlineConfirm('保留最近 ' + keep + ' 行，其余移入回收站？', function () {
          api('POST', '/ops/events/trim', { keep: keep, confirm: true }).then(function (j) {
            if (!j || !j.ok) { setOpsMsg('清理失败：' + errOf(j)); return; }
            setOpsMsg('已清理 ' + j.removed + ' 行（保留 ' + j.kept + ' 行，旧行在回收站）');
            loadOps();
          }).catch(function (e) { setOpsMsg('清理失败：' + msg(e)); });
        });
      }
      function cleanTempAct() {
        requestInlineConfirm('把 dataRoot\\temp 下的内容移入 dataRoot\\trash？', function () {
          api('POST', '/ops/temp/clean', { confirm: true }).then(function (j) {
            if (!j || !j.ok) { setOpsMsg('清理失败：' + errOf(j)); return; }
            setOpsMsg('已移入回收站 ' + ((j.moved || []).length) + ' 项');
            loadOps();
          }).catch(function (e) { setOpsMsg('清理失败：' + msg(e)); });
        });
      }
      useEffect(function () {
        loadRules(); loadScenes(); loadGroups(); loadSessions(); loadSkills(); loadNotice(); loadPluginInfo(); loadOps(); loadWorkspaces(); loadDoctor(); loadEnginePort();
      }, []);
      useEffect(function () {
        if (!menuFor) return;
        function onDoc(e) { if (!e || !e.target || !e.target.closest || !e.target.closest('[data-wb-menu]')) setMenuFor(null); }
        function onKey(e) { if (e && e.key === 'Escape') setMenuFor(null); }
        document.addEventListener('mousedown', onDoc);
        document.addEventListener('keydown', onKey);
        return function () { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
      }, [menuFor]);
      function useToastAutoClear(value, clear) {
        useEffect(function () {
          if (!value) return;
          var t = setTimeout(function () { clear(''); }, 20000);
          return function () { clearTimeout(t); };
        }, [value]);
      }
      useToastAutoClear(scenesOk, setScenesOk);
      useToastAutoClear(scenesErr, setScenesErr);
      useToastAutoClear(budgetMsg, setBudgetMsg);
      useToastAutoClear(rulesOk, setRulesOk);
      useToastAutoClear(rulesErr, setRulesErr);
      useToastAutoClear(groupsOk, setGroupsOk);
      useToastAutoClear(groupsErr, setGroupsErr);
      useToastAutoClear(skillsErr, setSkillsErr);
      useToastAutoClear(noticeOk, setNoticeOk);
      useToastAutoClear(noticeErr, setNoticeErr);
      useToastAutoClear(enginePortMsg, setEnginePortMsg);
      useToastAutoClear(sessionsErr, setSessionsErr);
      useToastAutoClear(opsMsg, setOpsMsg);
      function toggleEventLine(n) {
        setSelectedEvents(function (old) { var a = (old || []).slice(); var i = a.indexOf(n); if (i >= 0) a.splice(i, 1); else a.push(n); return a; });
      }
      function deleteSelectedEventsAct() {
        if (!selectedEvents.length) { setOpsMsg('先勾选要清理的事件行'); return; }
        var lines = selectedEvents.slice();
        requestInlineConfirm('清理选中的 ' + lines.length + ' 行事件（进回收站）？', function () {
          api('POST', '/ops/events/delete', { lines: lines, confirm: true }).then(function (j) {
            if (!j || !j.ok) { setOpsMsg('清理失败：' + errOf(j)); return; }
            setOpsMsg('已清理 ' + j.removed + ' 行（回收站：' + j.backup + '）');
            setSelectedEvents([]); loadOps();
          }).catch(function (e) { setOpsMsg('清理失败：' + msg(e)); });
        });
      }

      // ---------- ① 全局规范 ----------
      function saveRules() {
        var max = (rules && rules.maxBytes) || MAX_FALLBACK, bytes = utf8Bytes(rulesText);
        if (!trim(rulesText)) { setRulesErr('全局规则不能为空（要清空请写一行说明）'); setRulesOk(''); return; }
        if (bytes > max) { setRulesErr('超出上限（' + bytes + ' / ' + max + ' 字节），请删减后再保存'); setRulesOk(''); return; }
        setRulesSaving(true); setRulesErr(''); setRulesOk('');
        api('POST', '/global-rules', { text: rulesText }).then(function (j) {
          setRulesSaving(false);
          if (!j || !j.ok) { setRulesErr('保存失败' + ruleOf(j) + '：' + errOf(j)); return; }
          setRules(function (old) { return Object.assign({}, old || {}, { bytes: j.bytes, injectBytes: j.injectBytes }); });
          setRulesOk('已保存 · ' + (j.bytes != null ? j.bytes : bytes) + ' 字节' + (j.injectPath ? ' · 注入片段已重算' : ''));
        }).catch(function (e) { setRulesSaving(false); setRulesErr('保存失败：' + msg(e)); });
      }

      // ---------- ② 会话协作 / 分组 ----------
      function findScene(id) {
        var arr = (scenesData && scenesData.scenes) || [];
        for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
        return null;
      }
      function setNew(v) {
        setConfirmReq(null);
        setNewForm(function (old) { return typeof v === 'function' ? v(old || {}) : Object.assign({}, old || {}, v); });
      }
      function setEdit(v) {
        setConfirmReq(null);
        setEditForm(function (old) { return typeof v === 'function' ? v(old || {}) : Object.assign({}, old || {}, v); });
      }
      function openNew() {
        setNewOpen(true); setConfirmReq(null); setScenesErr(''); setScenesOk(''); setSkEditId(''); setSkErr(''); setSkOk('');
        setNewForm({ id: '', name: '', role: '', notRole: '', skills: [], sessionMode: 'pick', sessionId: '', sessionTitle: '' });
        // dh043：默认上次选择/第一个目录；分组默认未分组
        var wsList = (workspacesData && workspacesData.workspaces) || [];
        if (!newWorkspaceId && wsList.length) setNewWorkspaceId(String(wsList[0].id || ''));
        setNewGroupId('');
      }
      function closeNew() { setNewOpen(false); setNewForm({}); setConfirmReq(null); setSkEditId(''); }
      function openEdit(s) {
        var sess = (s.sessions || [])[0];
        var sel = (s.card && Array.isArray(s.card.skills)) ? s.card.skills.slice() : (s.skill ? [s.skill] : []);
        sel = sel.filter(function (x, i) { return x && sel.indexOf(x) === i; });
        setEditing(s.id); setConfirmReq(null); setScenesErr(''); setScenesOk(''); setSkEditId(''); setSkErr(''); setSkOk('');
        setEditForm({
          id: s.id, name: s.name || s.id, role: (s.card && s.card.mission) || '',
          notRole: notRoleOf(s.card), skills: sel,
          sessionMode: 'pick', sessionId: (sess && sess.sessionId) || '', sessionTitle: '',
        });
        setEditBaseline({
          id: s.id, name: s.name || s.id, role: (s.card && s.card.mission) || '',
          notRole: notRoleOf(s.card), skills: sel,
          sessionMode: 'pick', sessionId: (sess && sess.sessionId) || '', sessionTitle: '',
        });
      }
      function closeEdit() { setEditing(''); setEditForm({}); setEditBaseline({}); setConfirmReq(null); setSkEditId(''); }
      function editDirty() { try { return JSON.stringify(editForm || {}) !== JSON.stringify(editBaseline || {}) } catch (e) { return true } }
      function sessionBody(f, scene) {
        if ((f.sessionMode || 'pick') === 'new') return { sessionMode: 'new', sessionTitle: trim(f.sessionTitle) || trim(f.name) || '新会话' };
        var sid = trim(f.sessionId);
        if (sid) return { sessionId: sid };
        var s = scene && (scene.sessions || [])[0];
        return (s && s.sessionId) ? { sessionId: s.sessionId } : null;
      }
      function submitScene(kind, confirmFlag) {
        var isNew = kind === 'new';
        if (isNew ? newSaving : editSaving) return;
        if (!isNew && !editDirty()) { setScenesOk('无改动，无需保存'); return; }
        var f = (isNew ? newForm : editForm) || {}, id = trim(f.id), name = trim(f.name);
        if (!ID_RE.test(id)) { setScenesErr('协作 id 只能小写字母/数字/连字符（2~32 位）'); return; }
        if (!name) { setScenesErr('会话名称不能为空'); return; }
        var sb = sessionBody(f, isNew ? null : findScene(id));
        if (!sb) { setScenesErr('会话未选：请选一个未绑定会话，或切到「自动新建」'); return; }
        var body = Object.assign({ id: id, name: name, role: trim(f.role), notRole: trim(f.notRole), skills: (f.skills || []).filter(Boolean) }, sb);
        if (isNew) {
          if (newWorkspaceId) body.workspaceId = newWorkspaceId;
          if (newGroupId) body.groupId = newGroupId;
        }
        if (confirmFlag) body.confirm = true;
        if (isNew) setNewSaving(true); else setEditSaving(true);
        setScenesErr(''); setScenesOk('');
        api('POST', '/scene', body).then(function (j) {
          if (isNew) setNewSaving(false); else setEditSaving(false);
          if (j && j.needConfirm) { setConfirmReq({ kind: kind }); return; }
          if (!j || !j.ok) { setScenesErr((isNew ? '新增失败' : '保存失败') + ruleOf(j) + '：' + errOf(j)); return; }
          setConfirmReq(null);
          if (isNew) { setNewOpen(false); setNewForm({}); } else { setEditing(''); setEditForm({}); setEditBaseline({}); }
          setSkEditId('');
          var suffix = isNew ? (j.existed ? '（覆盖已有协作会话）' : '（新增协作会话）') : '（已更新）';
          var made = Array.isArray(j.skillCreated) && j.skillCreated.length ? ' · 已自动创建技能：' + j.skillCreated.join(' / ') : '';
          if (j.skillId) made += ' · 绑定技能：' + j.skillId;
          setScenesOk('已保存：' + (j.name || name) + suffix + ' → ' + (j.scenario || ('外壳\\scenarios\\' + id + '.json')) + made);
          loadScenes(); loadGroups(); loadSessions();
        }).catch(function (e) {
          if (isNew) setNewSaving(false); else setEditSaving(false);
          setScenesErr('保存失败：' + msg(e));
        });
      }
      function toggleCollapse(key) { setCollapsed(function (old) { var n = Object.assign({}, old || {}); n[key] = !n[key]; lsSet('wb.collapsed', JSON.stringify(n)); return n; }); }
      function expandAllGroups() { setCollapsed({}); lsSet('wb.collapsed', '{}'); }
      function collapseAllGroups() {
        var n = {};
        ((groupsData && groupsData.groups) || []).forEach(function (g) { n[g.id] = true; });
        n['__ungrouped'] = true;
        setCollapsed(n); lsSet('wb.collapsed', JSON.stringify(n));
      }
      function startRebind(s) { var dft = String((workspacesData && workspacesData.config && workspacesData.config.defaultCwd) || ''); setRebindFor(s.id); setRebindSession(''); setRebindAuto(false); setRebindCwd(String(s.cwd || dft)); setPreviewOpen(false); setPreviewData(null); setScenesErr(''); setScenesOk(''); }
      function closeRebind() { setRebindFor(null); setRebindSession(''); setRebindAuto(false); setPreviewOpen(false); setPreviewData(null); }
      function doRebind(sceneId) {
        var body = { id: sceneId, autoCreate: !!rebindAuto };
        if (!rebindAuto) body.sessionId = trim(rebindSession);
        if (!rebindAuto && !body.sessionId) { setScenesErr('请选一个未绑定会话，或「自动新建」/ 手填 sessionId'); return; }
        if (rebindCwd) body.cwd = rebindCwd;
        api('POST', '/scene/rebind', body).then(function (j) {
          if (!j || !j.ok) { setScenesErr('交接失败' + ruleOf(j) + '：' + errOf(j)); return; }
          setScenesErr(''); setScenesOk('已交接：' + j.oldSessionId + ' → ' + j.newSessionId + (j.seeded ? '（已发接力 seed）' : '（seed 未送达）'));
          closeRebind(); loadScenes(); loadSessions();
        }).catch(function (e) { setScenesErr('重新绑定失败：' + msg(e)); });
      }
      function toggleArchive(s) {
        requestInlineConfirm((s.archived ? '取消标记归档：' : '标记归档：') + (s.sessionId || s.id) + '？', function () {
          api('POST', '/sessions/archive', { sessionId: s.sessionId, archived: !s.archived }).then(function (j) {
            if (!j || !j.ok) { setScenesErr('归档标记失败：' + errOf(j)); return; }
            setScenesOk('已' + (j.archived ? '标记归档' : '取消归档') + '：' + j.sessionId);
            loadScenes();
          }).catch(function (e) { setScenesErr('归档标记失败：' + msg(e)); });
        });
      }
      function doUnbind(s) {
        requestInlineConfirm('解除绑定：场景将变为「未绑定会话」（card/summary/memory 保留，稍后可重新绑定）。确定？', function () {
          api('POST', '/scene/unbind', { id: s.id }).then(function (j) {
            if (!j || !j.ok) { setScenesErr('解除绑定失败：' + errOf(j)); return; }
            setScenesOk('已解除绑定（仅文件模式）：' + s.id + ' · ' + (j.note || ''));
            loadScenes();
          }).catch(function (e) { setScenesErr('解除绑定失败：' + msg(e)); });
        });
      }
      function doExportScene(s) {
        api('POST', '/scene/export', { id: s.id }).then(function (j) {
          if (!j || !j.ok) { setScenesErr('导出失败：' + errOf(j)); return; }
          setExportInfo({ sceneId: s.id, dir: j.dir });
          setScenesOk('已导出快照：' + j.dir + '（' + ((j.copied || []).length) + ' 项，含 manifest）');
        }).catch(function (e) { setScenesErr('导出失败：' + msg(e)); });
      }
      function doArchiveScene(s) {
        requestInlineConfirm('归档「' + (s.name || s.id) + '」？将移出分组并清空绑定，可在「已归档」恢复。', function () {
          api('POST', '/scene/archive', { id: s.id }).then(function (j) {
            if (!j || !j.ok) { setScenesErr('归档失败：' + errOf(j)); return; }
            setScenesOk('已归档：' + s.id + '（原分组 ' + (j.lastGroup || '无') + '）'); loadScenes();
          }).catch(function (e) { setScenesErr('归档失败：' + msg(e)); });
        });
      }
      function doRestoreScene(s) {
        api('POST', '/scene/restore', { id: s.id }).then(function (j) {
          if (!j || !j.ok) { setScenesErr('恢复失败：' + errOf(j)); return; }
          setScenesOk('已恢复：' + s.id + ' → ' + (j.group || '未分组') + '（待处理，需重新绑定）'); loadScenes();
        }).catch(function (e) { setScenesErr('恢复失败：' + msg(e)); });
      }
      function doDeleteScene(s) {
        requestInlineConfirm('删除「' + (s.name || s.id) + '」到回收站？scenario json 与 agents\\' + s.id + ' 会一起移入 dataRoot\\trash（页面不可撤销）。', function () {
          api('POST', '/scene/delete', { id: s.id, confirm: true }).then(function (j) {
            if (!j || !j.ok) { setScenesErr('删除失败：' + errOf(j)); return; }
            setScenesOk('已删除到回收站：' + j.dest); loadScenes();
          }).catch(function (e) { setScenesErr('删除失败：' + msg(e)); });
        });
      }
      function startNewGroup() { setGroupEditing('__new__'); setGroupsErr(''); setGroupsOk(''); setGroupForm({ id: '', name: '', note: '', members: [] }); }
      function startEditGroup(g) {
        setGroupEditing(g.id); setGroupsErr(''); setGroupsOk('');
        setGroupForm({ id: g.id, name: g.name || g.id, note: g.note || '', members: (g.members || []).slice() });
      }
      function cancelGroup() { setGroupEditing(''); setGroupForm({}); }
      function renameGroupUi(g) {
        var name = window.prompt('新的分组名称', g.name || g.id);
        if (name == null) return;
        name = trim(name);
        if (!name) { setGroupsErr('分组名称不能为空'); return; }
        api('POST', '/groups', { action: 'rename', id: g.id, name: name }).then(function (j) {
          if (!j || !j.ok) { setGroupsErr('改名失败：' + errOf(j)); return; }
          setGroupsErr(''); setGroupsOk('已改名：' + name); loadGroups();
        }).catch(function (e) { setGroupsErr('改名失败：' + msg(e)); });
      }
      function deleteGroupUi(g) {
        requestInlineConfirm('删除分组「' + (g.name || g.id) + '」？成员会回到「未分组」，不会删除场景/会话/card。', function () {
          api('POST', '/groups', { action: 'delete', id: g.id }).then(function (j) {
            if (!j || !j.ok) { setGroupsErr('删除失败：' + errOf(j)); return; }
            setGroupsErr(''); setGroupsOk('已删除分组，成员回未分组'); loadGroups(); loadScenes();
          }).catch(function (e) { setGroupsErr('删除失败：' + msg(e)); });
        });
      }
      function setGroup(patch) { setGroupForm(function (old) { return Object.assign({}, old || {}, patch); }); }
      function toggleMember(id) {
        setGroupForm(function (old) {
          var f = Object.assign({}, old || {}), arr = (f.members || []).slice(), i = arr.indexOf(id);
          if (i < 0) arr.push(id); else arr.splice(i, 1);
          f.members = arr;
          return f;
        });
      }
      function submitGroup() {
        if (groupSaving) return;
        var f = groupForm || {}, name = trim(f.name);
        if (!name) { setGroupsErr('分组名称不能为空'); return; }
        var valid = {};
        ((scenesData && scenesData.scenes) || []).forEach(function (s) { valid[s.id] = 1; });
        var members = (f.members || []).filter(function (id) { return !!valid[id]; });
        var gid = trim(f.id) || ('g' + Date.now().toString(36));
        var next = ((groupsData && groupsData.groups) || []).map(function (g) {
          return { id: g.id, name: g.name || g.id, note: g.note || '', members: (g.members || []).filter(function (id) { return !!valid[id]; }) };
        });
        var idx = -1;
        for (var i = 0; i < next.length; i++) if (next[i].id === gid) idx = i;
        for (var j = 0; j < next.length; j++) next[j].members = next[j].members.filter(function (id) { return members.indexOf(id) < 0; });
        var item = { id: gid, name: name, note: trim(f.note), members: members };
        if (idx < 0) next.push(item); else next[idx] = item;
        // dh048：必须二次确认（整表覆盖 groups 说明 + 确定/取消）；取消不写
        setGroupConfirm({ next: next, name: name, gid: gid, isNew: !f.id });
      }
      function doSaveGroup() {
        var c = groupConfirm;
        if (!c || groupSaving) return;
        setGroupSaving(true); setGroupsErr(''); setGroupsOk('');
        api('POST', '/groups', { groups: c.next }).then(function (j) {
          setGroupSaving(false);
          if (!j || !j.ok) { setGroupsErr('保存分组失败' + ruleOf(j) + '：' + errOf(j)); return; }
          setGroupConfirm(null);
          setGroupEditing(''); setGroupForm({});
          setGroupsOk('已保存分组：' + c.name + '（整表共 ' + c.next.length + ' 组）');
          loadGroups();
        }).catch(function (e) { setGroupSaving(false); setGroupsErr('保存分组失败：' + msg(e)); });
      }
      function cancelGroupConfirm() { setGroupConfirm(null); }

      // ---------- 技能（多选 / 编辑 / 新建） ----------
      function toggleSkill(setF, id) {
        setF(function (old) {
          var f = Object.assign({}, old || {}), arr = (f.skills || []).slice(), i = arr.indexOf(id);
          if (i < 0) arr.push(id); else arr.splice(i, 1);
          f.skills = arr;
          return f;
        });
      }
      function addSkill(setF, id) {
        setF(function (old) {
          var f = Object.assign({}, old || {}), arr = (f.skills || []).slice();
          if (arr.indexOf(id) < 0) arr.push(id);
          f.skills = arr;
          return f;
        });
      }
      function openSkill(id) {
        setSkNewMode(false);
        setSkEditId(id); setSkText(''); setSkErr(''); setSkOk(''); setSkLoading(true);
        api('GET', '/skill?id=' + encodeURIComponent(id)).then(function (j) {
          setSkLoading(false);
          if (!j || !j.ok) { setSkErr('读取技能失败：' + errOf(j)); return; }
          setSkText(String(j.text || ''));
        }).catch(function (e) { setSkLoading(false); setSkErr('读取技能失败：' + msg(e)); });
      }
      function skillTemplateText(id) {
        return '---\nname: ' + id + '\ndescription: 一句话：这个技能干什么（含触发词）\n---\n\n# ' + id +
          '\n\n## 什么时候用\n\n（写：什么场景/用户说什么话时，该用这个技能）\n\n## 怎么做\n\n（写：步骤或要点，给以后的自己看）\n\n## 交付标准\n\n（写：做出什么算完成——文件 / 命令 / 证据路径）\n\n## 注意\n\n（写：坑、约束；没有可删）\n';
      }
      function closeSkillEditor() {
        setSkEditId(''); setSkText(''); setSkErr(''); setSkOk(''); setSkNewMode(false);
      }
      function openNewSkill(id) {
        var x = trim(id);
        if (!ID_RE.test(x)) { setSkillsErr('技能 id 只能小写字母/数字/连字符（2~32 位）'); return; }
        setSkEditId(x); setSkText(skillTemplateText(x)); setSkLoading(false); setSkErr(''); setSkOk(''); setSkNewMode(true);
      }
      function saveSkill() {
        var id = trim(skEditId), raw = String(skText == null ? '' : skText).replace(/^\uFEFF/, ''), bytes = utf8Bytes(raw), creating = !!skNewMode;
        if (!id) { setSkErr('技能 id 为空'); return; }
        if (!trim(raw)) { setSkErr('技能内容不能为空'); setSkOk(''); return; }
        if (bytes > SKILL_MAX) { setSkErr('超出上限（' + bytes + ' / ' + SKILL_MAX + ' 字节）'); setSkOk(''); return; }
        setSkSaving(true); setSkErr(''); setSkOk('');
        var done = function () { setSkSaving(false); loadSkills(); setScenesOk('技能已保存：' + id); if (newOpen) addSkill(setNew, id); else if (editing) addSkill(setEdit, id); closeSkillEditor(); };
        var fail = function (j) { setSkSaving(false); setSkErr('保存技能失败' + ruleOf(j) + '：' + errOf(j)); };
        var save = function (create) { return api('POST', '/skill', create ? { id: id, text: raw, create: true } : { id: id, text: raw }); };
        save(creating).then(function (j) {
          if (j && !j.ok && creating && String(j.hint || '').indexOf('已存在') >= 0) {
            setSkSaving(false);
            requestInlineConfirm('技能已存在：' + id + '，要覆盖保存吗？', function () {
              setSkSaving(true);
              save(false).then(function (j2) { if (!j2 || !j2.ok) fail(j2); else done(); }).catch(function (e) { setSkSaving(false); setSkErr('保存技能失败：' + msg(e)); });
            });
            return;
          }
          if (!j || !j.ok) { fail(j); return; }
          done();
        }).catch(function (e) { setSkSaving(false); setSkErr('保存技能失败：' + msg(e)); });
      }
      function createSkill(fixedId) {
        var id = trim(fixedId != null ? fixedId : skNewId);
        if (!ID_RE.test(id)) { setSkillsErr('技能 id 只能小写字母/数字/连字符（2~32 位）'); return; }
        setSkillsErr('');
        if (fixedId == null) setSkNewId('');
        openNewSkill(id);
      }

      // ---------- ③ 其他设置 ----------
      function openDataDir() {
        if (dirState && dirState.busy) return;
        setDirState({ busy: true, msg: '', err: '' });
        api('POST', '/open', { target: 'dataDir' }).then(function (j) {
          if (!j || !j.ok) { setDirState({ busy: false, msg: '', err: '打开失败：' + errOf(j) }); return; }
          setDirState({ busy: false, msg: '已打开', err: '' });
        }).catch(function (e) { setDirState({ busy: false, msg: '', err: '打开失败：' + msg(e) }); });
      }
      function saveNotice() {
        var m = Number(noticeMinutes);
        if (!isFinite(m) || m < 1 || m > 1440) { setNoticeErr('分钟数取 1~1440 的整数'); setNoticeOk(''); return; }
        setNoticeSaving(true); setNoticeErr(''); setNoticeOk('');
        api('POST', '/notice', { enabled: !!noticeEnabled, minutes: Math.round(m) }).then(function (j) {
          setNoticeSaving(false);
          if (!j || !j.ok) { setNoticeErr('保存失败' + ruleOf(j) + '：' + errOf(j)); return; }
          setNoticeData(j);
          var n = j.notice || {};
          setNoticeEnabled(!!n.enabled);
          setNoticeMinutes(n.minutes != null ? n.minutes : Math.round(m));
          setNoticeOk('已保存：' + (n.enabled ? '开启' : '关闭') + ' · 阈值 ' + (n.minutes != null ? n.minutes : Math.round(m)) + ' 分钟');
        }).catch(function (e) { setNoticeSaving(false); setNoticeErr('保存失败：' + msg(e)); });
      }
      // ---------- 渲染小件 ----------
      function fieldRow(label, input, hint) {
        return h('label', { style: S.field },
          h('span', { style: S.fieldLbl }, label, hint ? h('span', { style: S.info, title: hint }, ' ⓘ') : null),
          input);
      }
      function textInput(value, ph, on) { return h('input', { type: 'text', value: value || '', placeholder: ph || '', onChange: function (e) { on(e.target.value); }, style: S.input }); }
      function radio(on, label, onPick) { return h('label', { style: S.radio }, h('input', { type: 'radio', checked: !!on, onChange: onPick }), h('span', null, label)); }
      function sessLabel(x) {
        var s = String(x.title || '（无标题）') + ' · ' + shortId(x.sessionId);
        return x.cwd ? s + ' · ' + tailPath(x.cwd) : s;
      }
      function skillMetaText(x) {
        if (x.ghost) return '将自动创建';
        return [x.hasSkillMd ? '' : '将自动创建', kb(x.bytes), x.mtime ? fmtTime(x.mtime) : ''].filter(Boolean).join(' · ');
      }
      function skillsField(f, setF, fixedSkillId) {
        var list = ((skillsData && skillsData.skills) || []).slice(), sel = (f && f.skills) || [];
        var fixed = fixedSkillId == null ? null : trim(fixedSkillId);
        var canCreate = fixed == null ? true : ID_RE.test(fixed);
        sel.forEach(function (id) { if (!list.some(function (x) { return x.id === id; })) list.unshift({ id: id, hasSkillMd: false, bytes: 0, mtime: 0, ghost: true }); });
        return h('div', { style: S.field },
          h('span', { style: S.fieldLbl, title: 'card.skills[]（可多选）；每项对应 引擎数据\\.dsh\\skills\\<id>\\SKILL.md；不选则默认=协作 id' }, '技能（多选） ⓘ'),
          h('div', { style: S.skillList },
            list.length
              ? list.map(function (x) {
                  var on = sel.indexOf(x.id) >= 0, big = Number(x.bytes || 0) > SKILL_MAX;
                  return h('div', { key: x.id, style: S.skillRow },
                    h('label', { style: S.check },
                      h('input', { type: 'checkbox', checked: on, onChange: function () { toggleSkill(setF, x.id); } }),
                      h('span', { style: S.skillName }, x.id),
                      h('span', { style: big ? S.warn : S.skillMeta, title: big ? '超过 16KB（host 上限），保存会失败' : '' }, skillMetaText(x))),
                    h('button', { type: 'button', style: S.btnMini, onClick: function () { openSkill(x.id); } }, '编辑'));
                })
              : h('div', { style: S.hint, marginTop: 0 }, '没有技能；可在下面新建')),
          h('div', { style: S.row, marginTop: '4px' },
            fixed != null && canCreate
              ? h('button', { type: 'button', onClick: function () { createSkill(fixed); }, disabled: !!skCreating, style: Object.assign({}, S.btnMini, skCreating ? S.btnOff : null) }, skCreating ? '新建中…' : '＋ 新建技能')
              : h('span', { style: S.hint, marginTop: 0 }, '未选技能不阻塞保存；所选技能缺失会自动创建基础 SKILL')),
          skillsErr ? h('div', { style: S.errInline }, skillsErr) : null,
          skEditId ? skillEditorView() : null);
      }
      function skillEditorView() {
        var bytes = utf8Bytes(skText), over = bytes > SKILL_MAX;
        return h('div', { style: S.skillEditor },
          h('div', { style: S.between },
            h('div', { style: S.formTitle, marginBottom: 0 }, (skNewMode ? '新建技能：' : '编辑技能：') + skEditId),
            h('div', { style: over ? S.badCount : S.count }, bytes + ' / ' + SKILL_MAX + ' 字节')),
          skLoading
            ? h('div', { style: S.hint, marginTop: 0 }, '读取中…')
            : h('textarea', { value: skText, spellCheck: false, onChange: function (e) { setSkText(e.target.value); setSkOk(''); }, style: Object.assign({}, S.ta, { minHeight: '180px' }, over ? { borderColor: 'var(--dsw-alias-state-error-primary, #ff5d5d)' } : null) }),
          h('div', { style: S.row },
            h('button', { type: 'button', onClick: saveSkill, disabled: skSaving || skLoading || over, style: Object.assign({}, S.btn, (skSaving || skLoading || over) ? S.btnOff : null) }, skSaving ? '保存中…' : '保存并关闭'),
            skNewMode ? h('button', { type: 'button', onClick: closeSkillEditor, disabled: !!skSaving, style: S.btnMini }, '取消') : null,
            over ? h('span', { style: S.errInline }, '超出 ' + (bytes - SKILL_MAX) + ' 字节') : null),
          skErr ? h('div', { style: S.err }, skErr) : null,
          skOk ? h('div', { style: S.ok }, skOk) : null);
      }
      function sessionPicker(f, setF) {
        var mode = f.sessionMode || 'pick', cur = trim(f.sessionId);
        var opts = ((sessionsData && sessionsData.unbound) || []).slice();
        var listErr = (sessionsData && sessionsData.sessionError) || '';
        if (cur && !opts.some(function (x) { return x.sessionId === cur; })) opts.unshift({ sessionId: cur, title: '当前会话' });
        var curOpt = null;
        for (var oi = 0; oi < opts.length; oi++) if (opts[oi].sessionId === cur) curOpt = opts[oi];
        return h('div', { style: S.field },
          h('span', { style: S.fieldLbl, title: '选项来自 /sessions 的 unbound（未绑定任何协作会话的会话）；自动新建=提交时建会话并绑定；列表不可用时可手填 sessionId' }, '会话 ⓘ'),
          h('div', { style: S.radios },
            radio(mode === 'pick', '未绑定会话', function () { setF({ sessionMode: 'pick' }); }),
            radio(mode === 'new', '自动新建', function () { setF({ sessionMode: 'new' }); })),
          mode === 'pick'
            ? (opts.length
                ? h('select', { value: cur, onChange: function (e) { setF({ sessionId: e.target.value }); }, style: S.input },
                    h('option', { value: '' }, '— 未绑定会话 —'),
                    opts.map(function (x) { return h('option', { key: x.sessionId, value: x.sessionId }, sessLabel(x)); }))
                : (sessionsData ? h('div', { style: S.hint }, '没有可列出的会话（可手填）') : h('div', { style: S.hint }, '读取中…')))
            : h('div', { style: S.hint }, '会话标题自动 = 会话名称（无需填写）'),
          mode === 'pick'
            ? h('input', { type: 'text', value: cur, placeholder: '或直接粘贴 sessionId（外部环境/列表不可用时）', onChange: function (e) { setF({ sessionId: e.target.value }); }, style: Object.assign({}, S.input, { marginTop: '6px' }) })
            : null,
          mode === 'pick' && cur
            ? h('div', { style: S.hint, marginTop: '2px' }, '标题（只读）：' + (curOpt ? (curOpt.title || cur) : cur))
            : null,
          listErr ? h('div', { style: S.hint2, title: listErr }, '会话列表不可用：' + String(listErr).slice(0, 80)) : null,
          sessionsData && sessionsData.source === 'none' ? h('div', { style: S.hint2 }, 'host 连新建/唤醒也不可用：可手填 sessionId，或手改 _meta\\registry.json 兜底') : null,
          sessionsErr ? h('div', { style: S.errInline }, sessionsErr) : null);
      }
      function confirmBar(kind) {
        return h('div', { style: S.confirmBar }, h('span', null, '协作会话已存在，覆盖？'),
          h('button', { type: 'button', onClick: function () { submitScene(kind, true); }, style: S.btnMini }, '确认覆盖'),
          h('button', { type: 'button', onClick: function () { setConfirmReq(null); }, style: S.btnMini }, '取消确认'));
      }

      // ---------- 渲染：① 全局规范 ----------
      function rulesPanel() {
        var max = (rules && rules.maxBytes) || MAX_FALLBACK, bytes = utf8Bytes(rulesText), over = bytes > max, busy = rulesSaving || rulesLoading;
        return h('div', { style: S.card },
          h('div', { style: S.between },
            h('div', { style: S.lbl, marginBottom: 0 }, '全局规范'),
            h('div', { style: S.row, marginTop: 0 },
              h('div', { style: over ? S.badCount : S.count }, bytes + ' / ' + max + ' 字节'))),
          h('textarea', {
            value: rulesText, spellCheck: false, placeholder: '团队全局规则…',
            onChange: function (e) { setRulesText(e.target.value); setRulesOk(''); },
            style: Object.assign({}, S.ta, over ? { borderColor: 'var(--dsw-alias-state-error-primary, #ff5d5d)' } : null),
          }),
          h('div', { style: S.row },
            h('button', { type: 'button', onClick: saveRules, disabled: busy || over, style: Object.assign({}, S.btn, (busy || over) ? S.btnOff : null) },
              rulesSaving ? '保存中…' : '保存'),
            rulesLoading ? h('span', { style: S.hint2 }, '加载中…') : null,
            over ? h('span', { style: S.errInline }, '超出 ' + (bytes - max) + ' 字节，请删减后再保存') : null),
          rulesErr ? h('div', { style: S.err }, rulesErr) : null,
          rulesOk ? h('div', { style: S.ok }, rulesOk) : null);
      }

      // ---------- 渲染：② 会话协作 ----------
      function newFormView() {
        var f = newForm || {};
        return h('div', { style: S.form },
          h('div', { style: S.formTitle, title: '提交后写 card.json + 协作会话 json 并重跑 gen-index' }, '＋ 新增协作会话 ⓘ'),
          h('div', { style: S.grid2 },
            fieldRow('协作 id', textInput(f.id, '比如 scene-foo', function (v) { setNew({ id: v }); }), '小写字母/数字/连字符，2~32 位'),
            fieldRow('会话名称', textInput(f.name, '显示名', function (v) { setNew({ name: v }); }), '也是自动新建会话的默认标题')),
          sessionPicker(f, setNew),
          h('div', { style: S.grid2 },
            fieldRow('目录（自动新建时）', h('select', { value: newWorkspaceId || '', onChange: function (e) { setNewWorkspaceId(e.target.value); }, style: S.input },
              ((workspacesData && workspacesData.workspaces) || []).length
                ? ((workspacesData && workspacesData.workspaces) || []).map(function (w) { return h('option', { key: w.id, value: w.id }, (w.title || w.id) + ' · ' + String(w.path || '').slice(-28)); })
                : h('option', { value: '' }, '（无可用目录，用 config.defaultCwd / 未选择）')), '新会话的 cwd = 选中的 app 目录路径'),
            fieldRow('分组（可选）', h('select', { value: newGroupId || '', onChange: function (e) { setNewGroupId(e.target.value); }, style: S.input },
              h('option', { value: '' }, '未分组'),
              ((groupsData && groupsData.groups) || []).map(function (g) { return h('option', { key: g.id, value: g.id }, g.name || g.id); })), '保存后把新协作会话加入该组')),
          h('div', { style: S.grid2 },
            fieldRow('职责', textInput(f.role, '一句话职责', function (v) { setNew({ role: v }); }), '写进 card.json 的 mission'),
            fieldRow('边界（可选）', textInput(f.notRole, '边界，留空不写', function (v) { setNew({ notRole: v }); }), '写进 card.json 的 boundaries（我不负责）')),
          skillsField(f, setNew, f.id),
          h('div', { style: S.row },
            h('button', { type: 'button', onClick: function () { submitScene('new', false); }, disabled: !!newSaving, style: Object.assign({}, S.btn, newSaving ? S.btnOff : null) },
              newSaving ? '保存中…' : '＋ 新增协作会话'),
            h('button', { type: 'button', onClick: closeNew, disabled: !!newSaving, style: S.btnMini }, '取消'),
            newSaving ? h('span', { style: S.hint2 }, '保存中…') : null),
          confirmReq && confirmReq.kind === 'new' ? confirmBar('new') : null);
      }
      function changeSceneGroup(sceneId, gid) {
        api('POST', '/scene/order', { id: sceneId, groupId: gid || '', index: 9999 }).then(function (j) {
          if (!j || !j.ok) { setScenesErr('改分组失败：' + errOf(j)); return; }
          setScenesOk('已改分组：' + (gid || '未分组')); loadScenes(); loadGroups();
        }).catch(function (e) { setScenesErr('改分组失败：' + msg(e)); });
      }
      function editFormView(s) {
        var f = editForm || {}, sess = (s.sessions || [])[0];
        var gs = (groupsData && groupsData.groups) || [], sg = (groupsData && groupsData.sceneGroup) || {};
        return h('div', { style: S.form },
          h('div', { style: S.formTitle }, '编辑：' + (s.name || s.id)),
          h('div', { style: S.grid2 },
            fieldRow('协作 id', h('input', { type: 'text', value: f.id || '', readOnly: true, style: Object.assign({}, S.input, { opacity: 0.7 }) })),
            fieldRow('会话名称', textInput(f.name, '显示名', function (v) { setEdit({ name: v }); }))),
          sessionPicker(f, setEdit),
          fieldRow('分组', h('select', { value: sg[s.id] || '', onChange: function (e) { changeSceneGroup(s.id, e.target.value); }, style: S.input },
            h('option', { value: '' }, '未分组'),
            gs.map(function (g) { return h('option', { key: g.id, value: g.id }, g.name || g.id); }))),
          sess ? h('div', { style: S.hint, marginTop: 0 }, '当前绑定：' + sessLabel(sess)) : null,
          h('div', { style: S.grid2 },
            fieldRow('职责', textInput(f.role, '一句话职责', function (v) { setEdit({ role: v }); }), '写进 card.json 的 mission'),
            fieldRow('边界（可选）', textInput(f.notRole, '边界，留空不写', function (v) { setEdit({ notRole: v }); }), '写进 card.json 的 boundaries（我不负责）')),
          skillsField(f, setEdit),
          h('div', { style: S.hint, marginTop: 0 }, '会话改绑待 host 支持'),
          h('div', { style: S.row },
            h('button', { type: 'button', onClick: function () { submitScene('edit', false); }, disabled: !!editSaving || !editDirty(), style: Object.assign({}, S.btn, (editSaving || !editDirty()) ? S.btnOff : null) },
              editSaving ? '保存中…' : '保存修改'),
            !editDirty() ? h('span', { style: S.hint2 }, '无改动') : null,
            h('button', { type: 'button', onClick: closeEdit, disabled: !!editSaving, style: S.btnMini }, '取消')),
          confirmReq && confirmReq.kind === 'edit' ? confirmBar('edit') : null);
      }
      function groupFormView(isNew) {
        var f = groupForm || {}, list = (scenesData && scenesData.scenes) || [];
        return h('div', { style: S.form },
          h('div', { style: S.formTitle }, isNew ? '＋ 新建分组' : ('编辑分组：' + (f.name || f.id || ''))),
          h('div', { style: S.grid2 },
            fieldRow('名称', textInput(f.name, '如「协作开发」', function (v) { setGroup({ name: v }); })),
            fieldRow('备注', textInput(f.note, '这组是干什么的', function (v) { setGroup({ note: v }); }))),
          h('div', { style: S.field },
            h('span', { style: S.fieldLbl, title: '保存会整表覆盖 groups：勾选会把协作会话从其他组移入本组，未勾选回到「未分组」。' }, '成员 ⓘ'),
            list.length
              ? h('div', { style: S.checks }, list.map(function (s) {
                  return h('label', { key: s.id, style: S.check },
                    h('input', { type: 'checkbox', checked: (f.members || []).indexOf(s.id) >= 0, onChange: function () { toggleMember(s.id); } }),
                    h('span', null, (s.name || s.id) + ' · ' + s.id));
                }))
              : h('div', { style: S.hint }, '没有协作会话'),
            h('div', { style: S.hint }, '勾选编入本组，其余回未分组')),
          h('div', { style: S.row },
            h('button', { type: 'button', onClick: submitGroup, disabled: !!groupSaving, style: Object.assign({}, S.btn, groupSaving ? S.btnOff : null) },
              groupSaving ? '保存中…' : '保存分组'),
            h('button', { type: 'button', onClick: cancelGroup, disabled: !!groupSaving, style: S.btnMini }, '取消')),
          groupConfirm
            ? h('div', { style: S.confirmBar },
                h('span', null, '保存分组会整表覆盖 groups（共 ' + groupConfirm.next.length + ' 组）：勾选会把协作会话从其他组移入本组，未勾选回到「未分组」。确定保存？'),
                h('button', { type: 'button', onClick: doSaveGroup, disabled: !!groupSaving, style: S.btnMini }, '确定'),
                h('button', { type: 'button', onClick: cancelGroupConfirm, disabled: !!groupSaving, style: S.btnMini }, '取消'))
            : null);
      }
      function scenesPanel() {
        var allList = (scenesData && scenesData.scenes) || [], orders = (scenesData && scenesData.orders) || [];
        var stateOf = function (s) { return String(s.state || (s.archived ? 'archived' : ((s.sessions || []).length ? 'active' : 'pending'))) };
        var liveList = allList.filter(function (s) { return stateOf(s) !== 'archived' });
        var archList = allList.filter(function (s) { return stateOf(s) === 'archived' });
        var groups = (groupsData && groupsData.groups) || [];
        var sceneGroup = (groupsData && groupsData.sceneGroup) || {};
        var groupName = {};
        groups.forEach(function (g) { groupName[g.id] = g.name || g.id; });
        var q = trim(scenesQuery).toLowerCase();
        function match(s, gid) {
          if (!q) return true;
          var gname = gid ? (groupName[gid] || '') : '未分组';
          return (String(s.name || '') + ' ' + String(s.id) + ' ' + gname).toLowerCase().indexOf(q) >= 0;
        }
        var byId = {}, placed = {};
        liveList.forEach(function (s) { byId[s.id] = s; });
        var sections = [];
        groups.forEach(function (g) {
          var members = (g.members || []).map(function (id) { return byId[id]; }).filter(function (s) { if (!s || placed[s.id] || !match(s, g.id)) return false; placed[s.id] = 1; return true; });
          sections.push({ key: g.id, gid: g.id, name: g.name || g.id, note: g.note || '', group: g, members: members });
        });
        var ungrouped = [];
        ((groupsData && groupsData.ungrouped) || []).forEach(function (id) { if (byId[id] && !placed[id] && match(byId[id], '')) { placed[id] = 1; ungrouped.push(byId[id]); } });
        liveList.forEach(function (s) { if (!placed[s.id] && match(s, sceneGroup[s.id] || '')) { placed[s.id] = 1; ungrouped.push(s); } });
        sections.unshift({ key: '__ungrouped', gid: '', name: '未分组', note: '', group: null, members: ungrouped });
        var archFiltered = archList.filter(function (s) { return match(s, s.lastGroup || ''); });
        var activeCount = liveList.length;
        var archivedCount = archList.length;
        var viewingArch = lifeFilter === 'archived';
        var dragTimer = null;
        function startDragTimer(s) {
          if (dragTimer) clearTimeout(dragTimer);
          dragTimer = setTimeout(function () { dragTimer = null; setDragState({ id: s.id }); setScenesOk('拖动到组头可入组；拖到卡片可排序（松开完成）'); }, 500);
        }
        function cancelDragTimer() { if (dragTimer) { clearTimeout(dragTimer); dragTimer = null; } }
        function dropToGroup(gid) {
          if (!dragState) return;
          var st = dragState; setDragState(null);
          api('POST', '/scene/order', { id: st.id, groupId: gid || '', index: 9999 }).then(function (j) {
            if (!j || !j.ok) { setScenesErr('移动失败：' + errOf(j)); return; }
            setScenesOk('已移动到' + (gid ? '分组「' + (groupName[gid] || gid) + '」' : '未分组')); loadScenes(); loadGroups();
          }).catch(function (e) { setScenesErr('移动失败：' + msg(e)); });
        }
        function dropToCard(s, gid, idx) {
          if (!dragState) return;
          var st = dragState; setDragState(null);
          if (st.id === s.id) return;
          api('POST', '/scene/order', { id: st.id, groupId: gid || '', index: idx }).then(function (j) {
            if (!j || !j.ok) { setScenesErr('排序失败：' + errOf(j)); return; }
            setScenesOk('已调整顺序'); loadScenes(); loadGroups();
          }).catch(function (e) { setScenesErr('排序失败：' + msg(e)); });
        }
        function copyText(t) { try { navigator.clipboard.writeText(String(t)); setScenesOk('已复制：' + String(t)); } catch (e) { setScenesErr('复制失败，请手动复制：' + String(t)); } }
        function openRoleCard(s) {
          api('POST', '/ops/open', { target: 'path', path: s.cardPath }).then(function (j) {
            if (j && j.ok) return;
            return api('POST', '/ops/open', { target: 'dataDir' }).then(function (j2) {
              if (j2 && j2.ok) { setScenesOk('打开角色卡不可用，已切到数据目录：' + s.cardPath); return; }
              copyText(s.cardPath);
            });
          }).catch(function () { copyText(s.cardPath); });
        }
        function sceneRow(s, gid, idx) {
          var sessions = s.sessions || [];
          var state = stateOf(s);
          var archived = state === 'archived';
          var pending = state === 'pending';
          var hasSession = sessions.length > 0;
          var hostArchived = !!s.sessionArchived;
          var pressure = String(s.pressure || 'unknown');
          var oldArch = archived && s.archivedAt && (Date.now() - new Date(s.archivedAt).getTime()) > 30 * 24 * 3600 * 1000;
          var lastG = groupName[s.lastGroup] || s.lastGroup || '';
          var dragProps = archived ? {} : { onMouseDown: function (e) { if (e && e.target && e.target.closest && e.target.closest('button')) return; startDragTimer(s); }, onMouseUp: cancelDragTimer, onMouseLeave: cancelDragTimer };
          return h('div', { key: s.id, style: { position: 'relative' }, onMouseUp: archived ? null : function () { dropToCard(s, gid, idx); }, onMouseOver: archived ? null : function () { setDropTarget({ gid: gid || '', idx: idx }); }, onMouseLeave: archived ? null : function () { setDropTarget(null); } },
            dropTarget && dropTarget.idx === idx && String(dropTarget.gid || '') === String(gid || '') ? h('div', { style: S.insertLine }) : null,
            h('div', { style: Object.assign({}, S.item, S.itemRow, dragState && dragState.id === s.id ? Object.assign({}, S.dragOver, S.ghost) : null), ...dragProps },
              h('div', { style: S.itemTitle },
                h('div', { style: Object.assign({}, S.itemName, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }) }, s.name || s.id,
                  pending ? h('span', { style: S.badgeMuted, title: '无绑定会话' }, '未绑定') : null,
                  hostArchived ? h('span', { style: Object.assign({}, S.badgeWarn, { title: '绑定会话已被 host 归档，请交接' }) }, '会话已归档') : null,
                  archived && lastG ? h('span', { style: S.badgeMuted }, '原组：' + lastG) : null,
                  archived && oldArch ? h('span', { style: Object.assign({}, S.badgeMuted, { color: '#8b93a1' }) }, '可清理') : null,
                  pressure === 'warn' ? h('span', { style: S.badgeWarn, title: '上下文 ≥ 提醒阈值' }, '上下文偏高') : null,
                  pressure === 'fail' ? h('span', { style: S.badgeWarn, title: '上下文 ≥ 交接阈值' }, '建议换会话') : null)),
              h('div', { style: S.actBar },
                archived
                  ? [
                      h('button', { type: 'button', onClick: function () { doRestoreScene(s); }, style: S.btnAct }, '恢复'),
                      h('button', { type: 'button', onClick: function () { doDeleteScene(s); }, style: S.btnActDanger }, '回收'),
                      h('button', { type: 'button', onClick: function (e) { if (e && e.stopPropagation) e.stopPropagation(); setMenuFor(menuFor === s.id ? null : s.id); }, style: S.btnAct, title: '更多' }, '⋮')]
                  : [
                      h('button', { type: 'button', onClick: function () { if (editing === s.id) closeEdit(); else openEdit(s); }, style: S.btnAct }, '编辑'),
                      h('button', { type: 'button', onClick: function () { startRebind(s); }, style: (pending || hostArchived) ? S.btnActPrimary : S.btnAct, title: hostArchived ? '会话已归档，建议交接' : '交接：选会话或自动新建' }, '交接'),
                      hasSession ? h('button', { type: 'button', onClick: function () { doUnbind(s); }, style: S.btnAct }, '解绑') : null,
                      h('button', { type: 'button', onClick: function () { doArchiveScene(s); }, style: S.btnActDanger }, '归档'),
                      h('button', { type: 'button', onClick: function (e) { if (e && e.stopPropagation) e.stopPropagation(); setMenuFor(menuFor === s.id ? null : s.id); }, onMouseDown: function () { startDragTimer(s); }, onMouseUp: cancelDragTimer, style: S.btnAct, title: '更多 / 长按拖动' }, '⋮')])),
            menuFor === s.id
              ? h('div', { style: S.menu, 'data-wb-menu': '1', onMouseDown: function (e) { if (e && e.stopPropagation) e.stopPropagation(); } },
                  h('button', { type: 'button', onClick: function () { setMenuFor(null); doExportScene(s); }, style: S.menuItem }, '导出快照'),
                  h('button', { type: 'button', onClick: function () { setMenuFor(null); openRoleCard(s); }, style: S.menuItem }, '打开角色卡'),
                  h('button', { type: 'button', onClick: function () { setMenuFor(null); copyText(s.sessionId || s.id); }, style: S.menuItem }, '复制会话 id'))
              : null,
            rebindFor === s.id ? handoverForm(s) : null,
            editing === s.id && !archived ? editFormView(s) : null);
        }
        function handoverForm(s) {
          return h('div', { style: S.form },
            h('div', { style: S.formTitle }, '交接：' + (s.name || s.id)),
            h('div', { style: S.hint }, '默认沿用原工作区；可改。写 sessions.jsonl handover → 发 seed（摘要+三步）。'),
            h('div', { style: S.grid2 },
              fieldRow('工作区（cwd）', h('select', { value: rebindCwd || '', onChange: function (e) { setRebindCwd(e.target.value); }, style: S.input },
                h('option', { value: '' }, '— 沿用默认/原工作区 —'),
                ((workspacesData && (workspacesData.items || workspacesData.workspaces)) || []).map(function (w) { var p = String((w && (w.cwd || w.path || w.id)) || ''); return h('option', { key: p, value: p }, (w && (w.name || w.title) ? (w.name || w.title) + ' · ' : '') + p); }))),
              fieldRow('会话', h('select', { value: rebindAuto ? '__auto' : (rebindSession || ''), onChange: function (e) { var v = e.target.value; if (v === '__auto') { setRebindAuto(true); setRebindSession(''); } else { setRebindAuto(false); setRebindSession(v); } }, style: S.input },
                h('option', { value: '' }, '— 选未绑定会话 —'),
                h('option', { value: '__auto' }, '自动新建会话'),
                ((sessionsData && sessionsData.unbound) || []).map(function (x) { return h('option', { key: x.sessionId, value: x.sessionId }, sessLabel(x)); })))),
            !rebindAuto ? fieldRow('或手填 sessionId（外部兜底）', h('input', { type: 'text', value: rebindSession || '', placeholder: '外部 host 不可用时手填', onChange: function (e) { setRebindSession(e.target.value); }, style: S.input })) : null,
            h('div', { style: S.row },
              h('button', { type: 'button', onClick: function () { setPreviewOpen(!previewOpen); if (!previewOpen) { api('POST', '/scene/handover-preview', { id: s.id }).then(function (j) { if (j && j.ok) setPreviewData(j); else setScenesErr('预览失败：' + errOf(j)); }).catch(function (e) { setScenesErr('预览失败：' + msg(e)); }); } }, style: S.btnMini }, previewOpen ? '收起接力摘要预览' : '展开接力摘要预览'),
              h('button', { type: 'button', onClick: function () { doRebind(s.id); }, style: S.btn }, '确认交接'),
              h('button', { type: 'button', onClick: closeRebind, style: S.btnMini }, '取消')),
            previewOpen
              ? h('div', { style: S.note },
                  previewData && previewData.ok
                    ? h('div', null,
                        h('div', null, '职责：' + ((previewData.card && previewData.card.mission) || '（card 未写）')),
                        h('div', null, '在做：' + ((previewData.summary && previewData.summary.doing) || '（未写）')),
                        h('div', null, '下一步：' + ((previewData.summary && previewData.summary.next) || '（未写）')),
                        h('div', null, 'open 单：' + ((previewData.openOrders || []).join(', ') || '无单即收')),
                        h('pre', { style: { whiteSpace: 'pre-wrap', maxHeight: '180px', overflow: 'auto', fontSize: '11.5px', margin: '6px 0 0' } }, previewData.text || ''))
                    : h('span', { style: S.hint }, '加载预览…'))
              : null);
        }
        var renderSection = function (sec) {
          var col = !!collapsed[sec.key] && groupEditing !== sec.key;
          return h('div', { key: sec.key, style: Object.assign({}, S.sec, dragOverGroup === sec.gid ? S.dropGroup : (dragState ? S.dragOver : null)), onMouseUp: function () { dropToGroup(sec.gid); }, onMouseOver: function (e) { if (dragState) setDragOverGroup(sec.gid || ''); }, onMouseLeave: function () { setDragOverGroup(null); } },
            h('div', { style: S.secHead },
              h('button', { type: 'button', onClick: function () { toggleCollapse(sec.key); }, style: S.secTitle },
                (col ? '▸ ' : '▾ ') + sec.name, h('span', { style: S.tag }, sec.members.length + ' 个')),
              sec.group
                ? h('div', { style: S.actBar },
                    h('button', { type: 'button', onClick: function () { if (groupEditing === sec.key) cancelGroup(); else startEditGroup(sec.group); }, style: S.btnAct }, groupEditing === sec.key ? '收起改组' : '改组'),
                    h('button', { type: 'button', onClick: function () { renameGroupUi(sec.group); }, style: S.btnAct }, '改名'),
                    h('button', { type: 'button', onClick: function () { deleteGroupUi(sec.group); }, style: S.btnAct }, '删除'))
                : h('span', { style: S.hint2, title: sec.note || '' }, sec.note ? (sec.note.length > 12 ? sec.note.slice(0, 12) + '…' : sec.note) : '')),
            col ? null : h('div', { style: S.secBody },
              sec.members.length ? sec.members.map(function (s, i) { return sceneRow(s, sec.gid, i); }) : h('div', { style: S.hint }, '空分组'),
              groupEditing === sec.key ? groupFormView(false) : null));
        };
        return h('div', null,
          h('div', { style: S.scenesHead },
            [['active', '在用'], ['archived', '归档']].map(function (t) {
              var n = t[0] === 'active' ? activeCount : archivedCount;
              return h('button', { key: t[0], type: 'button', onClick: function () { setLifeFilter(t[0]); lsSet('wb.lifeFilter', t[0]); }, style: Object.assign({}, S.tab, lifeFilter === t[0] ? S.tabOn : null) }, t[1] + ' ' + n);
            })),
          h('div', { style: S.row, marginTop: 0 },
            h('input', { type: 'text', value: searchDraft, placeholder: '按场景名/组名搜索', onChange: function (e) { setSearchDraft(e.target.value); }, onKeyDown: function (e) { if (e && e.key === 'Enter') setScenesQuery(searchDraft); }, style: S.searchInput }),
            h('button', { type: 'button', onClick: function () { setScenesQuery(searchDraft); }, style: S.btn }, '搜索')),
          exportInfo && exportInfo.dir
            ? h('div', { style: S.note },
                h('span', null, '已导出：' + exportInfo.dir),
                h('button', { type: 'button', onClick: function () { copyText(exportInfo.dir); }, style: S.btnMini }, '复制路径'),
                h('button', { type: 'button', onClick: function () { api('POST', '/ops/open', { target: 'path', path: exportInfo.dir }).then(function (j) { if (!j || !j.ok) setScenesErr('打开失败：' + errOf(j)); }).catch(function (e) { setScenesErr('打开失败：' + msg(e)); }); }, style: S.btnMini }, '打开目录'))
            : null,
          h('div', { style: S.card },
            h('div', { style: S.between },
              h('div', null, h('div', { style: S.lbl, marginBottom: 0 }, viewingArch ? '归档' : '会话协作')),
              viewingArch
                ? null
                : h('div', { style: S.row, marginTop: 0 },
                    h('button', { type: 'button', onClick: function () { if (newOpen) closeNew(); else openNew(); }, disabled: !!newSaving, style: Object.assign({}, S.btn, (newOpen || newSaving) ? S.btnOff : null) }, newOpen ? '收起新增' : '＋ 新增协作会话'),
                    h('button', { type: 'button', onClick: function () { if (groupEditing === '__new__') cancelGroup(); else startNewGroup(); }, disabled: !!groupSaving, style: S.btnMini }, groupEditing === '__new__' ? '收起分组' : '＋ 新建分组'))),
            !viewingArch && newOpen ? newFormView() : null,
            !viewingArch && groupEditing === '__new__' ? groupFormView(true) : null,
            scenesLoading ? h('div', { style: S.hint }, '加载中…') : null,
            scenesErr ? h('div', { style: S.err }, scenesErr) : null,
            scenesOk ? h('div', { style: S.ok }, scenesOk) : null,
            groupsErr ? h('div', { style: S.err }, groupsErr) : null,
            groupsOk ? h('div', { style: S.ok }, groupsOk) : null,
            !groupsData && !groupsErr && !scenesLoading ? h('div', { style: S.hint }, '分组数据未加载') : null,
            viewingArch
              ? (archFiltered.length ? archFiltered.map(function (s, i) { return sceneRow(s, '', i); }) : h('div', { style: S.hint }, q ? '没有匹配的归档场景' : '还没有归档场景'))
              : sections.map(renderSection)),
          !allList.length && !scenesLoading ? h('div', { style: S.hint }, '还没有协作会话') : null);
      }

      // ---------- ③ 其他设置 ----------
      function otherPanel() {
        var ds = dirState || { busy: false, msg: '', err: '' };
        var busy = noticeSaving || noticeLoading;
        var sc = selfCheckData || {};
        var tr = trashData || { count: 0, bytes: 0 };
        var bk = backupsData || { entries: [], bytes: 0, count: 0, dirs: 0 };
        var evs = eventsData || { bytes: 0, lines: 0 };
        var tp = tempData || { count: 0, files: 0, dirs: 0, bytes: 0 };
        var doc = doctorData || null;
        var P = (opsInfoData && opsInfoData.paths) || {};
        var hasTrash = !!P.trash || Number(tr.count || 0) > 0 || (tr.entries || []).length > 0;
        var hasBackups = !!P.backups || Number(bk.count || 0) > 0 || (bk.entries || []).length > 0;
        var hasTemp = !!P.temp || Number(tp.count || 0) > 0 || Number(tp.files || 0) > 0;
        var diagMismatch = (!P.trash && Number(tr.count || 0) > 0) ? '诊断：ops/info paths.trash=false，但 /ops/trash 返回 ' + (tr.count || 0) + ' 个文件；已按数据展示' : '';
        var fmtWhen = function (sec) { return sec ? fmtTime(sec) : ''; };
        var dChecks = (doc && doc.checks) || [], dTotal = dChecks.length, dFail = doc ? Number(doc.fail || 0) : 0;
        return h('div', null,
          plugInfo && plugInfo.upgradeRequired ? h('div', { style: S.err }, plugInfo.upgradeHint || '插件已更新，需重启加载新版本') : null,
          h('div', { style: S.card },
            h('div', { style: S.between },
              h('div', { style: S.lbl, marginBottom: 0 }, '启动预检'),
              h('button', { type: 'button', onClick: loadDoctor, style: S.btnMini }, doc && doc.loading ? '预检中…' : '重新预检')),
            dChecks.length
              ? h('div', { style: { marginTop: '6px', position: 'relative' }, onMouseEnter: function () { setDocHover(true); }, onMouseLeave: function () { setDocHover(false); } },
                  h('span', { style: Object.assign({}, dFail ? S.errInline : S.ok, { cursor: 'help' }) },
                    dFail ? '✗ 预检 ' + (dTotal - dFail) + '/' + dTotal : '预检通过 ' + dTotal + '/' + dTotal),
                  docHover
                    ? h('div', { style: S.popover },
                        dChecks.map(function (c, i) {
                          return h('div', { key: i, style: S.hint, marginTop: '2px', title: c.detail || '' },
                            h('span', { style: c.status === 'ok' ? S.ok : (c.status === 'warn' ? S.badgeWarn : S.errInline) }, (c.status === 'ok' ? '✓ ' : (c.status === 'warn' ? '⚠ ' : '✗ ')) + c.name),
                            h('span', null, ' · ' + String(c.detail || '').slice(0, 90)));
                        }))
                    : null)
              : h('div', { style: S.hint }, doc && doc.error ? '预检失败：' + doc.error : '读取中…')),
          h('div', { style: S.card },
            h('div', { style: S.lbl }, '引擎端口'),
            h('div', { style: S.hint, marginTop: 0 }, '看板 HTTP / 打开看板 / HTTP 请求统一使用该端口（写 config.enginePort）'),
            h('div', { style: S.row, marginTop: '4px' },
              h('input', { type: 'number', min: 1, max: 65535, value: enginePortInput, placeholder: '如 3083', onChange: function (e) { setEnginePortInput(e.target.value); }, style: Object.assign({}, S.input, { maxWidth: '160px' }) }),
              h('button', { type: 'button', onClick: function () { saveEnginePortAct(false); }, style: S.btnMini }, '保存端口'),
              h('button', { type: 'button', onClick: function () { saveEnginePortAct(true); }, style: S.btnMini }, '自动探测')),
            enginePortMsg ? h('div', { style: S.hint2 }, enginePortMsg) : null),
          h('div', { style: S.card },
            h('div', { style: S.lbl }, '运维'),
            h('div', { style: S.row, marginTop: '4px' },
              h('button', { type: 'button', onClick: runSelfCheck, disabled: !!sc.running, style: Object.assign({}, S.btn, sc.running ? S.btnOff : null) }, sc.running ? '自检中…' : '一键自检'),
              h('button', { type: 'button', onClick: function () { openOpsTarget('board'); }, style: S.btnMini }, '打开看板'),
              h('button', { type: 'button', onClick: function () { openOpsTarget('events'); }, style: S.btnMini }, '打开事件日志目录'),
              h('button', { type: 'button', onClick: function () { copyText(diagText()); }, style: S.btnMini }, '复制诊断信息')),
            sc.running ? h('div', { style: S.hint, marginTop: 0 }, '自检中…（check-gui 可能要几十秒）') : null,
            sc && sc.items
              ? h('div', { style: { marginTop: '8px', position: 'relative' }, onMouseEnter: function () { setSelfHover(true); }, onMouseLeave: function () { setSelfHover(false); } },
                  h('div', { style: S.row, marginTop: 0 },
                    h('span', { style: Object.assign({}, sc.ok ? S.ok : S.errInline, { cursor: 'help' }) }, (sc.ok ? '✓ 通过 ' : '✗ ') + (sc.passed || 0) + '/' + (sc.total || 0) + ' · ' + ((sc.ms || 0) / 1000).toFixed(1) + 's'),
                    h('button', { type: 'button', onClick: function () { copyText(selfCheckText()); }, style: S.btnMini }, '复制结果')),
                  selfHover
                    ? h('div', { style: S.popover },
                        sc.items.map(function (x, i) {
                          return h('div', { key: i, style: S.hint, marginTop: '2px', title: x.out || x.summary || '' },
                            h('span', { style: x.ok ? S.ok : S.errInline }, (x.ok ? '✓ ' : '✗ ') + x.name),
                            h('span', null, ' · ' + (x.ms || 0) + 'ms · ' + String(x.summary || '').slice(0, 60)));
                        }))
                    : null)
              : null,
            opsMsg ? h('div', { style: S.hint2 }, opsMsg) : null),
          h('div', { style: S.card },
            h('div', { style: S.lbl }, '行为预算'),
            h('div', { style: S.hint, marginTop: '10px' }, 'Token 阈值（上下文提醒/交接）'),
            h('label', { style: Object.assign({}, S.row, { cursor: 'pointer', marginTop: '2px' }) },
              h('input', { type: 'checkbox', checked: !!budgetForm.tokenEnabled, onChange: function (e) { setBudgetForm(Object.assign({}, budgetForm, { tokenEnabled: e.target.checked })); } }),
              h('span', null, '启用 token 阈值提醒')),
            h('div', { style: S.grid2 },
              h('label', { style: S.field },
                h('span', { style: S.fieldLbl }, '提醒值'),
                h('input', { type: 'number', min: 0, value: budgetForm.warnContextTokens, onChange: function (e) { setBudgetForm(Object.assign({}, budgetForm, { warnContextTokens: e.target.value })); }, style: S.input })),
              h('label', { style: S.field },
                h('span', { style: S.fieldLbl }, '交接值'),
                h('input', { type: 'number', min: 0, value: budgetForm.contextThresholdTokens, onChange: function (e) { setBudgetForm(Object.assign({}, budgetForm, { contextThresholdTokens: e.target.value })); }, style: S.input }))),
            h('div', { style: S.row, marginTop: '4px' },
              h('button', { type: 'button', onClick: saveToken, style: S.btn }, '保存'),
              budgetMsg ? h('span', { style: Object.assign({}, S.hint2, { marginLeft: '4px' }) }, budgetMsg) : null)),
          h('div', { style: S.card },
            h('div', { style: S.lbl }, '超时催办'),
            h('div', { style: S.hint, marginTop: 0 }, '超时自动催办 · 阈值 1~1440 分钟'),
            h('label', { style: Object.assign({}, S.row, { cursor: 'pointer' }) },
              h('input', { type: 'checkbox', checked: !!noticeEnabled, onChange: function (e) { setNoticeEnabled(e.target.checked); setNoticeOk(''); } }),
              h('span', null, noticeEnabled ? '已开启自动催办' : '已关闭自动催办')),
            h('label', { style: S.field },
              h('span', { style: S.fieldLbl }, '阈值（分钟）'),
              h('input', { type: 'number', min: 1, max: 1440, value: noticeMinutes, onChange: function (e) { setNoticeMinutes(e.target.value); setNoticeOk(''); }, style: Object.assign({}, S.input, { maxWidth: '180px' }) })),
            h('div', { style: S.row },
              h('button', { type: 'button', onClick: saveNotice, disabled: busy, style: Object.assign({}, S.btn, busy ? S.btnOff : null) },
                noticeSaving ? '保存中…' : '保存'),
              noticeLoading ? h('span', { style: S.hint2 }, '加载中…') : null),
            noticeErr ? h('div', { style: S.err }, noticeErr) : null,
            noticeOk ? h('div', { style: S.ok }, noticeOk) : null),
          h('div', { style: S.card },
            h('div', { style: S.lbl }, '自动索引'),
            h('div', { style: S.hint, marginTop: 0, title: '改 外壳\\scenarios\\*.json 后 1 秒内自动 sync-registry + gen-index；失败只写 events\\auto-index.log，不打断保存' }, '索引自动更新 ⓘ'),
            h('div', { style: S.hint, marginTop: 0 }, '手动兜底：node 工具\\gen\\gen-index.mjs')),
          h('div', { style: S.card },
            h('button', { type: 'button', onClick: function () { setAdvOpen(!advOpen); }, style: Object.assign({}, S.btnMini, { marginBottom: '2px' }) }, (advOpen ? '▾ ' : '▸ ') + '高级 · 数据清理'),
            advOpen ? h('div', null,
              h('div', { style: S.field },
                h('span', { style: S.fieldLbl }, '回收站'),
                hasTrash ? h('div', { style: S.hint, marginTop: 0 }, (tr.items != null ? tr.items : ((tr.count || 0) + (tr.dirs || 0))) + ' 个条目（' + (tr.count || 0) + ' 文件 / ' + (tr.dirs || 0) + ' 目录）· ' + kb(tr.bytes || 0)) : h('div', { style: S.hint, marginTop: 0 }, '暂无'),
                hasTrash && (tr.entries || []).length ? h('div', { style: S.checks },
                  tr.entries.slice(0, 10).map(function (e) {
                    return h('label', { key: e.name, style: S.check, onContextMenu: function (ev) { ev.preventDefault(); setCtxMenu({ x: ev.clientX, y: ev.clientY, kind: 'trash', name: e.name, dir: e.dir }); } },
                      h('input', { type: 'checkbox', checked: (selTrash || []).indexOf(e.name) >= 0, onChange: function () { toggleTrash(e.name); } }),
                      h('span', { title: e.name }, String(e.name).slice(0, 46) + (e.dir ? '\\' : '') + ' · ' + (e.dir ? '目录' : kb(e.bytes)) + ' · ' + fmtWhen(e.mtime)));
                  })) : null,
                hasTrash ? h('div', { style: S.row, marginTop: '2px' },
                  h('button', { type: 'button', onClick: deleteTrashAct, disabled: !(selTrash || []).length, style: Object.assign({}, S.btnMini, !(selTrash || []).length ? S.btnOff : null) }, '删除选中'),
                  h('button', { type: 'button', onClick: clearTrashAct, style: S.btnMini }, '一键清空')) : null,
                diagMismatch ? h('div', { style: S.hint, marginTop: 0 }, diagMismatch) : null),
              h('div', { style: S.field },
                h('span', { style: S.fieldLbl }, '备份'),
                hasBackups ? h('div', { style: S.hint, marginTop: 0 }, (bk.count || 0) + ' 个文件 / ' + kb(bk.bytes || 0) + ' · ' + ((bk.entries || []).length) + ' 项') : h('div', { style: S.hint, marginTop: 0 }, '暂无'),
                hasBackups && (bk.entries || []).length ? h('div', { style: S.checks },
                  (bk.entries || []).slice(0, 12).map(function (e) {
                    return h('label', { key: e.name, style: S.check, onContextMenu: function (ev) { ev.preventDefault(); setCtxMenu({ x: ev.clientX, y: ev.clientY, kind: 'backups', name: e.name, dir: e.dir }); } },
                      h('input', { type: 'checkbox', checked: selBackups.indexOf(e.name) >= 0, onChange: function () { toggleBackup(e.name); } }),
                      h('span', { title: e.name }, String(e.name).slice(0, 40) + ' · ' + (e.dir ? '目录' : kb(e.bytes)) + ' · ' + fmtWhen(e.mtime)));
                  })) : null,
                hasBackups ? h('div', { style: S.row },
                  h('button', { type: 'button', onClick: deleteBackupsAct, style: S.btnMini }, '删除选中（进回收站）')) : null),
              h('div', { style: S.field },
                h('span', { style: S.fieldLbl }, '临时'),
                hasTemp ? h('div', { style: S.hint, marginTop: 0 }, (tp.count || 0) + ' 个顶层项 · ' + (tp.files || 0) + ' 文件 / ' + kb(tp.bytes || 0) + '（不含 trash）') : h('div', { style: S.hint, marginTop: 0 }, '暂无'),
                hasTemp ? h('div', { style: S.row },
                  h('button', { type: 'button', onClick: cleanTempAct, style: S.btnMini }, '清理（进回收站）')) : null),
              h('div', { style: S.field },
                h('span', { style: S.fieldLbl }, '事件流（events.jsonl）'),
                h('div', { style: S.hint, marginTop: 0 }, evs.lines ? (kb(evs.bytes || 0) + ' · ' + (evs.lines || 0) + ' 行') : '暂无'),
                h('div', { style: S.row, marginTop: '2px' },
                  h('input', { type: 'number', min: 0, value: eventsKeep, onChange: function (e) { setEventsKeep(e.target.value); }, style: Object.assign({}, S.input, { maxWidth: '120px' }) }),
                  h('button', { type: 'button', onClick: trimEventsAct, style: S.btnMini }, '清理旧行（保留最近 N 行）'))))
              : null));
      }

      return h('div', { style: S.wrap },
        h('div', { style: S.h1 }, '会话协作'),
        h('div', { style: S.tabs }, TABS.map(function (t) {
          var on = tab === t.id;
          return h('button', { key: t.id, type: 'button', onClick: function () { setTab(t.id); lsSet('wb.tab', t.id); }, style: Object.assign({}, S.tab, on ? S.tabOn : null) }, (i18nData && i18nData['tabs.' + t.id]) || t.label);
        })),
        tab === 'rules' ? rulesPanel() : null,
        tab === 'scenes' ? scenesPanel() : null,
        tab === 'other' ? otherPanel() : null,
        h('style', null, '.wb-ctx-menu{position:fixed;z-index:100000;min-width:150px;max-width:240px;background:var(--card,#1b1f2a);border:1px solid var(--line,#3a4152);border-radius:8px;padding:4px;box-shadow:0 10px 28px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:2px;overflow:hidden}'),
        ctxMenu ? (function () {
          var mw = 170, mh = ctxMenu.dir ? 40 : 76;
          var pos = placeMenu(ctxMenu.x, ctxMenu.y, mw, mh, window.innerWidth || 800, window.innerHeight || 600);
          var node = h('div', { className: 'wb-ctx-menu', style: { left: pos.left + 'px', top: pos.top + 'px' } },
            ctxMenu.dir
              ? h('button', { type: 'button', style: S.btnMini, onClick: function () { openItem(ctxMenu.kind, ctxMenu.name, 'dir'); } }, '打开目录')
              : [h('button', { key: 'f', type: 'button', style: S.btnMini, onClick: function () { openItem(ctxMenu.kind, ctxMenu.name, 'file'); } }, '打开文件'),
                 h('button', { key: 'd', type: 'button', style: S.btnMini, onClick: function () { openItem(ctxMenu.kind, ctxMenu.name, 'dir'); } }, '打开所在目录')]);
          return createPortal ? createPortal(node, document.body) : node;
        })() : null,
        h('div', { style: S.hint, title: '数据源：' + API + '；只改数据文件，不改引擎与外壳代码' }, '只改数据文件'),
        inlineConfirm
          ? h('div', { style: S.confirmBar },
              h('span', null, inlineConfirm.text),
              h('button', { type: 'button', onClick: runInlineConfirm, style: S.btnMini }, '确认'),
              h('button', { type: 'button', onClick: closeInlineConfirm, style: S.btnMini }, '取消'))
          : null);
    }

    exports.name = 'workbench-scene-collab-client';
    exports.inject = ['slots'];
    exports.apply = function (ctx) {
      try { installNavIconPatch(); } catch (e) { /* 图标补丁失败不影响设置页 */ }
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          { name: 'settings.section', id: 'workbench-scene-collab', order: 66, label: function () { return '会话协作'; } },
          Section,
        );
      });
    };
    return module.exports;
  },
});
