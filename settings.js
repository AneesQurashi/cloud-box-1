/* ==========================================================================
   settings.js — dashboard metrics + settings screen
   ========================================================================== */

(function () {
  "use strict";

  var U = CB.utils;
  var state = CB.state;

  /* ---------- theme ---------- */
  function applyTheme(mode) {
    var theme = mode || localStorage.getItem(CB.KEYS.theme) || "system";
    var resolved = theme;
    if (theme === "system") {
      resolved = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", resolved);
    localStorage.setItem(CB.KEYS.theme, theme);
    var sel = U.$("#setting-theme");
    if (sel) sel.value = theme;
  }

  /* ---------- screens ---------- */
  function openScreen(name) {
    var el = name === "settings" ? U.$("#settings-screen") : U.$("#dashboard-screen");
    if (!el) return;
    if (name === "settings") fillSettings();
    else renderDashboard();
    el.classList.remove("hidden");
  }
  function closeScreens() {
    U.$("#settings-screen").classList.add("hidden");
    U.$("#dashboard-screen").classList.add("hidden");
  }

  /* ---------- dashboard ---------- */
  function renderDashboard() {
    var items = state.items;
    var live = items.filter(function (i) { return !i.trashed; });
    var files = live.filter(function (i) { return i.kind === "file"; });
    var trashed = items.filter(function (i) { return i.trashed; });
    var shared = live.filter(function (i) { return !!i.shareId; });

    U.$("#stat-files").textContent = files.length.toLocaleString();
    U.$("#stat-used").textContent = U.formatBytes(state.usage.used);
    U.$("#stat-shares").textContent = shared.length.toLocaleString();
    U.$("#stat-trash").textContent = trashed.length + (trashed.length === 1 ? " item" : " items");

    var quota = state.usage.quota || CB.QUOTA_BYTES;
    var pct = Math.min(100, quota ? state.usage.used / quota * 100 : 0);
    U.$("#stat-quota-bar").style.width = pct + "%";

    // breakdown
    var totals = {};
    var grand = 0;
    files.forEach(function (f) {
      var cat = f.type || U.categoryOf(f.name, f.mime);
      totals[cat] = (totals[cat] || 0) + (f.size || 0);
      grand += (f.size || 0);
    });
    var box = U.$("#storage-breakdown");
    box.innerHTML = "";
    var cats = Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; });
    if (!cats.length) {
      box.appendChild(U.el("p", { class: "muted", text: "No files yet — upload something to see your storage breakdown." }));
    }
    cats.forEach(function (cat) {
      var meta = CB.CATEGORIES[cat] || CB.CATEGORIES.other;
      var share = grand ? (totals[cat] / grand * 100) : 0;
      box.appendChild(U.el("div", { class: "bd-row" }, [
        U.el("span", { text: meta.label }),
        U.el("div", { class: "bd-bar" }, [U.el("i", { style: "width:" + share + "%;background:" + meta.color })]),
        U.el("span", { text: U.formatBytes(totals[cat]) + " · " + share.toFixed(0) + "%" })
      ]));
    });

    // recent uploads
    var recent = files.slice().sort(function (a, b) {
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    }).slice(0, 6);
    var list = U.$("#recent-uploads");
    list.innerHTML = "";
    if (!recent.length) list.appendChild(U.el("p", { class: "muted", text: "Nothing uploaded yet." }));
    recent.forEach(function (f) {
      var cat = f.type || U.categoryOf(f.name, f.mime);
      list.appendChild(U.el("div", { class: "mini-item" }, [
        U.el("span", { html: U.iconSvg(cat, 22, cat), style: "display:flex" }),
        U.el("div", { class: "mi-name", text: f.name }),
        U.el("span", { class: "mi-sub", text: U.formatBytes(f.size) }),
        U.el("span", { class: "mi-sub", text: U.timeAgo(f.createdAt) }),
        U.el("button", { class: "icon-btn", title: "Download", html: "&#8681;", onclick: function () { CB.files.download(f); } })
      ]));
    });
  }

  /* ---------- settings ---------- */
  function fillSettings() {
    if (!state.user) return;
    U.$("#setting-name").value = state.user.name || "";
    U.$("#setting-email").textContent = state.user.email || "";
    U.$("#setting-theme").value = localStorage.getItem(CB.KEYS.theme) || "system";
    U.$("#setting-layout").value = localStorage.getItem(CB.KEYS.layout) || state.layout;
  }

  function init() {
    applyTheme();

    U.$$("[data-close-overlay]").forEach(function (b) { b.addEventListener("click", closeScreens); });
    CB.bus.on("openScreen", openScreen);
    CB.bus.on("items", function () {
      if (!U.$("#dashboard-screen").classList.contains("hidden")) renderDashboard();
    });
    CB.bus.on("usage", function () {
      if (!U.$("#dashboard-screen").classList.contains("hidden")) {
        U.$("#stat-used").textContent = U.formatBytes(state.usage.used);
        var quota = state.usage.quota || CB.QUOTA_BYTES;
        U.$("#stat-quota-bar").style.width = Math.min(100, quota ? state.usage.used / quota * 100 : 0) + "%";
      }
    });

    U.$("#save-profile").addEventListener("click", function () {
      var name = U.$("#setting-name").value.trim();
      if (!name) return CB.toast({ type: "error", message: "Display name can't be empty." });
      CB.backend.updateName(name).then(function (user) {
        state.user = user;
        CB.bus.emit("user", user);
        CB.toast({ type: "success", message: "Profile updated." });
      }).catch(function (err) { CB.toast({ type: "error", message: err.message }); });
    });

    U.$("#setting-theme").addEventListener("change", function (e) {
      applyTheme(e.target.value);
      CB.toast({ type: "success", message: "Theme updated." });
    });

    U.$("#setting-layout").addEventListener("change", function (e) {
      state.layout = e.target.value;
      localStorage.setItem(CB.KEYS.layout, state.layout);
      CB.bus.emit("navigate");
      CB.toast({ type: "success", message: "Default view updated." });
    });

    U.$("#change-password").addEventListener("click", function () {
      if (!state.user.email) return;
      CB.backend.sendResetPassword(state.user.email).then(function () {
        CB.toast({ type: "success", title: "Email sent", message: "Check " + state.user.email + " for a reset link." });
      }).catch(function (err) { CB.toast({ type: "error", message: err.message }); });
    });

    U.$("#delete-account").addEventListener("click", function () {
      CB.files.confirm("Delete your account?",
        "This permanently deletes every file, folder and share link you own. This cannot be undone.",
        "Delete my account", function () {
          CB.toast({ type: "info", title: "Deleting account", message: "Removing your data…", duration: 0 });
          CB.backend.deleteAccount().then(function () {
            closeScreens();
            CB.toast({ type: "success", message: "Account deleted." });
          }).catch(function (err) {
            CB.toast({ type: "error", title: "Could not delete account", message: err.message });
          });
        });
    });

    var mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    if (mq && mq.addEventListener) {
      mq.addEventListener("change", function () {
        if ((localStorage.getItem(CB.KEYS.theme) || "system") === "system") applyTheme("system");
      });
    }
  }

  CB.settings = { init: init, openScreen: openScreen, closeScreens: closeScreens, applyTheme: applyTheme };
})();
