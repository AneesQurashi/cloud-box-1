/* ==========================================================================
   files.js — item actions: open, download, rename, star, trash, delete,
               favorite, selection and the right-click context menu
   ========================================================================== */

(function () {
  "use strict";

  var U = CB.utils;
  var state = CB.state;

  /* ---------- tree helpers ---------- */
  function descendantsOf(id) {
    var out = [];
    var guard = 0;
    function walk(parentId) {
      if (guard++ > 5000) return;
      state.items.forEach(function (it) {
        var parent = it.kind === "folder" ? (it.parentId || null) : (it.folderId || null);
        if (parent === parentId) {
          out.push(it);
          if (it.kind === "folder") walk(it.id);
        }
      });
    }
    walk(id);
    return out;
  }

  function subtreeFiles(id) {
    var item = CB.store.byId(id);
    var files = [];
    if (item && item.kind === "file") files.push(item);
    descendantsOf(id).forEach(function (d) { if (d.kind === "file") files.push(d); });
    return files;
  }

  function isFolder(item) { return item && (item.kind === "folder" || item.parentId !== undefined); }

  /* ---------- open ---------- */
  function open(item) {
    if (!item) return;
    if (isFolder(item)) { CB.folders.open(item.id); return; }
    if (CB.preview) CB.preview.show(item);
    else download(item);
  }

  /* ---------- star ---------- */
  function setStar(item, value) {
    var patch = { starred: value == null ? !item.starred : !!value };
    var kind = isFolder(item) ? "folder" : "file";
    CB.backend.updateItem(kind, item.id, patch).catch(function (err) {
      CB.toast({ type: "error", message: "Could not update star: " + err.message });
    });
  }

  /* ---------- rename ---------- */
  function rename(item) {
    CB.folders.promptName("Rename", function (name) {
      if (!name || name === item.name) return;
      var kind = isFolder(item) ? "folder" : "file";
      CB.backend.updateItem(kind, item.id, { name: name })
        .then(function () { CB.toast({ type: "success", message: "Renamed to \"" + name + "\"." }); })
        .catch(function (err) { CB.toast({ type: "error", message: err.message }); });
    }, item.name);
  }

  /* ---------- trash / restore / delete ---------- */
  function trash(ids) {
    var targets = collect(ids);
    var ops = [];
    targets.forEach(function (item) {
      var kind = item.kind;
      ops.push(CB.backend.updateItem(kind, item.id, { trashed: true }));
    });
    return Promise.all(ops).then(function () {
      CB.toast({ type: "success", message: targets.length + (targets.length === 1 ? " item" : " items") + " moved to trash." });
      state.selection.clear();
      CB.bus.emit("selection");
    });
  }

  function restore(ids) {
    var targets = collect(ids);
    return Promise.all(targets.map(function (item) {
      return CB.backend.updateItem(item.kind, item.id, { trashed: false });
    })).then(function () {
      CB.toast({ type: "success", message: targets.length + " restored." });
      state.selection.clear();
      CB.bus.emit("selection");
    });
  }

  function deleteForever(ids) {
    var targets = collect(ids);
    var label = targets.length === 1 ? '"' + targets[0].name + '"' : targets.length + " items";
    confirmDialog("Delete permanently?", "“" + label + "” will be removed forever. This can’t be undone.", "Delete forever", function () {
      var ops = targets.map(function (item) {
        if (item.kind === "file" && item.storagePath) {
          return CB.backend.deleteBlob(item.storagePath).then(function () { return CB.backend.deleteItem("file", item.id); });
        }
        return CB.backend.deleteItem(item.kind, item.id);
      });
      // also drop any share docs
      targets.forEach(function (item) {
        if (item.shareId) ops.push(CB.backend.deleteShare(item.shareId).catch(function () {}));
      });
      Promise.all(ops).then(function () {
        CB.toast({ type: "success", message: "Deleted " + label + "." });
        state.selection.clear();
        CB.bus.emit("selection");
      }).catch(function (err) {
        CB.toast({ type: "error", title: "Delete failed", message: err.message });
      });
    });
  }

  function emptyTrash() {
    var trashed = state.items.filter(function (i) { return i.trashed; });
    if (!trashed.length) return;
    confirmDialog("Empty trash?", "All " + trashed.length + " items in the trash will be permanently deleted.", "Empty trash", function () {
      // delete only roots of the trash forest
      var trashedIds = trashed.map(function (i) { return i.id; });
      var roots = trashed.filter(function (i) {
        var parent = i.kind === "folder" ? i.parentId : i.folderId;
        return !parent || trashedIds.indexOf(parent) === -1;
      });
      var ops = [];
      trashed.forEach(function (item) {
        if (item.kind === "file" && item.storagePath) ops.push(CB.backend.deleteBlob(item.storagePath));
        ops.push(CB.backend.deleteItem(item.kind, item.id));
        if (item.shareId) ops.push(CB.backend.deleteShare(item.shareId).catch(function () {}));
      });
      Promise.all(ops).then(function () {
        CB.toast({ type: "success", message: "Trash emptied." });
      });
    });
  }

  /* Expand a selection to include descendant folders/files so operations are consistent. */
  function collect(ids) {
    var seen = {};
    var out = [];
    ids.forEach(function (id) {
      var item = CB.store.byId(id);
      if (!item) return;
      if (!seen[item.id]) { seen[item.id] = true; out.push(item); }
      if (item.kind === "folder") {
        descendantsOf(item.id).forEach(function (d) {
          if (!seen[d.id]) { seen[d.id] = true; out.push(d); }
        });
      }
    });
    return out;
  }

  /* ---------- download ---------- */
  function download(item) {
    if (!item) return;
    if (isFolder(item)) { downloadFolder(item); return; }
    var t = CB.toast({ type: "info", title: "Preparing download", message: item.name, duration: 0 });
    CB.backend.getBlob(item).then(function (blob) {
      t.close();
      U.saveBlobToDisk(blob, item.name);
    }).catch(function (err) {
      t.close();
      CB.toast({ type: "error", title: "Download failed", message: err.message });
    });
  }

  function downloadFolder(folder) {
    var files = subtreeFiles(folder.id);
    if (!files.length) { CB.toast({ type: "info", message: "This folder is empty." }); return; }
    CB.toast({ type: "info", title: "Downloading folder", message: files.length + " files…" });
    files.reduce(function (chain, f) {
      return chain.then(function () {
        return CB.backend.getBlob(f).then(function (blob) {
          U.downloadBlob(blob, f.name);
          return U.sleep(320);
        }).catch(function (err) { CB.toast({ type: "error", message: f.name + ": " + err.message }); });
      });
    }, Promise.resolve()).then(function () {
      CB.toast({ type: "success", message: "Folder download started (" + files.length + " files)." });
    });
  }

  function downloadMany(ids) {
    var items = ids.map(function (id) { return CB.store.byId(id); }).filter(Boolean);
    var files = [];
    items.forEach(function (it) {
      if (isFolder(it)) subtreeFiles(it.id).forEach(function (f) { files.push(f); });
      else files.push(it);
    });
    if (!files.length) return;
    CB.toast({ type: "info", title: "Downloading", message: files.length + " files…" });
    files.reduce(function (chain, f) {
      return chain.then(function () {
        return CB.backend.getBlob(f).then(function (blob) { U.downloadBlob(blob, f.name); return U.sleep(320); })
          .catch(function (err) { CB.toast({ type: "error", message: f.name + ": " + err.message }); });
      });
    }, Promise.resolve());
  }

  /* ---------- selection ---------- */
  function toggleSelect(id, value) {
    if (value == null) {
      if (state.selection.has(id)) state.selection.delete(id); else state.selection.add(id);
    } else if (value) state.selection.add(id);
    else state.selection.delete(id);
    CB.bus.emit("selection");
  }
  function clearSelection() { state.selection.clear(); CB.bus.emit("selection"); }

  /* ---------- copy / share ---------- */
  function copyName(item) {
    U.copyText(item.name).then(function () { CB.toast({ type: "success", message: "Name copied." }); });
  }

  /* ---------- context menu ---------- */
  var ctxEl = null;
  function closeContext() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } }

  function openContext(item, x, y) {
    closeContext();
    var folder = isFolder(item);
    var items = [];

    function add(label, icon, fn, danger) {
      items.push(U.el("button", { class: "ctx-item" + (danger ? " danger" : ""), onclick: function (e) { e.stopPropagation(); closeContext(); fn(); } }, [
        U.el("span", { html: U.iconSvg(icon, 17), style: "display:flex" }),
        U.el("span", { text: label })
      ]));
    }
    function sep() { items.push(U.el("div", { class: "ctx-sep" })); }

    if (!folder) {
      add("Preview", "info", function () { open(item); });
      add("Download", "download", function () { download(item); });
      add("Share", "share", function () { CB.share.open(item); });
      sep();
    } else {
      add("Open", "folder", function () { CB.folders.open(item.id); });
      add("Download folder", "download", function () { download(item); });
      sep();
    }

    if (state.view === "trash") {
      add("Restore", "restore", function () { restore([item.id]); });
      add("Delete forever", "trash", function () { deleteForever([item.id]); }, true);
    } else {
      add(item.starred ? "Remove star" : "Add star", "star", function () { setStar(item, !item.starred); });
      add("Rename", "rename", function () { rename(item); });
      add("Move to…", "move", function () { CB.folders.openMoveDialog([item.id]); });
      add("Copy name", "copy", function () { copyName(item); });
      sep();
      add("Move to trash", "trash", function () { trash([item.id]); }, true);
    }

    ctxEl = U.el("div", { class: "ctx-menu", role: "menu" }, items);
    document.body.appendChild(ctxEl);

    var rect = ctxEl.getBoundingClientRect();
    var px = Math.min(x, window.innerWidth - rect.width - 8);
    var py = Math.min(y, window.innerHeight - rect.height - 8);
    ctxEl.style.left = Math.max(8, px) + "px";
    ctxEl.style.top = Math.max(8, py) + "px";
  }

  /* ---------- confirm dialog ---------- */
  function confirmDialog(title, text, confirmLabel, onConfirm) {
    var existing = U.$("#confirm-modal");
    if (existing) existing.remove();
    var panel = U.el("div", { class: "modal", id: "confirm-modal" }, [
      U.el("div", { class: "modal-backdrop", onclick: close }),
      U.el("div", { class: "modal-panel modal-xs" }, [
        U.el("div", { class: "modal-head" }, [U.el("div", { class: "modal-title" }, [U.el("strong", { text: title })])]),
        U.el("div", { class: "modal-body" }, [U.el("p", { class: "muted", text: text })]),
        U.el("div", { class: "modal-foot" }, [
          U.el("button", { class: "btn btn-ghost", text: "Cancel", onclick: close }),
          U.el("button", { class: "btn btn-primary danger-fill", text: confirmLabel, onclick: function () { close(); onConfirm(); } })
        ])
      ])
    ]);
    function close() { panel.remove(); }
    document.body.appendChild(panel);
  }

  /* ---------- init ---------- */
  function init() {
    document.addEventListener("click", closeContext);
    document.addEventListener("scroll", closeContext, true);
    window.addEventListener("blur", closeContext);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeContext(); CB.folders.hideModal("#move-modal"); }

      // Backspace navigates up a folder, unless typing in a field
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (e.key === "Backspace" && state.view === "files" && state.folderId && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
        CB.folders.up();
      }
      // Delete sends selection to trash
      if (e.key === "Delete" && state.selection.size && state.view !== "trash") {
        trash(Array.from(state.selection));
      }
    });

    // selection bar actions
    U.$$("[data-bulk]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var ids = Array.from(state.selection);
        if (!ids.length) return;
        var action = btn.dataset.bulk;
        if (action === "download") downloadMany(ids);
        if (action === "move") CB.folders.openMoveDialog(ids);
        if (action === "trash") trash(ids);
        if (action === "star") {
          Promise.all(ids.map(function (id) { var it = CB.store.byId(id); if (it) return CB.backend.updateItem(it.kind, id, { starred: true }); }))
            .then(function () { CB.toast({ type: "success", message: "Added to starred." }); state.selection.clear(); CB.bus.emit("selection"); });
        }
      });
    });
    U.$("#clear-selection").addEventListener("click", clearSelection);

    U.$("#select-all").addEventListener("change", function (e) {
      var visible = CB.store.visibleItems();
      if (e.target.checked) visible.forEach(function (i) { state.selection.add(i.id); });
      else state.selection.clear();
      CB.bus.emit("selection");
    });
  }

  CB.files = {
    init: init,
    open: open,
    setStar: setStar,
    rename: rename,
    trash: trash,
    restore: restore,
    deleteForever: deleteForever,
    emptyTrash: emptyTrash,
    download: download,
    downloadMany: downloadMany,
    toggleSelect: toggleSelect,
    clearSelection: clearSelection,
    openContext: openContext,
    collect: collect,
    descendantsOf: descendantsOf,
    subtreeFiles: subtreeFiles,
    isFolder: isFolder,
    confirm: confirmDialog
  };
})();
