/* ==========================================================================
   share.js — share dialog (link, expiry, password, QR) + public share page
   ========================================================================== */

(function () {
  "use strict";

  var U = CB.utils;
  var state = CB.state;

  var current = null;      // item being configured
  var currentShare = null; // share doc
  var qr = null;

  /* ---------- link helpers ---------- */
  function shareURL(id) {
    var base = window.location.origin + window.location.pathname;
    return base + "?share=" + encodeURIComponent(id);
  }

  /* ---------- dialog ---------- */
  function open(item) {
    if (!item) return;
    if (CB.files.isFolder(item)) {
      CB.toast({ type: "info", title: "Folders can't be shared", message: "Open the folder and share individual files." });
      return;
    }
    current = item;
    currentShare = null;
    U.$("#share-item-name").textContent = item.name;
    U.$("#share-enabled").checked = true;
    U.$("#share-password").value = "";
    U.$("#share-expiry").value = "never";
    U.$("#share-link").value = "Loading…";

    CB.folders.showModal("#share-modal");

    if (item.shareId) {
      CB.backend.getShare(item.shareId).then(function (doc) {
        if (!doc) { createShare(null); return; }
        currentShare = doc;
        U.$("#share-enabled").checked = doc.enabled !== false;
        U.$("#share-expiry").value = doc.expiryDays ? String(doc.expiryDays) : "never";
        U.$("#share-link").value = shareURL(doc.id);
        U.$("#share-password").value = "";
        if (doc.passwordHash) U.$("#share-password").placeholder = "Password set — type to replace";
        syncShareUI();
        renderQR(shareURL(doc.id));
      }).catch(function (err) {
        U.$("#share-link").value = "";
        CB.toast({ type: "error", message: "Could not load share: " + err.message });
      });
    } else {
      createShare(null);
    }
  }

  function createShare(extra) {
    var shareId = current.shareId || U.shareId();
    var base = {
      fileId: current.id,
      name: current.name,
      mime: current.mime || "",
      size: current.size || 0,
      type: current.type || U.categoryOf(current.name, current.mime),
      storagePath: current.storagePath || "",
      enabled: true,
      expiresAt: null,
      expiryDays: null,
      passwordHash: null,
      views: 0
    };
    Object.assign(base, extra || {});
    if (current.shareId) {
      return CB.backend.updateShare(shareId, base).then(function () {
        currentShare = Object.assign({ id: shareId }, base);
        return currentShare;
      });
    }
    // Capture a public token URL while we still have owner permissions.
    return CB.backend.resolveDownloadURL(current.storagePath).then(function (url) {
      if (url) base.url = url;
      return CB.backend.createShare(shareId, base);
    }).then(function () {
      currentShare = Object.assign({ id: shareId }, base);
      return CB.backend.updateItem("file", current.id, { shareId: shareId });
    }).then(function () {
      U.$("#share-link").value = shareURL(shareId);
      renderQR(shareURL(shareId));
      syncShareUI();
      CB.toast({ type: "success", message: "Share link created." });
      return currentShare;
    });
  }

  function applyExpiry() {
    var val = U.$("#share-expiry").value;
    var days = val === "never" ? null : Number(val);
    var expiresAt = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
    return { expiryDays: days, expiresAt: expiresAt };
  }

  function applyPassword() {
    var pw = U.$("#share-password").value.trim();
    if (!pw) return null;                 // unchanged / none
    return { passwordHash: U.hash(pw), passwordSet: true };
  }

  function syncShareUI() {
    var enabled = U.$("#share-enabled").checked;
    U.$("#share-settings").style.opacity = enabled ? "1" : ".45";
    U.$("#share-settings").style.pointerEvents = enabled ? "auto" : "none";
  }

  function renderQR(url) {
    var box = U.$("#share-qr");
    box.innerHTML = "";
    var holder = U.el("div");
    box.appendChild(holder);
    box.appendChild(U.el("small", { text: "Scan to open" }));
    if (window.QRCode) {
      qr = new window.QRCode(holder, {
        text: url, width: 128, height: 128,
        colorDark: "#101828", colorLight: "#ffffff",
        correctLevel: window.QRCode.CorrectLevel.M
      });
    } else {
      holder.remove();
      box.lastChild.remove();
    }
  }

  function persist() {
    if (!current) return;
    if (!currentShare) { createShare(Object.assign({}, applyExpiry())); return; }
    var patch = {
      enabled: U.$("#share-enabled").checked
    };
    Object.assign(patch, applyExpiry());
    var pw = applyPassword();
    if (pw) patch.passwordHash = pw.passwordHash;

    CB.backend.updateShare(currentShare.id, patch).then(function () {
      Object.assign(currentShare, patch);
      CB.toast({ type: "success", message: "Share settings saved." });
    }).catch(function (err) { CB.toast({ type: "error", message: err.message }); });
  }

  function stopSharing() {
    if (!currentShare) return;
    var id = currentShare.id;
    var itemId = current.id;
    CB.backend.deleteShare(id)
      .then(function () { return CB.backend.updateItem("file", itemId, { shareId: null }); })
      .then(function () {
        currentShare = null;
        U.$("#share-link").value = "";
        U.$("#share-qr").innerHTML = "";
        CB.toast({ type: "success", message: "Sharing turned off." });
      });
  }

  function init() {
    U.$("#share-enabled").addEventListener("change", function () {
      syncShareUI();
      if (!U.$("#share-enabled").checked && currentShare) stopSharing();
      else persist();
    });
    U.$("#share-expiry").addEventListener("change", persist);
    U.$("#share-password").addEventListener("change", persist);
    U.$("#copy-link").addEventListener("click", function () {
      var link = U.$("#share-link").value;
      if (!link || link === "Loading…") return;
      U.copyText(link).then(function () { CB.toast({ type: "success", message: "Link copied to clipboard." }); });
    });
  }

  /* ======================================================================
     PUBLIC SHARE PAGE
     ====================================================================== */
  function renderPublic(shareId) {
    var host = U.$("#public-screen");
    var card = U.$("#public-card");
    host.classList.remove("hidden");
    U.$("#splash").classList.add("hidden");
    card.innerHTML = '<div class="preview-none"><div class="splash-spinner"></div><p>Loading file…</p></div>';

    CB.backend.getShare(shareId).then(function (share) {
      if (!share) return notFound(card, "This link is invalid or has been removed.");
      if (share.expiresAt && new Date(share.expiresAt).getTime() < Date.now()) {
        return notFound(card, "This share link has expired.");
      }
      if (share.enabled === false) return notFound(card, "Sharing has been turned off for this file.");

      if (share.passwordHash) return renderLock(card, share);
      renderFile(card, share);
    }).catch(function (err) {
      notFound(card, "Could not load this file. " + err.message);
    });
  }

  function logo() {
    return '<div class="public-logo"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8">' +
      U.icon("file").replace("M6 3h8l4 4v14H6z", "M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.3 9.2 4.5 4.5 0 0 0 6.5 19h11z") +
      '</svg> CloudBox</div>';
  }

  function notFound(card, message) {
    card.innerHTML = logo() +
      '<div class="preview-none">' + U.iconSvg("file", 46) + '<h2>File unavailable</h2><p class="muted">' + U.escape(message) + '</p>' +
      '<a class="btn btn-primary" href="' + window.location.pathname + '">Go to CloudBox</a></div>';
  }

  function renderLock(card, share) {
    card.innerHTML = logo() +
      '<div class="public-file">' +
        '<span style="color:var(--text-3)">' + U.iconSvg(share.type || "other", 40, share.type) + '</span>' +
        '<div><h1>' + U.escape(share.name) + '</h1><small>Password protected · ' + U.formatBytes(share.size) + '</small></div>' +
      '</div>' +
      '<form class="lock-form" id="unlock-form">' +
        '<label class="field"><span>Enter password to download</span>' +
        '<input type="password" id="unlock-pw" placeholder="Password" autocomplete="off" /></label>' +
        '<button class="btn btn-primary btn-block" type="submit">Unlock file</button>' +
        '<p class="muted" id="unlock-msg" style="text-align:center;font-size:12.5px"></p>' +
      '</form>';

    var form = U.$("#unlock-form");
    var input = U.$("#unlock-pw");
    input.focus();
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (U.hash(input.value) === share.passwordHash) {
        renderFile(card, share);
      } else {
        U.$("#unlock-msg").textContent = "Incorrect password. Please try again.";
        U.$("#unlock-msg").style.color = "var(--red)";
        input.select();
      }
    });
  }

  function renderFile(card, share) {
    var previewable = CB.utils.canPreview({ kind: "file", name: share.name, mime: share.mime, type: share.type });
    card.innerHTML = logo() +
      '<div class="public-file">' +
        '<span style="color:var(--text-3)">' + U.iconSvg(share.type || U.categoryOf(share.name, share.mime), 40, share.type) + '</span>' +
        '<div><h1>' + U.escape(share.name) + '</h1>' +
        '<small>' + U.formatBytes(share.size) + (share.createdAt ? ' · shared ' + U.timeAgo(share.createdAt) : '') + '</small></div>' +
      '</div>' +
      '<div class="public-preview" id="public-preview"></div>' +
      '<div class="public-actions">' +
        '<button class="btn btn-primary" id="public-download" style="flex:1">' +
          U.iconSvg("download", 17).replace("file-ico", "") + ' Download</button>' +
      '</div>';

    U.$("#public-download").addEventListener("click", function () { downloadShared(share); });

    if (previewable) {
      CB.backend.sharedURL(share).then(function (url) {
        var box = U.$("#public-preview");
        if (!box) return;
        var cat = share.type || U.categoryOf(share.name, share.mime);
        if (cat === "image") box.innerHTML = '<img src="' + url + '" alt="' + U.escape(share.name) + '" />';
        else if (cat === "video") box.innerHTML = '<video src="' + url + '" controls></video>';
        else if (cat === "audio") box.innerHTML = '<audio src="' + url + '" controls style="width:100%"></audio>';
        else if (cat === "pdf") box.innerHTML = '<iframe src="' + url + '" title="preview"></iframe>';
        else {
          fetch(url).then(function (r) { return r.text(); }).then(function (txt) {
            box.innerHTML = '<pre style="max-height:340px">' + U.escape(txt.slice(0, 20000)) + '</pre>';
          }).catch(function () {});
        }
      }).catch(function () { /* preview optional */ });
    }
  }

  function downloadShared(share) {
    var t = CB.toast({ type: "info", title: "Preparing download", message: share.name, duration: 0 });
    CB.backend.sharedURL(share).then(function (url) {
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.blob();
      }).then(function (blob) {
        t.close();
        U.saveBlobToDisk(blob, share.name);
      }).catch(function () {
        // fall back to opening the URL directly (e.g. storage CORS)
        t.close();
        var a = document.createElement("a");
        a.href = url; a.download = share.name; a.target = "_blank"; a.rel = "noopener";
        document.body.appendChild(a); a.click(); a.remove();
      });
    }).catch(function (err) {
      t.close();
      CB.toast({ type: "error", title: "Download failed", message: err.message });
    });
  }

  function initPublic() {
    CB.bus.on("publicShare", function (id) { renderPublic(id); });
  }

  CB.share = { open: open, init: init, initPublic: initPublic, renderPublic: renderPublic };
})();
