/* ==========================================================================
   state.js — central app state, event bus and toast notifications
   ========================================================================== */

(function () {
  "use strict";

  /* ---------- event bus ---------- */
  var listeners = {};
  var bus = {
    on: function (evt, fn) {
      (listeners[evt] = listeners[evt] || []).push(fn);
      return function off() { bus.off(evt, fn); };
    },
    off: function (evt, fn) {
      var arr = listeners[evt];
      if (!arr) return;
      var i = arr.indexOf(fn);
      if (i > -1) arr.splice(i, 1);
    },
    emit: function (evt, payload) {
      (listeners[evt] || []).slice().forEach(function (fn) {
        try { fn(payload); } catch (e) { console.error("[bus:" + evt + "]", e); }
      });
    }
  };

  /* ---------- app state ---------- */
  var state = {
    user: null,                 // { uid, email, name, photoURL }
    items: [],                  // all files + folders for the user
    view: "files",              // files | recent | shared | starred | trash
    folderId: null,             // active folder (null = root)
    folderStack: [],            // breadcrumb path [{id,name}]
    typeFilter: null,           // image|video|audio|document|pdf|archive|code
    search: "",
    sort: "date-desc",
    layout: localStorage.getItem(CB.KEYS.layout) || "grid",
    selection: new Set(),
    uploads: [],                // upload queue entries
    currentFolderPicker: null,  // target picked in the move dialog
    usage: { used: 0, quota: CB.QUOTA_BYTES },
    ready: false
  };

  /* ---------- derived helpers ---------- */
  function byId(id) {
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
    return null;
  }

  function childrenOf(folderId) {
    return state.items.filter(function (it) {
      return (it.folderId || null) === (folderId || null);
    });
  }

  function visibleItems() {
    var items = state.items;
    var q = state.search.trim().toLowerCase();

    if (state.view === "trash") {
      items = items.filter(function (i) { return i.trashed; });
    } else {
      items = items.filter(function (i) { return !i.trashed; });
    }

    if (state.view === "files" && !q) {
      items = items.filter(function (i) { return (i.folderId || null) === (state.folderId || null); });
    }
    if (state.view === "starred") items = items.filter(function (i) { return i.starred; });
    if (state.view === "shared") items = items.filter(function (i) { return !!i.shareId; });
    if (state.view === "recent") {
      items = items.filter(function (i) { return i.kind === "file"; });
    }
    if (state.typeFilter) {
      items = items.filter(function (i) {
        return i.kind === "file" && (i.type || CB.utils.categoryOf(i.name, i.mime)) === state.typeFilter;
      });
    }
    if (q) {
      items = items.filter(function (i) {
        if (i.name.toLowerCase().indexOf(q) !== -1) return true;
        // match files inside folders too when searching globally
        if (state.view !== "files" && i.folderId) {
          var f = byId(i.folderId);
          return f && f.name.toLowerCase().indexOf(q) !== -1;
        }
        return false;
      });
    }
    return sortItems(items);
  }

  function sortItems(items) {
    var mode = state.sort;
    var dir = mode.indexOf("-desc") > -1 ? -1 : 1;
    var key = mode.split("-")[0];
    var out = items.slice();
    out.sort(function (a, b) {
      // folders always float to the top in the file browser
      if (state.view === "files" && (a.kind === "folder") !== (b.kind === "folder")) {
        return a.kind === "folder" ? -1 : 1;
      }
      var av, bv;
      if (key === "name") {
        av = a.name.toLowerCase(); bv = b.name.toLowerCase();
        return av.localeCompare(bv) * dir;
      }
      if (key === "size") {
        av = a.size || 0; bv = b.size || 0;
        return (av - bv) * dir;
      }
      av = new Date(a.updatedAt || a.createdAt || 0).getTime();
      bv = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return (av - bv) * dir;
    });
    return out;
  }

  function recomputeUsage() {
    var used = state.items.reduce(function (sum, it) {
      if (it.trashed || it.kind !== "file") return sum;
      return sum + (Number(it.size) || 0);
    }, 0);
    state.usage.used = used;
    state.usage.quota = (state.user && state.user.quotaBytes) || CB.QUOTA_BYTES;
    bus.emit("usage", state.usage);
  }

  function folderPath(folderId) {
    var path = [];
    var guard = 0;
    var cur = folderId ? byId(folderId) : null;
    while (cur && guard++ < 64) {
      path.unshift(cur);
      cur = cur.folderId ? byId(cur.folderId) : null;
    }
    return path;
  }

  function isDescendant(candidateId, ancestorId) {
    var cur = candidateId ? byId(candidateId) : null;
    var guard = 0;
    while (cur && guard++ < 64) {
      if (cur.folderId === ancestorId) return true;
      cur = cur.folderId ? byId(cur.folderId) : null;
    }
    return false;
  }

  /* ---------- toasts ---------- */
  var toastBox = null;
  function toast(opts) {
    if (typeof opts === "string") opts = { message: opts };
    if (!toastBox) toastBox = CB.utils.$("#toast-container");
    if (!toastBox) return;
    var type = opts.type || "info";
    var node = CB.utils.el("div", { class: "toast " + type }, [
      CB.utils.el("div", { class: "t-body" }, [
        opts.title ? CB.utils.el("strong", { text: opts.title }) : null,
        CB.utils.el("small", { text: opts.message || "" })
      ]),
      CB.utils.el("button", { class: "t-close", html: "&times;", onclick: remove })
    ]);
    function remove() {
      node.classList.add("out");
      setTimeout(function () { node.remove(); }, 210);
    }
    toastBox.appendChild(node);
    var ms = opts.duration == null ? (type === "error" ? 6000 : 3600) : opts.duration;
    if (ms > 0) setTimeout(remove, ms);
    return { close: remove };
  }

  CB.bus = bus;
  CB.state = state;
  CB.store = {
    byId: byId,
    childrenOf: childrenOf,
    visibleItems: visibleItems,
    sortItems: sortItems,
    recomputeUsage: recomputeUsage,
    folderPath: folderPath,
    isDescendant: isDescendant
  };
  CB.toast = toast;
})();
