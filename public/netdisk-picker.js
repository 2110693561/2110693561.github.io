/*!
 * netdisk-picker.js — 网盘文件选择器（编辑器内嵌）
 * ----------------------------------------------------------------
 * 共享核心：token 解析 + /disk/list 拉取 + 弹窗 UI + window.NetdiskPicker.open(onSelect)。
 * 在 /admin/ 路径下自动激活 Decap CMS 编辑器注入（MutationObserver 检测
 * .cms-editor-visual/.cms-editor-raw，注入「🌐 网盘」浮动按钮，
 * 选文件后 insertAtCursor 插入 {{netdisk 文件名}}）。
 * 纯 JS 无依赖；复用 disk/index.html 的鉴权与握手模式。
 */
(function () {
  "use strict";

  var WORKER = "https://decap-oauth-worker.zhanglingbin.workers.dev";

  // ==================== token 解析（已在 Decap 登录则无需二次登录） ====================
  function getToken() {
    var keys = ["decap-cms-user", "netlify-cms-user"];
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = localStorage.getItem(keys[i]);
        if (!raw) continue;
        var u = JSON.parse(raw);
        if (u && typeof u.token === "string" && u.token) return u.token;
      } catch (e) {}
    }
    try {
      var t = sessionStorage.getItem("disk-admin-token");
      if (t) return t;
    } catch (e) {}
    try {
      var t2 = localStorage.getItem("disk-admin-token");
      if (t2) return t2;
    } catch (e) {}
    return null;
  }

  function clearDiskToken() {
    try { sessionStorage.removeItem("disk-admin-token"); } catch (e) {}
    try { localStorage.removeItem("disk-admin-token"); } catch (e) {}
  }

  // ==================== API 调用 ====================
  function api(path, opts) {
    opts = opts || {};
    var token = getToken();
    if (!token) return Promise.reject(new Error("NO_TOKEN"));
    opts.headers = Object.assign({ Authorization: "Bearer " + token }, opts.headers || {});
    return fetch(WORKER + path, opts).then(function (r) {
      if (r.status === 401) {
        clearDiskToken();
        return Promise.reject(new Error("AUTH_EXPIRED"));
      }
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j && j.error) || "HTTP " + r.status);
        return j;
      });
    });
  }

  // ==================== OAuth 弹窗（复用 Decap 握手） ====================
  function oauthLogin(onDone) {
    var win = window.open(WORKER + "/auth", "githubOAuth", "width=640,height=720");
    if (!win) { alert("浏览器拦截了弹出窗口，请允许本站弹出窗口后重试。"); return; }
    function handler(e) {
      if (e.data === "authorizing:github") { win.postMessage("authorizing:github", "*"); return; }
      if (typeof e.data === "string" && e.data.indexOf("authorization:github:success:") === 0) {
        window.removeEventListener("message", handler);
        try {
          var payload = JSON.parse(e.data.slice("authorization:github:success:".length));
          var t = payload.token;
          try { sessionStorage.setItem("disk-admin-token", t); } catch (e2) {}
          try { localStorage.setItem("disk-admin-token", t); } catch (e2) {}
          if (onDone) onDone();
        } catch (err) {}
      }
    }
    window.addEventListener("message", handler);
    var timer = setInterval(function () {
      if (win.closed) { clearInterval(timer); window.removeEventListener("message", handler); }
    }, 500);
  }

  // ==================== 复制（clipboard + execCommand 降级） ====================
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
    } else { fallbackCopy(text); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }

  function formatSize(s) {
    if (!isFinite(s) || s <= 0) return "0 B";
    if (s < 1024) return s + " B";
    if (s < 1048576) return (s / 1024).toFixed(1) + " KB";
    if (s < 1073741824) return (s / 1048576).toFixed(1) + " MB";
    return (s / 1073741824).toFixed(2) + " GB";
  }

  // ==================== 弹窗 ====================
  var overlay = null;
  var listEl = null;
  var searchEl = null;
  var cache = { files: null, at: 0 };
  var currentCallback = null;

  function ensureModal() {
    if (overlay) return;
    var s = document.createElement("style");
    s.textContent = [
      ".ndp-overlay{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45);font-family:system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}",
      ".ndp-modal{width:min(560px,92vw);max-height:80vh;display:flex;flex-direction:column;background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);overflow:hidden}",
      ".ndp-header{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #e5e8ef}",
      ".ndp-header h3{margin:0 auto 0 0;font-size:15px;color:#1a1f36}",
      ".ndp-search{flex:1;min-width:80px;padding:6px 10px;font-size:13px;border:1px solid #e5e8ef;border-radius:8px;background:#f5f6fa;color:#1a1f36}",
      ".ndp-close{flex:none;width:30px;height:30px;border:none;border-radius:8px;background:transparent;font-size:18px;color:#697089;cursor:pointer}",
      ".ndp-close:hover{background:#eef0f4}",
      ".ndp-list{flex:1;overflow-y:auto;padding:6px 0}",
      ".ndp-row{display:flex;align-items:center;gap:10px;padding:9px 16px;cursor:pointer;border:none;background:transparent;width:100%;text-align:left}",
      ".ndp-row:hover{background:#eef0f4}",
      ".ndp-fname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;color:#1a1f36}",
      ".ndp-fsize{flex:none;color:#697089;font-size:12px;white-space:nowrap}",
      ".ndp-badge{flex:none;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600}",
      ".ndp-badge.on{background:rgba(22,163,74,.12);color:#16a34a}",
      ".ndp-badge.off{background:#eef0f4;color:#697089}",
      ".ndp-footer{display:flex;gap:8px;padding:10px 16px;border-top:1px solid #e5e8ef}",
      ".ndp-footer .btn{padding:6px 14px;font-size:13px;border:1px solid #e5e8ef;border-radius:8px;background:#fff;color:#1a1f36;cursor:pointer}",
      ".ndp-footer .btn:hover{background:#eef0f4}",
      ".ndp-empty{padding:30px 16px;text-align:center;color:#697089;font-size:13px}",
      ".ndp-tip{padding:10px 16px;font-size:12.5px;color:#697089;line-height:1.6}",
      ".ndp-tip a{color:#06a7ff}",
      "html[data-theme='dark'] .ndp-modal{background:#161b24}",
      "html[data-theme='dark'] .ndp-header{border-color:#262d3d}",
      "html[data-theme='dark'] .ndp-header h3{color:#e6ebf4}",
      "html[data-theme='dark'] .ndp-search{background:#232b3a;border-color:#262d3d;color:#e6ebf4}",
      "html[data-theme='dark'] .ndp-close{color:#8b96a8}",
      "html[data-theme='dark'] .ndp-close:hover{background:#232b3a}",
      "html[data-theme='dark'] .ndp-row{color:#e6ebf4}",
      "html[data-theme='dark'] .ndp-row:hover{background:#232b3a}",
      "html[data-theme='dark'] .ndp-fname{color:#e6ebf4}",
      "html[data-theme='dark'] .ndp-fsize{color:#8b96a8}",
      "html[data-theme='dark'] .ndp-badge.off{background:#232b3a;color:#8b96a8}",
      "html[data-theme='dark'] .ndp-footer{border-color:#262d3d}",
      "html[data-theme='dark'] .ndp-footer .btn{background:#161b24;border-color:#262d3d;color:#e6ebf4}",
      "html[data-theme='dark'] .ndp-footer .btn:hover{background:#232b3a}",
      "html[data-theme='dark'] .ndp-empty{color:#8b96a8}",
    ].join("\n");
    document.head.appendChild(s);

    overlay = document.createElement("div");
    overlay.className = "ndp-overlay";
    overlay.innerHTML =
      '<div class="ndp-modal">' +
      '<div class="ndp-header"><h3>🌐 网盘文件选择</h3>' +
      '<input class="ndp-search" type="text" placeholder="搜索文件名…" />' +
      '<button class="ndp-close" type="button" title="关闭">×</button></div>' +
      '<div class="ndp-list"></div>' +
      '<div class="ndp-footer"><button class="btn ndp-refresh" type="button">↻ 刷新</button>' +
      '<button class="btn ndp-cancel" type="button">取消</button></div></div>';
    document.body.appendChild(overlay);
    listEl = overlay.querySelector(".ndp-list");
    searchEl = overlay.querySelector(".ndp-search");

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });
    overlay.querySelector(".ndp-close").addEventListener("click", closeModal);
    overlay.querySelector(".ndp-cancel").addEventListener("click", closeModal);
    overlay.querySelector(".ndp-refresh").addEventListener("click", function () {
      cache.files = null; loadList();
    });
    searchEl.addEventListener("input", function () { renderList(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.style.display === "flex") closeModal();
    });
  }

  function openModal(onSelect) {
    ensureModal();
    currentCallback = onSelect;
    overlay.style.display = "flex";
    searchEl.value = "";
    loadList();
  }

  function closeModal() {
    if (overlay) overlay.style.display = "none";
    currentCallback = null;
  }

  function loadList() {
    if (cache.files && Date.now() - cache.at < 300000) { renderList(); return; }
    listEl.innerHTML = '<div class="ndp-empty">加载中…</div>';
    api("/disk/list").then(function (j) {
      cache.files = j.files || [];
      cache.at = Date.now();
      renderList();
    }).catch(function (e) {
      if (String(e.message) === "NO_TOKEN" || String(e.message) === "AUTH_EXPIRED") {
        showLoginTip(String(e.message) === "AUTH_EXPIRED" ? "登录已过期" : "未检测到登录令牌");
      } else {
        listEl.innerHTML = '<div class="ndp-empty">加载失败：' + (e.message || "") + "</div>";
      }
    });
  }

  function showLoginTip(prefix) {
    listEl.innerHTML =
      '<div class="ndp-tip">' + prefix + "。可直接点「登录网盘」用 GitHub 授权，" +
      "或先在 <a href=\"/admin/disk/\" target=\"_blank\">网盘管理页</a> 登录后再回来。" +
      '<br><br><button class="btn" style="padding:8px 18px;font-size:13px;border:1px solid #e5e8ef;border-radius:8px;background:#1f2937;color:#fff;cursor:pointer" id="ndp-login-btn">登录网盘</button></div>';
    var lb = document.getElementById("ndp-login-btn");
    if (lb) lb.addEventListener("click", function () {
      oauthLogin(function () { loadList(); });
    });
  }

  function renderList() {
    var files = cache.files || [];
    if (!files.length) { listEl.innerHTML = '<div class="ndp-empty">网盘目录为空</div>'; return; }
    var q = searchEl.value.trim().toLowerCase();
    var filtered = q ? files.filter(function (f) { return f.basename.toLowerCase().indexOf(q) >= 0; }) : files;
    if (!filtered.length) { listEl.innerHTML = '<div class="ndp-empty">无匹配文件</div>'; return; }
    listEl.innerHTML = "";
    filtered.forEach(function (f) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "ndp-row";
      row.innerHTML =
        '<span class="ndp-fname" title="' + f.basename + '">' + f.basename + "</span>" +
        '<span class="ndp-fsize">' + formatSize(f.size) + "</span>" +
        '<span class="ndp-badge ' + (f.link ? "on" : "off") + '">' + (f.link ? "已分享" : "待分享") + "</span>";
      row.addEventListener("click", function () {
        if (currentCallback) currentCallback(f.basename);
        closeModal();
      });
      listEl.appendChild(row);
    });
  }

  // ==================== 公开 API ====================
  window.NetdiskPicker = {
    open: function (onSelect) { openModal(onSelect); },
    close: closeModal,
  };

  // ==================== insertAtCursor ====================
  function insertAtCursor(el, text) {
    if (!el) return false;
    el.focus();
    if (el.isContentEditable || el.contentEditable === "true") {
      var before = el.textContent;
      var ok = false;
      try { ok = document.execCommand("insertText", false, text); } catch (e) {}
      if (ok && el.textContent !== before) return true;
      // 降级：复制 + 提示
      copyText(text);
      toast("已复制嵌入代码，请将光标放在目标位置后 Ctrl+V 粘贴");
      return false;
    }
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      var start = el.selectionStart, end = el.selectionEnd;
      var val = el.value;
      var beforeText = val.slice(0, start);
      el.value = beforeText + text + val.slice(end);
      el.selectionStart = el.selectionEnd = start + text.length;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    copyText(text);
    toast("已复制嵌入代码，请粘贴到目标位置");
    return false;
  }

  function toast(msg) {
    var t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = "position:fixed;left:50%;top:40px;transform:translateX(-50%);z-index:100000;padding:10px 20px;border-radius:8px;background:#1f2937;color:#fff;font-size:13px;font-family:inherit;box-shadow:0 8px 24px rgba(0,0,0,.25)";
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  // ==================== Decap 编辑器注入（仅 /admin/ 路径） ====================
  var lastActiveEditor = null;

  function inAdmin() {
    return /\/admin(\/|$|#)/.test(location.pathname) || /\/admin\//.test(location.pathname);
  }

  // 跟踪当前聚焦的编辑器
  if (inAdmin()) {
    document.addEventListener("focus", function (e) {
      var t = e.target;
      if (!(t instanceof Element)) return;
      var container = t.closest && t.closest(".cms-editor-visual, .cms-editor-raw, [class*='EditorMarkdown']");
      if (container) {
        if (t.isContentEditable || t.tagName === "TEXTAREA") lastActiveEditor = t;
      }
    }, true);
  }

  function ensurePickerButtons() {
    if (!inAdmin()) return;
    var containers = document.querySelectorAll(
      ".cms-editor-visual:not([data-netdisk-picker]), .cms-editor-raw:not([data-netdisk-picker])"
    );
    // 降级：类名不匹配时按 styled component 子串匹配
    if (!containers.length) {
      containers = document.querySelectorAll("#nc-root [class*='EditorMarkdown']:not([data-netdisk-picker])");
    }
    containers.forEach(function (container) {
      container.setAttribute("data-netdisk-picker", "1");
      // 确保容器可定位按钮
      var cs = getComputedStyle(container);
      if (cs.position === "static") container.style.position = "relative";

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ndp-float-btn";
      btn.textContent = "🌐 网盘";
      btn.title = "从网盘选择文件插入";
      // 浮动样式内联（不依赖外部 CSS）
      btn.style.cssText =
        "position:absolute;top:6px;right:8px;z-index:300;padding:3px 12px;font-size:12px;" +
        "border:1px solid var(--border,#e5e8ef);border-radius:999px;background:var(--panel,#fff);" +
        "color:var(--text,#1a1f36);cursor:pointer;font-family:inherit;line-height:1.6;transition:background .14s";
      btn.addEventListener("mouseenter", function () {
        btn.style.background = "var(--accent-soft,#eef0f4)";
      });
      btn.addEventListener("mouseleave", function () {
        btn.style.background = "var(--panel,#fff)";
      });
      btn.addEventListener("mousedown", function (e) {
        // mousedown 不抢焦点，记录当前编辑器
        var container2 = btn.closest(".cms-editor-visual, .cms-editor-raw, [class*='EditorMarkdown']");
        if (container2) {
          var ed = container2.querySelector("[contenteditable='true'], textarea");
          if (ed) lastActiveEditor = ed;
        }
      });
      btn.addEventListener("click", function () {
        if (!getToken()) {
          toast("未登录：请先登录后台，或点这里用 GitHub 授权");
          oauthLogin(function () { openPickerForEditor(); });
          return;
        }
        openPickerForEditor();
      });
      container.appendChild(btn);
    });
  }

  function openPickerForEditor() {
    openModal(function (basename) {
      var token = "{{netdisk " + basename + "}}";
      if (lastActiveEditor) {
        if (!insertAtCursor(lastActiveEditor, token)) {
          // insertAtCursor 已复制并 toast
        }
      } else {
        copyText(token);
        toast("已复制嵌入代码，请粘贴到正文");
      }
    });
  }

  // MutationObserver（200ms 节流，复用 index.html 模式）
  if (inAdmin()) {
    var pending = null;
    var mo = new MutationObserver(function () {
      if (pending) return;
      pending = setTimeout(function () { pending = null; ensurePickerButtons(); }, 200);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    // 首次执行
    ensurePickerButtons();
  }
})();
