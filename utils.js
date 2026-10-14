/* ==========================================================================
   utils.js — small helpers shared across the app
   ========================================================================== */

(function () {
  "use strict";

  var U = {};

  /* ---------- DOM ---------- */
  U.$  = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  U.el = function (tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "text") node.textContent = v;
        else if (k === "dataset") Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        else if (k.indexOf("on") === 0 && typeof v === "function") node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? "" : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  };

  U.escape = function (str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };

  U.debounce = function (fn, wait) {
    var t;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait || 200);
    };
  };

  U.throttle = function (fn, wait) {
    var last = 0, timer;
    return function () {
      var ctx = this, args = arguments, now = Date.now(), remaining = wait - (now - last);
      if (remaining <= 0) { last = now; fn.apply(ctx, args); }
      else if (!timer) {
        timer = setTimeout(function () { last = Date.now(); timer = null; fn.apply(ctx, args); }, remaining);
      }
    };
  };

  /* ---------- ids ---------- */
  U.uid = function (len) {
    var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    var out = "";
    var n = len || 20;
    if (window.crypto && window.crypto.getRandomValues) {
      var arr = new Uint8Array(n);
      window.crypto.getRandomValues(arr);
      for (var i = 0; i < n; i++) out += chars[arr[i] % chars.length];
      return out;
    }
    for (var j = 0; j < n; j++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  };

  U.shareId = function () { return U.uid(14); };

  /* ---------- formatting ---------- */
  U.formatBytes = function (bytes, decimals) {
    bytes = Number(bytes) || 0;
    if (bytes < 1) return "0 B";
    var units = ["B", "KB", "MB", "GB", "TB", "PB"];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    i = Math.min(i, units.length - 1);
    var val = bytes / Math.pow(1024, i);
    var d = decimals == null ? (i === 0 ? 0 : (val >= 100 ? 0 : val >= 10 ? 1 : 2)) : decimals;
    var s = val.toFixed(d);
    if (s.indexOf(".") > -1) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s + " " + units[i];
  };

  U.formatDate = function (ts) {
    if (!ts) return "—";
    var d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) return "—";
    var now = new Date();
    var diff = now - d;
    var day = 24 * 60 * 60 * 1000;
    if (diff < 60000) return "Just now";
    if (diff < 60 * 60000) return Math.floor(diff / 60000) + " min ago";
    if (diff < day && d.getDate() === now.getDate()) {
      return "Today, " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    if (diff < 2 * day) return "Yesterday";
    if (diff < 7 * day) return Math.floor(diff / day) + " days ago";
    var opts = { day: "numeric", month: "short" };
    if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
    return d.toLocaleDateString([], opts);
  };

  U.formatFullDate = function (ts) {
    if (!ts) return "—";
    var d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  };

  U.timeAgo = function (ts) {
    if (!ts) return "";
    var diff = Date.now() - new Date(ts).getTime();
    var s = Math.floor(diff / 1000);
    if (s < 60) return "just now";
    var m = Math.floor(s / 60); if (m < 60) return m + "m ago";
    var h = Math.floor(m / 60); if (h < 24) return h + "h ago";
    var d = Math.floor(h / 24); return d + "d ago";
  };

  U.initials = function (name) {
    if (!name) return "U";
    var parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "U";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  /* ---------- file classification ---------- */
  U.ext = function (name) {
    var m = /\.([a-z0-9]{1,8})$/i.exec(String(name || ""));
    return m ? m[1].toLowerCase() : "";
  };

  U.baseName = function (name) {
    var n = String(name || "");
    var i = n.lastIndexOf(".");
    return i > 0 ? n.slice(0, i) : n;
  };

  var EXT_MAP = {
    image: ["jpg","jpeg","png","gif","webp","bmp","svg","ico","avif","heic","tiff"],
    video: ["mp4","webm","mov","avi","mkv","m4v","mpeg","mpg","wmv","flv","3gp"],
    audio: ["mp3","wav","ogg","oga","m4a","flac","aac","opus","wma","mid","midi"],
    pdf:   ["pdf"],
    archive: ["zip","rar","7z","tar","gz","bz2","xz","iso","tgz","tar.gz"],
    document: ["doc","docx","odt","rtf","txt","md","markdown","csv","xls","xlsx","ods","ppt","pptx","odp","epub","pages","key","numbers","log"],
    code: ["js","mjs","cjs","ts","tsx","jsx","json","html","htm","css","scss","sass","less","py","rb","go","rs","java","c","h","cpp","hpp","cs","php","swift","kt","kts","sh","bash","yml","yaml","toml","ini","sql","xml","vue","svelte","dart","lua","r","pl","gradle","dockerfile","gitignore"]
  };
  var CAT_LOOKUP = (function () {
    var map = {};
    Object.keys(EXT_MAP).forEach(function (cat) {
      EXT_MAP[cat].forEach(function (e) { map[e] = cat; });
    });
    return map;
  })();

  U.categoryOf = function (name, mime) {
    mime = mime || "";
    if (mime.indexOf("image/") === 0) return "image";
    if (mime.indexOf("video/") === 0) return "video";
    if (mime.indexOf("audio/") === 0) return "audio";
    if (mime === "application/pdf") return "pdf";
    var e = U.ext(name);
    return CAT_LOOKUP[e] || "other";
  };

  U.canPreview = function (item) {
    if (!item || item.kind === "folder") return false;
    var cat = item.type || U.categoryOf(item.name, item.mime);
    return cat === "image" || cat === "video" || cat === "audio" || cat === "pdf" ||
           cat === "code" || cat === "document" ||
           (item.mime || "").indexOf("text/") === 0;
  };

  /* ---------- SVG icons ---------- */
  var ICONS = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
    file:   '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    image:  '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 17 5-4.5 3.5 3 2.5-2 4 3.5"/>',
    video:  '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M11 10.5v3l3-1.5z"/>',
    audio:  '<path d="M9 17V6l9-2v11"/><circle cx="7" cy="17" r="2.2"/><circle cx="16" cy="15" r="2.2"/>',
    pdf:    '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 15h1.4a1.4 1.4 0 0 0 0-2.8H9V17M13.4 12.2V17h1a1.6 1.6 0 0 0 1.6-1.6v-1.6a1.6 1.6 0 0 0-1.6-1.6z"/>',
    document: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 15h6M9 18h4"/>',
    archive: '<rect x="4" y="3.5" width="16" height="5" rx="1.4"/><path d="M5.5 8.5v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-11"/><path d="M10 12h4M10 15.5h4"/>',
    code:   '<path d="m9 8-4 4 4 4M15 8l4 4-4 4"/>',
    other:  '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    star:   '<path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.7l5.4-.8L12 4z"/>',
    trash:  '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7"/>',
    download: '<path d="M12 4v12m0 0-4-4m4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 20h14" stroke-linecap="round"/>',
    share:  '<circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/>',
    rename: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M14.5 6.5l3 3"/>',
    move:   '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M12 17v-5m0 0-2 2m2-2 2 2"/>',
    copy:   '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15"/>',
    info:   '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8.2v.1" stroke-linecap="round"/>',
    restore: '<path d="M4 12a8 8 0 1 0 2.5-5.8" stroke-linecap="round"/><path d="M4 4v4.5h4.5" stroke-linecap="round" stroke-linejoin="round"/>',
    check:  '<path d="m5 13 4.5 4.5L19 7" stroke-linecap="round" stroke-linejoin="round"/>'
  };

  U.icon = function (name) { return ICONS[name] || ICONS.file; };

  U.iconSvg = function (name, size, cls) {
    return '<svg class="file-ico ' + (cls || "") + '" viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) +
      '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">' + U.icon(name) + "</svg>";
  };

  U.itemIcon = function (item, size) {
    if (item.kind === "folder") {
      return '<svg class="file-ico" viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) +
        '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" style="color:var(--amber)">' + ICONS.folder + "</svg>";
    }
    var cat = item.type || U.categoryOf(item.name, item.mime);
    return U.iconSvg(cat, size, cat);
  };

  /* ---------- misc ---------- */
  U.downloadBlob = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };

  U.saveBlobToDisk = function (blob, filename) {
    if (window.showSaveFilePicker) {
      return window.showSaveFilePicker({ suggestedName: filename }).then(function (handle) {
        return handle.createWritable();
      }).then(function (writable) {
        return writable.write(blob).then(function () { return writable.close(); });
      }).catch(function (err) {
        if (err && err.name === "AbortError") return;
        U.downloadBlob(blob, filename);
      });
    }
    U.downloadBlob(blob, filename);
    return Promise.resolve();
  };

  U.copyText = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        resolve();
      } catch (e) { reject(e); }
    });
  };

  U.hash = function (str) {
    // Tiny non-cryptographic hash — used only for demo-mode share passwords.
    var h = 5381, i = str.length;
    while (i) h = (h * 33) ^ str.charCodeAt(--i);
    return (h >>> 0).toString(36);
  };

  U.uniqueName = function (name, existingNames) {
    if (existingNames.indexOf(name) === -1) return name;
    var base = U.baseName(name);
    var ext = U.ext(name);
    var suffix = ext ? "." + ext : "";
    var n = 1;
    var candidate;
    do {
      candidate = base + " (" + n + ")" + suffix;
      n++;
    } while (existingNames.indexOf(candidate) !== -1);
    return candidate;
  };

  U.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  CB.utils = U;
})();
