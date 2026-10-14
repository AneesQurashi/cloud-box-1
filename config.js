/* ==========================================================================
   config.js — Firebase credentials & app-wide constants
   --------------------------------------------------------------------------
   HOW TO CONNECT YOUR OWN FIREBASE PROJECT
   1. Go to https://console.firebase.google.com and create a project.
   2. Enable  Authentication -> Sign-in method -> Email/Password (+ Google).
   3. Create a  Cloud Firestore  database (start in production mode) and paste
      the rules found in  firestore.rules  (see project README).
   4. Enable  Storage  and paste the rules from  storage.rules.
   5. Project settings -> Your apps -> Web app -> copy the firebaseConfig
      object and replace the placeholder below.

   While the config below is left as placeholder values the app automatically
   runs in  LOCAL DEMO MODE  (data kept in this browser only) so you can try
   every feature without a backend.
   ========================================================================== */

window.CB = window.CB || {};

CB.config = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

/* Is a real Firebase project configured? */
CB.isConfigured = (function () {
  var c = CB.config;
  return !!(c && c.apiKey && c.apiKey.indexOf("YOUR_") !== 0 && c.projectId && c.projectId.indexOf("YOUR_") !== 0);
})();

/* Storage quota granted to every new account. */
CB.QUOTA_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

/* Upload guard-rails. */
CB.LIMITS = {
  maxFileBytes: 2 * 1024 * 1024 * 1024,   // 2 GB per file
  concurrentUploads: 3,
  previewTextBytes: 512 * 1024,           // read up to 512 KB as text
  paginateAt: 500                         // soft page size for big libraries
};

/* File categories used for icons, filters and analytics. */
CB.CATEGORIES = {
  image:    { label: "Images",    color: "#17a673" },
  video:    { label: "Video",     color: "#e0447c" },
  audio:    { label: "Audio",     color: "#7c5cff" },
  document: { label: "Documents", color: "#2f6fed" },
  pdf:      { label: "PDF",       color: "#e5484d" },
  archive:  { label: "Archives",  color: "#e08c0b" },
  code:     { label: "Code",      color: "#0f9bb5" },
  other:    { label: "Other",     color: "#8b95a6" }
};

/* localStorage keys. */
CB.KEYS = {
  theme: "cb.theme",
  layout: "cb.layout",
  user: "cb.user",
  localDb: "cb.local.db",
  session: "cb.local.session"
};
