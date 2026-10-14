/* ==========================================================================
   preview.js — in-browser preview for images, video, audio, PDF and text
   ========================================================================== */

(function () {
  "use strict";

  var U = CB.utils;
  var current = null;
  var objectURL = null;

  function show(item) {
    if (!item || CB.files.isFolder(item)) return;
    current = item;

    U.$("#preview-name").textContent = item.name;
    U.$("#preview-meta").textContent =
      U.formatBytes(item.size) + " · " + (item.type || U.categoryOf(item.name, item.mime) || "file") +
      " · modified " + U.formatDate(item.updatedAt || item.createdAt);
    U.$("#preview-star").classList.toggle("on", !!item.starred);
    U.$("#preview-star").innerHTML = item.starred ? "&#9733;" : "&#9734;";

    var body = U.$("#preview-body");
    body.innerHTML = '<div class="preview-none"><div class="splash-spinner"></div><p>Loading preview…</p></div>';
    CB.folders.showModal("#preview-modal");

    var cat = item.type || U.categoryOf(item.name, item.mime);
    var isText = (item.mime || "").indexOf("text/") === 0 || cat === "code" || cat === "document";

    CB.backend.getURL(item).then(function (url) {
      if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; }
      if (url.indexOf("blob:") === 0) objectURL = url;

      if (cat === "image") {
        body.innerHTML = '<img alt="' + U.escape(item.name) + '" />';
        var img = body.querySelector("img");
        img.onload = function () {};
        img.src = url;
      } else if (cat === "video") {
        body.innerHTML = "";
        body.appendChild(U.el("video", { src: url, controls: true, playsinline: true, preload: "metadata" }));
      } else if (cat === "audio") {
        body.innerHTML = "";
        body.appendChild(U.el("div", { style: "width:100%;max-width:520px;display:grid;gap:16px;justify-items:center" }, [
          U.el("span", { html: U.iconSvg("audio", 54, "audio"), style: "display:flex" }),
          U.el("div", { text: item.name, style: "font-weight:600;word-break:break-word;text-align:center" }),
          U.el("audio", { src: url, controls: true, style: "width:100%" })
        ]));
      } else if (cat === "pdf") {
        body.innerHTML = '<iframe src="' + url + '" title="PDF preview"></iframe>';
      } else if (isText) {
        showTextPreview(body, url, item);
      } else {
        showNoPreview(body, item);
      }
    }).catch(function (err) {
      body.innerHTML = '<div class="preview-none">' + U.iconSvg("file", 46) + '<p class="muted">Preview unavailable — ' + U.escape(err.message) + '</p>' +
        '<button class="btn btn-primary" id="pv-fallback-download">Download instead</button></div>';
      var b = U.$("#pv-fallback-download");
      if (b) b.addEventListener("click", function () { CB.files.download(item); });
    });
  }

  function showTextPreview(body, url, item) {
    fetch(url).then(function (r) { return r.text(); }).then(function (text) {
      var truncated = false;
      if (text.length > CB.LIMITS.previewTextBytes / 2) { text = text.slice(0, 60000); truncated = true; }
      body.innerHTML = "";
      body.appendChild(U.el("pre", { text: text + (truncated ? "\n\n… (truncated preview)" : "") }));
    }).catch(function () { showNoPreview(body, item); });
  }

  function showNoPreview(body, item) {
    body.innerHTML = "";
    body.appendChild(U.el("div", { class: "preview-none" }, [
      U.el("span", { html: U.iconSvg(item.type || "file", 46), style: "display:flex" }),
      U.el("h3", { text: "No preview available" }),
      U.el("p", { class: "muted", text: "This file type can't be displayed in the browser. Download it to open locally." }),
      U.el("button", { class: "btn btn-primary", text: "Download", onclick: function () { CB.files.download(item); } })
    ]));
  }

  function close() {
    CB.folders.hideModal("#preview-modal");
    U.$("#preview-body").innerHTML = "";
    if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; }
    current = null;
  }

  function init() {
    U.$("#preview-star").addEventListener("click", function () {
      if (!current) return;
      CB.files.setStar(current, !current.starred);
      current.starred = !current.starred;
      U.$("#preview-star").classList.toggle("on", current.starred);
      U.$("#preview-star").innerHTML = current.starred ? "&#9733;" : "&#9734;";
    });
    U.$("#preview-download").addEventListener("click", function () { if (current) CB.files.download(current); });
    U.$("#preview-share").addEventListener("click", function () { if (current) { close(); CB.share.open(current); } });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !U.$("#preview-modal").classList.contains("hidden")) close();
    });
  }

  CB.preview = { show: show, close: close, init: init };
})();
