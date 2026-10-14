/* ==========================================================================
   folders.js — create folders, breadcrumb navigation, move dialog
   ========================================================================== */

(function () {
  "use strict";

  var U = CB.utils;
  var state = CB.state;

  /* ---------- create ---------- */
  function createFolder(parentId) {
    var parent = parentId !== undefined ? parentId : (state.view === "files" ? state.folderId : null);
    promptInlineName("New folder", function (name) {
      if (!name) return;
      var siblings = CB.store.childrenOf(parent).filter(function (i) { return i.kind === "folder"; })
        .map(function (i) { return i.name.toLowerCase(); });
      if (siblings.indexOf(name.toLowerCase()) !== -1) name = U.uniqueName(name, siblings);

      CB.backend.createFolder({ name: name, parentId: parent || null })
        .then(function () { CB.toast({ type: "success", message: 'Folder "' + name + '" created.' }); })
        .catch(function (err) { CB.toast({ type: "error", title: "Could not create folder", message: err.message }); });
    });
  }

  /* A small inline prompt using the modal shell for a nicer look than window.prompt */
  function promptInlineName(title, onDone, initial) {
    var existing = U.$("#name-modal");
    if (existing) existing.remove();

    var input = U.el("input", { class: "input", type: "text", value: initial || "", placeholder: "Name", maxlength: "120" });
    var panel = U.el("div", { class: "modal", id: "name-modal" }, [
      U.el("div", { class: "modal-backdrop", onclick: function () { done(null); } }),
      U.el("div", { class: "modal-panel modal-xs" }, [
        U.el("div", { class: "modal-head" }, [
          U.el("div", { class: "modal-title" }, [U.el("strong", { text: title })]),
          U.el("button", { class: "icon-btn big", html: "&times;", onclick: function () { done(null); } })
        ]),
        U.el("div", { class: "modal-body" }, [input]),
        U.el("div", { class: "modal-foot" }, [
          U.el("button", { class: "btn btn-ghost", text: "Cancel", onclick: function () { done(null); } }),
          U.el("button", { class: "btn btn-primary", text: "Save", onclick: function () { done(input.value); } })
        ])
      ])
    ]);
    function done(value) {
      panel.remove();
      onDone(value == null ? null : String(value).trim());
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); done(input.value); }
      if (e.key === "Escape") done(null);
    });
    document.body.appendChild(panel);
    setTimeout(function () { input.focus(); input.select(); }, 30);
  }

  /* ---------- navigation ---------- */
  function openFolder(id) {
    var folder = CB.store.byId(id);
    if (!folder) return;
    state.folderId = id;
    state.view = "files";
    state.typeFilter = null;
    state.selection.clear();
    state.folderStack = CB.store.folderPath(id);
    CB.bus.emit("navigate");
  }

  function goTo(level) {
    // level: -1 root, otherwise folder id
    if (level === -1 || level == null) {
      state.folderId = null;
      state.folderStack = [];
    } else {
      openFolder(level);
      return;
    }
    state.selection.clear();
    CB.bus.emit("navigate");
  }

  function up() {
    if (!state.folderId) return;
    var cur = CB.store.byId(state.folderId);
    goTo(cur && cur.folderId ? cur.folderId : -1);
  }

  /* ---------- move dialog ---------- */
  var moveTarget = null;
  var moveIds = [];

  function openMoveDialog(ids) {
    moveIds = ids.slice();
    moveTarget = state.view === "files" ? state.folderId : null;
    renderPicker();
    U.$("#move-count").textContent = moveIds.length === 1
      ? '"' + (CB.store.byId(moveIds[0]) || {}).name + '"'
      : moveIds.length + " items";
    showModal("#move-modal");
  }

  function renderPicker() {
    var box = U.$("#folder-picker");
    box.innerHTML = "";

    function row(id, label, depth, disabled) {
      var btn = U.el("button", {
        class: "fp-item" + ((moveTarget || null) === (id || null) ? " active" : ""),
        disabled: disabled || false
      }, [
        U.el("span", { html: U.iconSvg("folder", 18), style: "display:flex" }),
        U.el("span", { text: label })
      ]);
      btn.style.paddingLeft = (11 + depth * 18) + "px";
      if (!disabled) btn.addEventListener("click", function () { moveTarget = id; renderPicker(); });
      return btn;
    }

    box.appendChild(row(null, "My Files (root)", 0, false));

    var folders = state.items.filter(function (i) { return i.kind === "folder" && !i.trashed; });
    var children = {};
    folders.forEach(function (f) {
      var parent = f.folderId || f.parentId || null;
      (children[parent] = children[parent] || []).push(f);
    });

    function walk(parentId, depth) {
      (children[parentId] || []).sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (f) {
        // cannot move an item into itself or one of its descendants
        var isSelf = moveIds.indexOf(f.id) !== -1;
        var insideSelection = moveIds.some(function (id) { return CB.store.isDescendant(f.id, id) || f.id === id; });
        box.appendChild(row(f.id, f.name, depth, isSelf || insideSelection));
        walk(f.id, depth + 1);
      });
    }
    walk(null, 1);
  }

  function confirmMove() {
    var ids = moveIds.slice();
    var target = moveTarget;
    hideModal("#move-modal");
    if (!ids.length) return;

    Promise.all(ids.map(function (id) {
      var item = CB.store.byId(id);
      if (!item) return null;
      if (item.kind === "folder") {
        // prevent cycles
        if (id === target || CB.store.isDescendant(target, id)) return null;
        return CB.backend.updateItem("folder", id, { parentId: target || null });
      }
      return CB.backend.updateItem("file", id, { folderId: target || null });
    })).then(function () {
      var dest = target ? (CB.store.byId(target) || {}).name : "My Files";
      CB.toast({ type: "success", message: ids.length + (ids.length === 1 ? " item moved" : " items moved") + " to " + dest + "." });
      state.selection.clear();
      CB.bus.emit("selection");
    }).catch(function (err) {
      CB.toast({ type: "error", title: "Move failed", message: err.message });
    });
  }

  /* ---------- tiny modal helpers (shared) ---------- */
  function showModal(sel) { var m = U.$(sel); if (m) m.classList.remove("hidden"); }
  function hideModal(sel) { var m = U.$(sel); if (m) m.classList.add("hidden"); }

  function init() {
    U.$("#new-folder-btn").addEventListener("click", function () { createFolder(); });
    U.$("#move-confirm").addEventListener("click", confirmMove);
    CB.bus.on("back", up);
  }

  CB.folders = {
    init: init,
    create: createFolder,
    open: openFolder,
    goTo: goTo,
    up: up,
    openMoveDialog: openMoveDialog,
    promptName: promptInlineName,
    showModal: showModal,
    hideModal: hideModal
  };
})();
