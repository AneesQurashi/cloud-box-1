/* ==========================================================================
   auth.js — sign up / log in / log out and the auth-gate
   ========================================================================== */

(function () {
  "use strict";

  var U = CB.utils;
  var state = CB.state;

  var els = {};
  var unsubItems = null;

  function cache() {
    els.splash = U.$("#splash");
    els.authScreen = U.$("#auth-screen");
    els.app = U.$("#app");
    els.loginForm = U.$("#login-form");
    els.signupForm = U.$("#signup-form");
    els.message = U.$("#auth-message");
    els.pwStrength = U.$("#pw-strength");
  }

  /* ---------- helpers ---------- */
  function showMessage(text, kind) {
    els.message.textContent = text;
    els.message.className = "auth-message " + (kind || "info");
    els.message.classList.remove("hidden");
  }
  function clearMessage() {
    els.message.classList.add("hidden");
    els.message.textContent = "";
  }

  function setBusy(form, busy) {
    var btn = U.$("button[type=submit]", form);
    if (!btn) return;
    btn.disabled = busy;
    U.$(".btn-label", btn).classList.toggle("hidden", busy);
    U.$(".btn-spinner", btn).classList.toggle("hidden", !busy);
  }

  function friendlyAuthError(err) {
    var code = (err && err.code) || "";
    var map = {
      "auth/email-already-in-use": "That email is already registered. Try logging in instead.",
      "auth/invalid-email": "That email address doesn't look right.",
      "auth/weak-password": "Please choose a stronger password (at least 8 characters).",
      "auth/user-not-found": "No account found for that email.",
      "auth/wrong-password": "Incorrect password. Please try again.",
      "auth/invalid-credential": "Incorrect email or password.",
      "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
      "auth/popup-closed-by-user": "Google sign-in was cancelled.",
      "auth/popup-blocked": "Your browser blocked the Google sign-in popup.",
      "auth/network-request-failed": "Network error. Check your connection and try again.",
      "auth/operation-not-allowed": "That sign-in method isn't enabled in your Firebase project."
    };
    return map[code] || (err && err.message) || "Something went wrong. Please try again.";
  }

  /* ---------- tabs ---------- */
  function switchTab(name) {
    U.$$(".tab").forEach(function (t) { t.classList.toggle("active", t.dataset.tab === name); });
    els.loginForm.classList.toggle("hidden", name !== "login");
    els.signupForm.classList.toggle("hidden", name !== "signup");
    clearMessage();
  }

  /* ---------- password strength ---------- */
  function scorePassword(pw) {
    var score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return Math.min(score, 4);
  }
  function renderStrength(pw) {
    var bar = U.$(".pw-bar i", els.pwStrength);
    var label = U.$(".pw-label", els.pwStrength);
    if (!pw) { bar.style.width = "0%"; label.textContent = "Password strength"; bar.style.background = ""; return; }
    var s = scorePassword(pw);
    var widths = ["20%", "40%", "60%", "80%", "100%"];
    var colors = ["#e5484d", "#e5484d", "#e08c0b", "#17a673", "#17a673"];
    var labels = ["Very weak", "Weak", "Fair", "Good", "Strong"];
    bar.style.width = widths[s];
    bar.style.background = colors[s];
    label.textContent = labels[s];
  }

  /* ---------- enter / leave the app ---------- */
  function enterApp(user) {
    state.user = user;
    els.splash.classList.add("hidden");
    els.authScreen.classList.add("hidden");
    els.app.classList.remove("hidden");
    localStorage.setItem(CB.KEYS.user, JSON.stringify({ uid: user.uid, email: user.email, name: user.name }));
    CB.bus.emit("user", user);

    // subscribe to the user's library
    if (unsubItems) unsubItems();
    unsubItems = CB.backend.subscribeItems(function (data) {
      var items = [];
      (data.folders || []).forEach(function (f) { items.push(f); });
      (data.files || []).forEach(function (f) { items.push(f); });
      // tag owner name for the "Owner" column
      items.forEach(function (it) { it.ownerName = it.ownerName || user.name; });
      state.items = items;
      CB.store.recomputeUsage();
      state.ready = true;
      CB.bus.emit("items", items);
    });

    CB.bus.emit("enterApp", user);
  }

  function leaveApp() {
    if (unsubItems) { unsubItems(); unsubItems = null; }
    state.user = null;
    state.items = [];
    state.selection.clear();
    state.folderId = null;
    state.folderStack = [];
    state.view = "files";
    localStorage.removeItem(CB.KEYS.user);
    els.app.classList.add("hidden");
    els.authScreen.classList.remove("hidden");
    els.splash.classList.add("hidden");
    clearMessage();
    CB.bus.emit("leaveApp");
  }

  /* ---------- public share deep-link ---------- */
  function shareIdFromLocation() {
    var params = new URLSearchParams(window.location.search);
    return params.get("share") || (window.location.hash.indexOf("#share=") === 0 ? window.location.hash.slice(7) : "");
  }

  /* ---------- wire up ---------- */
  function bindForms() {
    U.$$(".tab").forEach(function (t) {
      t.addEventListener("click", function () { switchTab(t.dataset.tab); });
    });

    U.$$(".toggle-pw").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var input = btn.parentElement.querySelector("input");
        input.type = input.type === "password" ? "text" : "password";
        btn.style.opacity = input.type === "text" ? "1" : ".6";
      });
    });

    var signupPw = U.$('input[name="password"]', els.signupForm);
    signupPw.addEventListener("input", function () { renderStrength(signupPw.value); });

    els.loginForm.addEventListener("submit", function (e) {
      e.preventDefault();
      clearMessage();
      var fd = new FormData(els.loginForm);
      var email = String(fd.get("email") || "").trim();
      var password = String(fd.get("password") || "");
      if (!email || !password) return showMessage("Please enter your email and password.", "error");
      setBusy(els.loginForm, true);
      CB.backend.signIn(email, password)
        .catch(function (err) { showMessage(friendlyAuthError(err), "error"); })
        .finally(function () { setBusy(els.loginForm, false); });
    });

    els.signupForm.addEventListener("submit", function (e) {
      e.preventDefault();
      clearMessage();
      var fd = new FormData(els.signupForm);
      var name = String(fd.get("name") || "").trim();
      var email = String(fd.get("email") || "").trim();
      var password = String(fd.get("password") || "");
      if (scorePassword(password) < 2) return showMessage("Please choose a stronger password.", "error");
      setBusy(els.signupForm, true);
      CB.backend.signUp(email, password, name)
        .catch(function (err) { showMessage(friendlyAuthError(err), "error"); })
        .finally(function () { setBusy(els.signupForm, false); });
    });

    U.$("#google-login").addEventListener("click", function () {
      clearMessage();
      CB.backend.signInWithGoogle().catch(function (err) {
        showMessage(friendlyAuthError(err), "error");
      });
    });

    U.$("#forgot-link").addEventListener("click", function () {
      var email = U.$('input[name="email"]', els.loginForm).value.trim();
      if (!email) { switchTab("login"); return showMessage("Enter your email above, then click “Forgot password?”.", "info"); }
      CB.backend.sendResetPassword(email).then(function () {
        showMessage("Password reset link sent to " + email + ".", "success");
      }).catch(function (err) { showMessage(friendlyAuthError(err), "error"); });
    });

    U.$("#logout-btn").addEventListener("click", function () {
      CB.backend.signOut().catch(function (err) { CB.toast({ type: "error", message: err.message }); });
    });
  }

  function showDemoBanner() {
    if (CB.backend.mode !== "local") return;
    var banner = U.el("div", {
      class: "demo-note",
      html: 'Demo mode — data is stored in <strong>this browser only</strong>. ' +
            'Add your Firebase keys in <code>js/config.js</code> to enable real cloud storage.'
    });
    var card = U.$(".auth-card");
    if (card && !U.$(".demo-note")) card.insertBefore(banner, card.firstChild);
  }

  /* ---------- boot ---------- */
  function start() {
    cache();
    bindForms();
    showDemoBanner();

    var shareId = shareIdFromLocation();
    if (shareId) {
      // Public share page does not require a session.
      els.splash.classList.add("hidden");
      CB.bus.emit("publicShare", shareId);
      return;
    }

    CB.backend.onAuthChanged(function (user) {
      if (user) {
        CB.toast({ type: "success", title: "Welcome back, " + user.name.split(" ")[0] + "!", message: "Your files are ready.", duration: 2600 });
        enterApp(user);
      } else {
        leaveApp();
      }
    });
  }

  CB.auth = { start: start, leaveApp: leaveApp, enterApp: enterApp };
})();
