/* ==========================================================================
   app.js — bootstrap: wires every module together and starts the app
   ========================================================================== */

(function () {
  "use strict";

  var U = CB.utils;

  function boot() {
    // Order matters — each module attaches its own listeners.
    CB.folders.init();
    CB.files.init();
    CB.upload.init();
    CB.preview.init();
    CB.share.init();
    CB.share.initPublic();
    CB.views.init();
    CB.settings.init();

    // Keyboard shortcuts
    U.$$(".modal").forEach(function (m) {
      m.addEventListener("mousedown", function (e) {
        if (e.target.classList.contains("modal-backdrop")) m.classList.add("hidden");
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        U.$$(".modal:not(.hidden)").forEach(function (m) { m.classList.add("hidden"); });
        if (CB.settings) CB.settings.closeScreens();
      }
      // Ctrl/Cmd + U → upload
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "u") {
        e.preventDefault();
        U.$("#file-input").click();
      }
    });

    // Guard against the browser navigating away when a file is dropped
    // outside the dedicated drop handling (e.g. on the auth screen).
    window.addEventListener("dragover", function (e) { e.preventDefault(); });
    window.addEventListener("drop", function (e) {
      if (!CB.state.user) { e.preventDefault(); return; }
      // handled by upload.js when over the app
    });

    // Warn if the tab is closed mid-upload
    window.addEventListener("beforeunload", function (e) {
      var busy = CB.state.uploads.some(function (u) { return u.status === "uploading" || u.status === "queued"; });
      if (busy) { e.preventDefault(); e.returnValue = ""; }
    });

    // Go
    CB.auth.start();

    // Nice console hint
    console.log("%cCloudBox", "font-weight:800;font-size:16px;color:#2f6fed", "— " + (CB.backend.mode === "firebase" ? "Firebase mode" : "local demo mode"));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
