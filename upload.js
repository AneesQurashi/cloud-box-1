/* ==========================================================================
   upload.js — upload queue, drag & drop, folder uploads, progress dock
   ========================================================================== */

(function () {
  "use strict";

  var U = CB.utils;
  var state = CB.state;

  var dock = null, dockBody = null;
  var dragDepth = 0;

  /* ---------- queue entry ---------- */
  function newEntry(file, folderId) {
    return {
      id: "up_" + U.uid(10),
      file: file,
      name: file.name,
      size: file.size,
      folderId: folderId || null,
      status: "queued",     // queued | uploading | paused | done | error | cancelled
      progress: 0,
      error: null,
      task: null
    };
  }

  /* ---------- public: add files ---------- */
  function addFiles(fileList, opts) {
    opts = opts || {};
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;

    var targetFolder = opts.folderId !== undefined ? opts.folderId : (state.view === "files" ? state.folderId : null);

    // quota guard
    var totalIncoming = files.reduce(function (s, f) { return s + f.size; }, 0);
    var remaining = state.usage.quota - state.usage.used;
    if (totalIncoming > remaining) {
      var over = totalIncoming - remaining;
      CB.toast({
        type: "error",
        title: "Not enough storage",
        message: "You need " + U.formatBytes(over) + " more space. Upgrade your plan or remove files.",
        duration: 8000
      });
      return;
    }

    var tooBig = files.filter(function (f) { return f.size > CB.LIMITS.maxFileBytes; });
    if (tooBig.length) {
      files = files.filter(function (f) { return f.size <= CB.LIMITS.maxFileBytes; });
      CB.toast({ type: "warn", title: "Skipped " + tooBig.length + " file(s)", message: "Files over " + U.formatBytes(CB.LIMITS.maxFileBytes) + " are not supported." });
    }

    var entries = files.map(function (f) { return newEntry(f, targetFolder); });
    state.uploads = state.uploads.concat(entries);
    renderDock();
    pump();
  }

  /* ---------- public: folder upload (webkitRelativePath) ---------- */
  function addFolder(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var baseId = state.view === "files" ? state.folderId : null;

    // Build a folder tree map from webkitRelativePath values.
    var tree = {}; // path -> {file}
    files.forEach(function (f) {
      tree[f.webkitRelativePath || f.name] = f;
    });

    var createdMap = {}; // "parentId/pathKey" -> folderId

    function ensureFolders(parts, parentId, index) {
      if (index >= parts.length) return Promise.resolve(parentId);
      var key = (parentId || "root") + "/" + parts.slice(0, index + 1).join("/");
      if (createdMap[key]) return Promise.resolve(createdMap[key]);
      // does it already exist?
      var existing = state.items.filter(function (i) {
        return i.kind === "folder" && !i.trashed &&
          (i.folderId || i.parentId || null) === (parentId || null) &&
          i.name.toLowerCase() === parts[index].toLowerCase();
      })[0];
      if (existing) { createdMap[key] = existing.id; return Promise.resolve(existing.id); }
      return CB.backend.createFolder({ name: parts[index], parentId: parentId || null }).then(function (rec) {
        createdMap[key] = rec.id;
        return rec.id;
      });
    }

    var jobs = Object.keys(tree).map(function (relPath) {
      var parts = relPath.split("/");
      var fileName = parts.pop();
      var file = tree[relPath];
      file = new File([file], fileName, { type: file.type, lastModified: file.lastModified });
      return ensureFolders(parts, baseId, 0).then(function (folderId) {
        var e = newEntry(file, folderId);
        state.uploads.push(e);
        return e;
      });
    });

    Promise.all(jobs).then(function () {
      renderDock();
      pump();
      CB.toast({ type: "info", title: "Folder upload", message: files.length + " files queued." });
    }).catch(function (err) {
      CB.toast({ type: "error", title: "Folder upload failed", message: err.message });
    });
  }

  /* ---------- queue pump ---------- */
  function pump() {
    var active = state.uploads.filter(function (e) { return e.status === "uploading"; }).length;
    var slots = CB.LIMITS.concurrentUploads - active;
    if (slots <= 0) return;
    var queued = state.uploads.filter(function (e) { return e.status === "queued"; }).slice(0, slots);
    queued.forEach(startUpload);
    if (!queued.length) maybeFinish();
  }

  function existingNamesIn(folderId) {
    return state.items.filter(function (i) {
      return !i.trashed && (i.folderId || i.parentId || null) === (folderId || null);
    }).map(function (i) { return i.name; });
  }

  function startUpload(entry) {
    entry.status = "uploading";
    entry.error = null;
    renderDock();

    // name clash handling
    var names = existingNamesIn(entry.folderId);
    var finalName = U.uniqueName(entry.name, names);
    entry.finalName = finalName;

    var task;
    try {
      task = CB.backend.upload(entry.file, {
        onProgress: function (pct) {
          entry.progress = pct;
          updateEntry(entry);
        }
      });
    } catch (err) {
      return fail(entry, err);
    }
    entry.task = task;

    task.promise.then(function () {
      var mime = entry.file.type || "application/octet-stream";
      return CB.backend.createFileDoc({
        name: finalName,
        mime: mime,
        size: entry.file.size,
        type: U.categoryOf(finalName, mime),
        folderId: entry.folderId,
        storagePath: task.storagePath
      });
    }).then(function () {
      entry.status = "done";
      entry.progress = 100;
      updateEntry(entry);
      CB.bus.emit("uploadDone", entry);
      maybeFinish();
    }).catch(function (err) {
      if (entry.status === "cancelled") { updateEntry(entry); return; }
      fail(entry, err);
    });
  }

  function fail(entry, err) {
    entry.status = "error";
    entry.error = (err && err.message) || "Upload failed";
    updateEntry(entry);
    CB.toast({ type: "error", title: "Upload failed: " + entry.name, message: entry.error });
    maybeFinish();
  }

  /* ---------- dock rendering ---------- */
  function ensureDock() {
    if (!dock) {
      dock = U.$("#upload-dock");
      dockBody = U.$("#dock-body");
      U.$("#dock-close").addEventListener("click", function () {
        // hide only finished/errored items; keep active ones
        state.uploads = state.uploads.filter(function (e) { return e.status === "uploading" || e.status === "queued" || e.status === "paused"; });
        renderDock();
      });
      U.$("#dock-pause-all").addEventListener("click", togglePauseAll);
    }
  }

  function renderDock() {
    ensureDock();
    var list = state.uploads;
    if (!list.length) { dock.classList.add("hidden"); return; }
    dock.classList.remove("hidden");

    var active = list.filter(function (e) { return e.status === "uploading" || e.status === "queued"; }).length;
    var paused = list.filter(function (e) { return e.status === "paused"; }).length;
    var done = list.filter(function (e) { return e.status === "done"; }).length;
    var failed = list.filter(function (e) { return e.status === "error"; }).length;

    U.$("#dock-title").textContent =
      active ? "Uploading " + active + " file" + (active === 1 ? "" : "s") :
      paused ? paused + " paused" :
      failed ? failed + " failed" : done + " upload" + (done === 1 ? "" : "s") + " complete";

    U.$("#dock-pause-all").textContent = paused && !active ? "Resume all" : "Pause all";

    var totalBytes = list.reduce(function (s, e) { return s + e.size; }, 0);
    var sentBytes = list.reduce(function (s, e) { return s + (e.size * (e.progress / 100)); }, 0);
    U.$("#dock-summary").textContent = U.formatBytes(sentBytes) + " of " + U.formatBytes(totalBytes) + " · " + done + "/" + list.length + " done";
    U.$("#dock-progress-bar").style.width = (totalBytes ? (sentBytes / totalBytes * 100) : 0) + "%";

    dockBody.innerHTML = "";
    list.forEach(function (e) {
      var sub, cls = "dock-item";
      if (e.status === "done") { sub = "Uploaded"; cls += " done"; }
      else if (e.status === "error") { sub = e.error; cls += " error"; }
      else if (e.status === "paused") { sub = "Paused · " + U.formatBytes(e.size); }
      else if (e.status === "queued") { sub = "Waiting · " + U.formatBytes(e.size); }
      else { sub = U.formatBytes(e.size * e.progress / 100) + " of " + U.formatBytes(e.size) + " · " + e.progress + "%"; }

      var cat = U.categoryOf(e.name, e.file && e.file.type);
      var node = U.el("div", { class: cls, dataset: { id: e.id } }, [
        U.el("span", { html: U.iconSvg(cat, 20, cat), style: "display:flex" }),
        U.el("div", { class: "dock-item-info" }, [
          U.el("div", { class: "dock-item-name", text: e.name }),
          U.el("div", { class: "dock-item-sub", text: sub }),
          U.el("div", { class: "dock-bar" }, [U.el("i", { style: "width:" + e.progress + "%" })])
        ]),
        statusActions(e)
      ]);
      dockBody.appendChild(node);
    });
  }

  function statusActions(e) {
    var wrap = U.el("div", { style: "display:flex;gap:2px" });
    if (e.status === "uploading") {
      wrap.appendChild(U.el("button", { class: "icon-btn", title: "Pause", html: "&#10073;&#10073;", style: "font-size:11px", onclick: function () { pauseEntry(e); } }));
      wrap.appendChild(U.el("button", { class: "icon-btn", title: "Cancel", html: "&times;", onclick: function () { cancelEntry(e); } }));
    } else if (e.status === "paused") {
      wrap.appendChild(U.el("button", { class: "icon-btn", title: "Resume", html: "&#9654;", style: "font-size:12px", onclick: function () { resumeEntry(e); } }));
      wrap.appendChild(U.el("button", { class: "icon-btn", title: "Cancel", html: "&times;", onclick: function () { cancelEntry(e); } }));
    } else if (e.status === "queued") {
      wrap.appendChild(U.el("button", { class: "icon-btn", title: "Cancel", html: "&times;", onclick: function () { cancelEntry(e); } }));
    } else if (e.status === "error") {
      wrap.appendChild(U.el("button", { class: "icon-btn", title: "Retry", html: "&#8635;", onclick: function () { retryEntry(e); } }));
      wrap.appendChild(U.el("button", { class: "icon-btn", title: "Dismiss", html: "&times;", onclick: function () { removeEntry(e); } }));
    } else {
      wrap.appendChild(U.el("button", { class: "icon-btn", title: "Dismiss", html: "&times;", onclick: function () { removeEntry(e); } }));
    }
    return wrap;
  }

  function updateEntry(e) {
    var node = dockBody && dockBody.querySelector('[data-id="' + e.id + '"]');
    if (node) {
      var sub = node.querySelector(".dock-item-sub");
      if (sub) {
        if (e.status === "done") sub.textContent = "Uploaded";
        else if (e.status === "error") sub.textContent = e.error;
        else if (e.status === "paused") sub.textContent = "Paused";
        else sub.textContent = U.formatBytes(e.size * e.progress / 100) + " of " + U.formatBytes(e.size) + " · " + e.progress + "%";
      }
      var bar = node.querySelector(".dock-bar i");
      if (bar) bar.style.width = e.progress + "%";
      node.className = "dock-item" + (e.status === "done" ? " done" : e.status === "error" ? " error" : "");
      var actions = node.lastChild;
      node.replaceChild(statusActions(e), actions);
    } else {
      renderDock();
      return;
    }
    // update footer totals cheaply
    var list = state.uploads;
    var totalBytes = list.reduce(function (s, x) { return s + x.size; }, 0);
    var sentBytes = list.reduce(function (s, x) { return s + (x.size * (x.progress / 100)); }, 0);
    U.$("#dock-summary").textContent = U.formatBytes(sentBytes) + " of " + U.formatBytes(totalBytes) + " · " +
      list.filter(function (x) { return x.status === "done"; }).length + "/" + list.length + " done";
    U.$("#dock-progress-bar").style.width = (totalBytes ? (sentBytes / totalBytes * 100) : 0) + "%";
  }

  function pauseEntry(e) {
    if (e.task && e.task.pause) e.task.pause();
    e.status = "paused";
    updateEntry(e);
    maybeFinish();
  }
  function resumeEntry(e) {
    if (e.task && e.task.resume) { e.task.resume(); e.status = "uploading"; updateEntry(e); }
    else { e.status = "queued"; retryEntry(e); }
  }
  function cancelEntry(e) {
    e.status = "cancelled";
    if (e.task && e.task.cancel) { try { e.task.cancel(); } catch (err) {} }
    removeEntry(e);
  }
  function retryEntry(e) {
    e.status = "queued";
    e.progress = 0;
    e.error = null;
    renderDock();
    pump();
  }
  function removeEntry(e) {
    state.uploads = state.uploads.filter(function (x) { return x.id !== e.id; });
    renderDock();
    maybeFinish();
  }
  function togglePauseAll() {
    var active = state.uploads.filter(function (e) { return e.status === "uploading"; });
    var paused = state.uploads.filter(function (e) { return e.status === "paused"; });
    if (active.length) { active.forEach(pauseEntry); }
    else { paused.forEach(resumeEntry); pump(); }
    renderDock();
  }

  function maybeFinish() {
    var busy = state.uploads.some(function (e) { return e.status === "uploading" || e.status === "queued"; });
    if (!busy) {
      var done = state.uploads.filter(function (e) { return e.status === "done"; }).length;
      if (done) CB.toast({ type: "success", title: "Upload complete", message: done + (done === 1 ? " file uploaded." : " files uploaded.") });
      setTimeout(function () {
        state.uploads = state.uploads.filter(function (e) { return e.status !== "done"; });
        renderDock();
      }, 2600);
    } else {
      pump();
    }
  }

  /* ---------- drag & drop ---------- */
  function currentTargetLabel() {
    if (state.view !== "files") return "to My Files";
    var f = state.folderId ? CB.store.byId(state.folderId) : null;
    return "to " + (f ? f.name : "My Files");
  }

  function initDragDrop() {
    var overlay = U.$("#drop-overlay");
    var label = U.$("#drop-target-label");

    function hasFiles(e) {
      var dt = e.dataTransfer;
      if (!dt) return false;
      if (dt.types) {
        for (var i = 0; i < dt.types.length; i++) if (dt.types[i] === "Files") return true;
      }
      return false;
    }

    window.addEventListener("dragenter", function (e) {
      if (!CB.state.user || !hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      label.textContent = currentTargetLabel();
      overlay.classList.remove("hidden");
    });
    window.addEventListener("dragover", function (e) {
      if (!CB.state.user || !hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    window.addEventListener("dragleave", function (e) {
      if (!CB.state.user) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) overlay.classList.add("hidden");
    });
    window.addEventListener("drop", function (e) {
      if (!CB.state.user || !hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      overlay.classList.add("hidden");
      if (!e.dataTransfer.files || !e.dataTransfer.files.length) return;
      // detect a dropped folder (items API) — fall back to plain files
      if (e.dataTransfer.items && e.dataTransfer.items.length) {
        var allDirs = true, any = false;
        for (var i = 0; i < e.dataTransfer.items.length; i++) {
          var it = e.dataTransfer.items[i];
          if (it.kind !== "file") continue;
          any = true;
          var entry = it.webkitGetAsEntry && it.webkitGetAsEntry();
          if (!entry || !entry.isDirectory) { allDirs = false; break; }
        }
        if (any && allDirs) {
          walkDataTransfer(e.dataTransfer.items);
          return;
        }
      }
      addFiles(e.dataTransfer.files);
    });

    // Inputs
    U.$("#file-input").addEventListener("change", function (e) {
      addFiles(e.target.files);
      e.target.value = "";
    });
    U.$("#folder-input").addEventListener("change", function (e) {
      addFolder(e.target.files);
      e.target.value = "";
    });

    U.$("#upload-btn").addEventListener("click", function () { U.$("#file-input").click(); });
    U.$("#empty-upload").addEventListener("click", function () { U.$("#file-input").click(); });
  }

  /* Recursively read a dropped directory tree. */
  function walkDataTransfer(items) {
    var baseFolder = state.view === "files" ? state.folderId : null;
    var queue = [];

    function readEntry(entry, parentId) {
      if (entry.isFile) {
        queue.push(new Promise(function (resolve) {
          entry.file(function (file) {
            var e = newEntry(file, parentId);
            state.uploads.push(e);
            resolve();
          }, function () { resolve(); });
        }));
      } else if (entry.isDirectory) {
        queue.push(
          CB.backend.createFolder({ name: entry.name, parentId: parentId || null }).then(function (rec) {
            return readChildren(entry, rec.id);
          })
        );
      }
    }

    function readChildren(dirEntry, parentId) {
      return new Promise(function (resolve) {
        var reader = dirEntry.createReader();
        var all = [];
        function step() {
          reader.readEntries(function (entries) {
            if (!entries.length) {
              Promise.all(all.map(function (en) { return readEntry(en, parentId); })).then(resolve);
              return;
            }
            all = all.concat(Array.prototype.slice.call(entries));
            step();
          }, function () { resolve(); });
        }
        step();
      });
    }

    var roots = [];
    for (var i = 0; i < items.length; i++) {
      var entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
      if (!entry) continue;
      roots.push(readEntry(entry, baseFolder));
    }

    Promise.all(roots.concat(queue)).then(function () {
      renderDock();
      pump();
      CB.toast({ type: "info", title: "Folder drop", message: "Files queued for upload." });
    }).catch(function (err) {
      CB.toast({ type: "error", message: err.message });
    });
  }

  function init() {
    ensureDock();
    initDragDrop();
    CB.bus.on("enterApp", function () {
      state.uploads = [];
      renderDock();
    });
  }

  CB.upload = { init: init, addFiles: addFiles, addFolder: addFolder, renderDock: renderDock };
})();
