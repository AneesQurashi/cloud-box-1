/* ==========================================================================
   views.js — renders the file browser: sidebar, breadcrumbs, toolbar,
               grid / list views, selection bar and quota meters
   ========================================================================== */

(function () {
  "use strict";

  var U = CB.utils;
  var state = CB.state;

  var gridEl, listEl, tbodyEl, emptyEl, crumbsEl, countEl, titleEl;
  var thumbCache = {};
  var observer = null;

  function cache() {
    gridEl = U.$("#grid-view");
    listEl = U.$("#list-view");
    tbodyEl = U.$("#file-tbody");
    emptyEl = U.$("#empty-state");
    crumbsEl = U.$("#crumbs");
    countEl = U.$("#item-count");
    titleEl = U.$("#list-title");
  }

  /* ---------- titles ---------- */
  function viewTitle() {
    if (state.typeFilter) return (CB.CATEGORIES[state.typeFilter] || {}).label || "Files";
    if (state.view === "files") {
      var f = state.folderId ? CB.store.byId(state.folderId) : null;
      return f ? f.name : "My Files";
    }
    return { recent: "Recent", shared: "Shared", starred: "Starred", trash: "Trash" }[state.view] || "Files";
  }

  /* ---------- breadcrumbs ---------- */
  function renderCrumbs() {
    crumbsEl.innerHTML = "";
    crumbsEl.appendChild(U.el("button", {
      class: "crumb" + (state.view === "files" && !state.folderId ? " current" : ""),
      text: "CloudBox", onclick: function () { CB.folders.goTo(-1); }
    }));

    if (state.view !== "files") {
      crumbsEl.appendChild(U.el("span", { class: "crumb-sep", text: "/" }));
      crumbsEl.appendChild(U.el("span", { class: "crumb current", text: viewTitle() }));
      return;
    }
    CB.store.folderPath(state.folderId).forEach(function (f) {
      crumbsEl.appendChild(U.el("span", { class: "crumb-sep", text: "/" }));
      crumbsEl.appendChild(U.el("button", {
        class: "crumb" + (state.folderId === f.id ? " current" : ""),
        text: f.name,
        onclick: function () { CB.folders.open(f.id); }
      }));
    });
  }

  /* ---------- toolbar ---------- */
  function renderToolbar() {
    titleEl.textContent = viewTitle();
    var items = CB.store.visibleItems();
    countEl.textContent = items.length + (items.length === 1 ? " item" : " items");

    U.$$("#view-seg .seg-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.layout === state.layout);
    });
    U.$("#sort-select").value = state.sort;

    // Empty-trash affordance on the trash view
    var bar = U.$(".list-toolbar-right");
    var existing = U.$("#empty-trash-btn");
    if (state.view === "trash" && !existing) {
      bar.insertBefore(U.el("button", { class: "btn btn-ghost danger btn-sm", id: "empty-trash-btn", text: "Empty trash", onclick: function () { CB.files.emptyTrash(); } }), bar.firstChild);
    } else if (state.view !== "trash" && existing) {
      existing.remove();
    }
  }

  /* ---------- selection bar ---------- */
  function renderSelection() {
    var bar = U.$("#selection-bar");
    var n = state.selection.size;
    bar.classList.toggle("hidden", n === 0);
    U.$("#selection-count").textContent = n + " selected";

    // swap the trash action label on the trash view
    var trashBtn = U.$("[data-bulk='trash']");
    if (trashBtn) trashBtn.textContent = state.view === "trash" ? "Delete forever" : "Delete";
    var starBtn = U.$("[data-bulk='star']");
    if (starBtn) starBtn.classList.toggle("hidden", state.view === "trash");

    if (!n) {
      var all = U.$("#select-all");
      if (all) all.checked = false;
    }
  }

  /* ---------- grid ---------- */
  function folderCount(folderId) {
    return state.items.filter(function (i) {
      return !i.trashed && (i.folderId || i.parentId) === folderId;
    }).length;
  }

  function renderGrid(items) {
    gridEl.innerHTML = "";
    items.forEach(function (item) {
      var isFolder = item.kind === "folder";
      var selected = state.selection.has(item.id);

      var check = U.el("input", { class: "card-check", type: "checkbox", onclick: function (e) { e.stopPropagation(); CB.files.toggleSelect(item.id, e.target.checked); } });
      check.checked = selected;

      var star = U.el("button", { class: "card-star" + (item.starred ? " on" : ""), title: item.starred ? "Remove star" : "Add star", onclick: function (e) { e.stopPropagation(); CB.files.setStar(item); } });

      var thumb;
      if (isFolder) {
        thumb = U.el("div", { class: "card-thumb" }, [U.el("span", { html: U.iconSvg("folder", 46), style: "display:flex;color:var(--amber)" })]);
      } else {
        thumb = U.el("div", { class: "card-thumb" });
        var cat = item.type || U.categoryOf(item.name, item.mime);
        if (cat === "image") {
          thumb.appendChild(U.el("img", { alt: "", "data-thumb": item.id }));
          thumb.appendChild(U.el("div", { class: "card-badge", text: U.ext(item.name).toUpperCase() }));
        } else {
          thumb.appendChild(U.el("span", { html: U.iconSvg(cat, 46, cat), style: "display:flex" }));
          var badge = U.ext(item.name).toUpperCase();
          if (badge) thumb.appendChild(U.el("div", { class: "card-badge", text: badge }));
        }
      }

      var sub = isFolder
        ? folderCount(item.id) + " items"
        : U.formatBytes(item.size) + " · " + U.formatDate(item.updatedAt || item.createdAt);

      var card = U.el("div", { class: "card" + (selected ? " selected" : ""), dataset: { id: item.id }, tabindex: "0" }, [
        check, star, thumb,
        U.el("div", { class: "card-meta" }, [
          U.el("div", { class: "card-name" }, [
            U.el("span", { html: U.iconSvg(isFolder ? "folder" : (item.type || U.categoryOf(item.name, item.mime)), 15), style: "display:flex" }),
            U.el("span", { text: item.name, style: "overflow:hidden;text-overflow:ellipsis" })
          ]),
          U.el("div", { class: "card-sub", text: sub })
        ])
      ]);

      card.addEventListener("click", function (e) {
        if (e.target.closest(".card-check") || e.target.closest(".card-star")) return;
        CB.files.open(item);
      });
      card.addEventListener("dblclick", function () { CB.files.open(item); });
      card.addEventListener("contextmenu", function (e) { e.preventDefault(); CB.files.openContext(item, e.clientX, e.clientY); });
      card.addEventListener("keydown", function (e) { if (e.key === "Enter") CB.files.open(item); });

      gridEl.appendChild(card);
    });
    lazyLoadThumbs();
  }

  /* ---------- list ---------- */
  function renderList(items) {
    tbodyEl.innerHTML = "";
    items.forEach(function (item) {
      var isFolder = item.kind === "folder";
      var selected = state.selection.has(item.id);
      var cat = item.type || U.categoryOf(item.name, item.mime);

      var row = U.el("tr", { class: selected ? "selected" : "", dataset: { id: item.id } });

      var check = U.el("input", { type: "checkbox", onclick: function (e) { e.stopPropagation(); CB.files.toggleSelect(item.id, e.target.checked); } });
      check.checked = selected;
      row.appendChild(U.el("td", { class: "col-check" }, [check]));

      row.appendChild(U.el("td", { class: "col-name" }, [
        U.el("div", { class: "td-name" }, [
          U.el("span", { html: U.iconSvg(isFolder ? "folder" : cat, 19, isFolder ? "" : cat), style: "display:flex" }),
          U.el("span", { class: "name-text", text: item.name })
        ])
      ]));

      row.appendChild(U.el("td", { class: "col-owner", text: item.ownerName || "You" }));
      row.appendChild(U.el("td", { class: "col-size", text: isFolder ? folderCount(item.id) + " items" : U.formatBytes(item.size) }));
      row.appendChild(U.el("td", { class: "col-date", text: U.formatDate(item.updatedAt || item.createdAt) }));

      var actions = U.el("div", { class: "td-actions" }, [
        U.el("button", { class: "icon-btn row-star" + (item.starred ? " on" : ""), title: "Star", onclick: function (e) { e.stopPropagation(); CB.files.setStar(item); } }),
        U.el("button", { class: "icon-btn", title: "Download", html: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 4v12m0 0-4-4m4 4 4-4" stroke-linecap="round"/><path d="M5 20h14" stroke-linecap="round"/></svg>', onclick: function (e) { e.stopPropagation(); CB.files.download(item); } }),
        U.el("button", { class: "icon-btn", title: "More", html: "&#8943;", onclick: function (e) { e.stopPropagation(); var r = e.currentTarget.getBoundingClientRect(); CB.files.openContext(item, r.right - 180, r.bottom + 4); } })
      ]);
      row.appendChild(U.el("td", { class: "col-actions" }, [actions]));

      row.addEventListener("click", function (e) {
        if (e.target.closest("input") || e.target.closest(".td-actions")) return;
        CB.files.open(item);
      });
      row.addEventListener("contextmenu", function (e) { e.preventDefault(); CB.files.openContext(item, e.clientX, e.clientY); });

      tbodyEl.appendChild(row);
    });
  }

  /* ---------- lazy image thumbnails ---------- */
  function lazyLoadThumbs() {
    var imgs = U.$$("img[data-thumb]");
    if (!imgs.length) return;
    if (!observer) {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var img = entry.target;
          observer.unobserve(img);
          loadThumb(img, img.dataset.thumb);
          delete img.dataset.thumb;
        });
      }, { rootMargin: "300px" });
    }
    imgs.forEach(function (img) { observer.observe(img); });
  }

  function loadThumb(img, id) {
    if (thumbCache[id]) { img.src = thumbCache[id]; return; }
    var item = CB.store.byId(id);
    if (!item) return;
    CB.backend.getURL(item).then(function (url) {
      thumbCache[id] = url;
      if (img.isConnected) img.src = url;
    }).catch(function () {
      img.replaceWith(U.el("span", { html: U.iconSvg("image", 46, "image"), style: "display:flex" }));
    });
  }

  /* ---------- empty state ---------- */
  function renderEmpty(count) {
    var show = count === 0;
    emptyEl.classList.toggle("hidden", !show);
    gridEl.classList.toggle("hidden", show || state.layout !== "grid");
    listEl.classList.toggle("hidden", show || state.layout !== "list");
    if (!show) return;

    var title = "No files yet", text = "Drag & drop files here, or use the Upload button above.", btn = "Upload files";
    if (state.view === "trash") { title = "Trash is empty"; text = "Items you delete will appear here for a while before being removed."; btn = null; }
    else if (state.view === "starred") { title = "Nothing starred yet"; text = "Star files and folders to find them quickly here."; btn = null; }
    else if (state.view === "shared") { title = "No shared links"; text = "Share a file to generate a public link you can send to anyone."; btn = null; }
    else if (state.view === "recent") { title = "No recent activity"; text = "Uploads you make will show up here."; btn = null; }
    else if (state.search) { title = "No matches"; text = 'Nothing matched "' + state.search + '". Try a different search.'; btn = null; }
    else if (state.typeFilter) { title = "No " + viewTitle().toLowerCase() + " yet"; text = "Files of this type will appear here."; btn = null; }
    else if (state.folderId) { title = "This folder is empty"; text = "Upload files or create a subfolder to get started."; }

    U.$("#empty-title").textContent = title;
    U.$("#empty-text").textContent = text;
    var b = U.$("#empty-upload");
    if (btn) { b.classList.remove("hidden"); b.textContent = btn; }
    else b.classList.add("hidden");
  }

  /* ---------- main render ---------- */
  function render() {
    var items = CB.store.visibleItems();
    renderCrumbs();
    renderToolbar();
    renderSelection();
    renderEmpty(items.length);
    if (items.length) {
      if (state.layout === "grid") renderGrid(items);
      else renderList(items);
    } else {
      gridEl.innerHTML = "";
      tbodyEl.innerHTML = "";
    }
  }

  /* ---------- sidebar ---------- */
  function renderSidebar() {
    U.$$(".side-item[data-view]").forEach(function (b) {
      b.classList.toggle("active", !state.typeFilter && state.view === b.dataset.view);
    });
    U.$$(".side-item[data-type]").forEach(function (b) {
      b.classList.toggle("active", state.typeFilter === b.dataset.type);
    });
  }

  /* ---------- quota ---------- */
  function renderQuota() {
    var used = state.usage.used;
    var quota = state.usage.quota || CB.QUOTA_BYTES;
    var pct = Math.min(100, quota ? (used / quota * 100) : 0);

    U.$("#side-quota-pct").textContent = pct.toFixed(pct < 10 && pct > 0 ? 1 : 0) + "%";
    U.$("#side-quota-bar").style.width = pct + "%";
    U.$("#side-quota-text").textContent = U.formatBytes(used) + " of " + U.formatBytes(quota) + " used";
    U.$("#dd-quota-text").textContent = U.formatBytes(used) + " / " + U.formatBytes(quota);
    U.$("#dd-quota-bar").style.width = pct + "%";

    var bar = U.$("#side-quota-bar");
    bar.style.background = pct > 90
      ? "linear-gradient(90deg,#e5484d,#e0447c)"
      : pct > 70
        ? "linear-gradient(90deg,#e08c0b,#e5484d)"
        : "linear-gradient(90deg,var(--brand),var(--violet))";
  }

  /* ---------- user chip ---------- */
  function renderUser() {
    var u = state.user;
    if (!u) return;
    var initials = U.initials(u.name);
    U.$("#avatar-initials").textContent = initials;
    U.$("#dd-avatar").textContent = initials;
    U.$("#dd-name").textContent = u.name;
    U.$("#dd-email").textContent = u.email || "";
  }

  /* ---------- events ---------- */
  function bind() {
    U.$("#search-input").addEventListener("input", U.debounce(function (e) {
      state.search = e.target.value;
      if (state.search && state.view === "files") {
        // searching should look across all folders — switch to a global slice
      }
      render();
    }, 160));

    U.$("#sort-select").addEventListener("change", function (e) {
      state.sort = e.target.value;
      render();
    });

    U.$$("#view-seg .seg-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        state.layout = b.dataset.layout;
        localStorage.setItem(CB.KEYS.layout, state.layout);
        render();
      });
    });

    U.$$(".side-item[data-view]").forEach(function (b) {
      b.addEventListener("click", function () { setView(b.dataset.view); });
    });
    U.$$(".side-item[data-type]").forEach(function (b) {
      b.addEventListener("click", function () { setType(b.dataset.type); });
    });

    // user dropdown
    var menu = U.$("#user-menu");
    U.$("#avatar-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      U.$("#user-dropdown").classList.toggle("open");
    });
    document.addEventListener("click", function (e) {
      if (menu && !menu.contains(e.target)) U.$("#user-dropdown").classList.remove("open");
    });
    U.$$("#user-dropdown [data-nav]").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        U.$("#user-dropdown").classList.remove("open");
        CB.bus.emit("openScreen", a.dataset.nav);
      });
    });

    U.$("#home-link").addEventListener("click", function (e) { e.preventDefault(); setView("files"); });

    U.$("#menu-toggle").addEventListener("click", function () {
      U.$("#sidebar").classList.toggle("open");
    });
    U.$("#upgrade-btn").addEventListener("click", function () {
      CB.toast({ type: "info", title: "Upgrade storage", message: "Storage plans are not part of this demo." });
    });

    // "/" focuses search
    document.addEventListener("keydown", function (e) {
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        U.$("#search-input").focus();
      }
    });
  }

  function setView(view) {
    state.view = view;
    state.typeFilter = null;
    state.search = "";
    state.selection.clear();
    U.$("#search-input").value = "";
    if (view === "files") { state.folderId = null; state.folderStack = []; }
    U.$("#sidebar").classList.remove("open");
    CB.bus.emit("navigate");
  }

  function setType(type) {
    state.typeFilter = type;
    state.view = "files";
    state.search = "";
    state.selection.clear();
    U.$("#search-input").value = "";
    state.folderId = null;
    U.$("#sidebar").classList.remove("open");
    CB.bus.emit("navigate");
  }

  function init() {
    cache();
    bind();
    CB.bus.on("navigate", function () { renderSidebar(); render(); });
    CB.bus.on("items", function () { render(); });
    CB.bus.on("selection", function () { renderSelection(); refreshSelectionClasses(); });
    CB.bus.on("usage", renderQuota);
    CB.bus.on("user", function () { renderUser(); renderQuota(); });
    CB.bus.on("enterApp", function () {
      renderUser();
      state.layout = localStorage.getItem(CB.KEYS.layout) || state.layout;
      renderSidebar();
      render();
    });
  }

  function refreshSelectionClasses() {
    U.$$(".card").forEach(function (c) {
      c.classList.toggle("selected", state.selection.has(c.dataset.id));
      var chk = c.querySelector(".card-check");
      if (chk) chk.checked = state.selection.has(c.dataset.id);
    });
    U.$$("#file-tbody tr").forEach(function (r) {
      r.classList.toggle("selected", state.selection.has(r.dataset.id));
      var chk = r.querySelector("input");
      if (chk) chk.checked = state.selection.has(r.dataset.id);
    });
  }

  CB.views = { init: init, render: render, renderQuota: renderQuota, renderUser: renderUser, setView: setView, setType: setType };
})();
