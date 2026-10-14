/* ==========================================================================
   firebase.js — storage backend
   --------------------------------------------------------------------------
   Exposes a single, backend-agnostic API on  CB.backend  with two
   implementations:

     • CB.cloud  — real Firebase (Auth + Firestore + Storage)
     • CB.local  — zero-config demo using localStorage (metadata) and
                   IndexedDB (file blobs)

   The right one is chosen automatically from  CB.isConfigured .
   ========================================================================== */

(function () {
  "use strict";

  var U = CB.utils;

  /* ======================================================================
     Shared helpers
     ====================================================================== */

  function toISO(value) {
    if (!value) return new Date().toISOString();
    if (typeof value === "string") return value;
    if (value instanceof Date) return value.toISOString();
    if (typeof value.toDate === "function") return value.toDate().toISOString(); // Firestore Timestamp
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
    return new Date().toISOString();
  }

  function normalizeUser(fbUser, profile) {
    if (!fbUser && !profile) return null;
    profile = profile || {};
    return {
      uid: (fbUser && fbUser.uid) || profile.uid,
      email: (fbUser && fbUser.email) || profile.email || "",
      name: profile.name || (fbUser && (fbUser.displayName || (fbUser.email || "").split("@")[0])) || "User",
      photoURL: (fbUser && fbUser.photoURL) || profile.photoURL || null,
      quotaBytes: profile.quotaBytes || CB.QUOTA_BYTES,
      createdAt: profile.createdAt || toISO()
    };
  }

  /* ======================================================================
     IndexedDB blob store (used by local mode, also handy as offline cache)
     ====================================================================== */
  var IDB = (function () {
    var DB_NAME = "cloudbox";
    var STORE = "blobs";
    var dbp = null;

    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (resolve, reject) {
        if (!window.indexedDB) return reject(new Error("IndexedDB unavailable"));
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
      return dbp;
    }

    return {
      put: function (key, blob) {
        return open().then(function (db) {
          return new Promise(function (resolve, reject) {
            var t = db.transaction(STORE, "readwrite");
            t.objectStore(STORE).put(blob, key);
            t.oncomplete = resolve;
            t.onerror = function () { reject(t.error); };
          });
        });
      },
      get: function (key) {
        return open().then(function (db) {
          return new Promise(function (resolve, reject) {
            var t = db.transaction(STORE, "readonly");
            var r = t.objectStore(STORE).get(key);
            r.onsuccess = function () { resolve(r.result || null); };
            r.onerror = function () { reject(r.error); };
          });
        });
      },
      del: function (key) {
        return open().then(function (db) {
          return new Promise(function (resolve, reject) {
            var t = db.transaction(STORE, "readwrite");
            t.objectStore(STORE).delete(key);
            t.oncomplete = resolve;
            t.onerror = function () { reject(t.error); };
          });
        });
      }
    };
  })();

  /* ======================================================================
     LOCAL (demo) BACKEND
     ====================================================================== */
  var local = (function () {
    var LS = CB.KEYS.localDb;
    var SESSION = CB.KEYS.session;
    var data = null;

    function blank() { return { users: {}, files: {}, folders: {}, shares: {} }; }

    function load() {
      if (data) return data;
      try { data = JSON.parse(localStorage.getItem(LS)) || blank(); }
      catch (e) { data = blank(); }
      data.users = data.users || {};
      data.files = data.files || {};
      data.folders = data.folders || {};
      data.shares = data.shares || {};
      return data;
    }

    function save() {
      try { localStorage.setItem(LS, JSON.stringify(data)); }
      catch (e) { CB.toast({ type: "error", title: "Storage full", message: "Local demo storage could not be saved." }); }
      emit();
    }

    var authCb = null;
    var itemCb = null;
    var currentUid = null;

    function emit() {
      if (itemCb && currentUid) {
        itemCb({
          files: Object.keys(data.files).filter(function (k) { return data.files[k].uid === currentUid; }).map(function (k) { return decorate(data.files[k]); }),
          folders: Object.keys(data.folders).filter(function (k) { return data.folders[k].uid === currentUid; }).map(function (k) { return decorate(data.folders[k]); })
        });
      }
    }

    function decorate(rec) {
      var out = {};
      Object.keys(rec).forEach(function (k) { out[k] = rec[k]; });
      out.kind = out.kind || (out.parentId !== undefined ? "folder" : "file");
      return out;
    }

    var listeners = [];
    function fireUser(u) { listeners.forEach(function (fn) { fn(u); }); }
    function setSession(uid) {
      if (uid) localStorage.setItem(SESSION, uid);
      else localStorage.removeItem(SESSION);
      currentUid = uid || null;
      var user = uid ? currentUser() : null;
      if (authCb) authCb(user);
      fireUser(user);
      if (uid) emit();
    }
    function currentUser() {
      var uid = currentUid || localStorage.getItem(SESSION);
      if (!uid || !data.users[uid]) return null;
      var p = data.users[uid];
      return normalizeUser(null, { uid: uid, email: p.email, name: p.name, quotaBytes: p.quotaBytes, createdAt: p.createdAt });
    }

    return {
      mode: "local",

      init: function () {
        load();
        var uid = localStorage.getItem(SESSION);
        currentUid = uid && data.users[uid] ? uid : null;
        return Promise.resolve();
      },

      ready: function () { return true; },

      onAuthChanged: function (cb) {
        authCb = cb;
        setTimeout(function () { cb(currentUser()); }, 0);
      },

      currentUser: currentUser,

      signUp: function (email, password, name) {
        load();
        email = String(email).trim().toLowerCase();
        var exists = Object.keys(data.users).some(function (k) { return data.users[k].email === email; });
        if (exists) return Promise.reject(new Error("An account with this email already exists."));
        var uid = "local_" + U.uid(16);
        data.users[uid] = {
          uid: uid, email: email, name: name || email.split("@")[0],
          pass: U.hash(password), quotaBytes: CB.QUOTA_BYTES, createdAt: toISO()
        };
        save();
        setSession(uid);
        return Promise.resolve(currentUser());
      },

      signIn: function (email, password) {
        load();
        email = String(email).trim().toLowerCase();
        var key = Object.keys(data.users).find(function (k) { return data.users[k].email === email; });
        if (!key) return Promise.reject(new Error("No account found for that email."));
        if (data.users[key].pass !== U.hash(password)) return Promise.reject(new Error("Incorrect password. Please try again."));
        setSession(key);
        return Promise.resolve(currentUser());
      },

      signInWithGoogle: function () {
        // No OAuth in demo mode — create/reuse a demo Google account.
        load();
        var email = "demo.user@gmail.com";
        var key = Object.keys(data.users).find(function (k) { return data.users[k].email === email; });
        if (!key) {
          key = "local_" + U.uid(16);
          data.users[key] = { uid: key, email: email, name: "Demo User", pass: null, quotaBytes: CB.QUOTA_BYTES, createdAt: toISO() };
          save();
        }
        setSession(key);
        return Promise.resolve(currentUser());
      },

      signOut: function () { setSession(null); return Promise.resolve(); },

      sendResetPassword: function () {
        return Promise.resolve(); // nothing to send in demo mode
      },

      updateName: function (name) {
        load();
        if (!currentUid) return Promise.reject(new Error("Not signed in"));
        data.users[currentUid].name = name;
        save();
        var u = currentUser();
        if (authCb) authCb(u);
        return Promise.resolve(u);
      },

      updateQuota: function (bytes) {
        load();
        if (!currentUid) return Promise.resolve();
        data.users[currentUid].quotaBytes = bytes;
        save();
        var u = currentUser();
        if (authCb) authCb(u);
        return Promise.resolve(u);
      },

      deleteAccount: function () {
        load();
        var uid = currentUid;
        var paths = [];
        Object.keys(data.files).forEach(function (k) {
          if (data.files[k].uid === uid) { paths.push(data.files[k].storagePath); delete data.files[k]; }
        });
        Object.keys(data.folders).forEach(function (k) { if (data.folders[k].uid === uid) delete data.folders[k]; });
        Object.keys(data.shares).forEach(function (k) { if (data.shares[k].uid === uid) delete data.shares[k]; });
        delete data.users[uid];
        return Promise.all(paths.map(function (p) { return IDB.del(p).catch(function () {}); }))
          .then(function () { setSession(null); });
      },

      subscribeItems: function (cb) {
        itemCb = cb;
        emit();
        return function () { itemCb = null; };
      },

      createFolder: function (rec) {
        load();
        var id = "fld_" + U.uid(16);
        rec = Object.assign({ id: id, uid: currentUid, kind: "folder", parentId: null, starred: false, trashed: false }, rec);
        rec.createdAt = toISO(); rec.updatedAt = rec.createdAt;
        data.folders[id] = rec;
        save();
        return Promise.resolve(decorate(rec));
      },

      createFileDoc: function (rec) {
        load();
        var id = "fil_" + U.uid(16);
        rec = Object.assign({ id: id, uid: currentUid, kind: "file", folderId: null, starred: false, trashed: false }, rec);
        rec.createdAt = toISO(); rec.updatedAt = rec.createdAt;
        data.files[id] = rec;
        save();
        return Promise.resolve(decorate(rec));
      },

      updateItem: function (kind, id, patch) {
        load();
        var coll = kind === "folder" ? data.folders : data.files;
        if (!coll[id]) return Promise.resolve(null);
        Object.assign(coll[id], patch, { updatedAt: toISO() });
        save();
        return Promise.resolve(decorate(coll[id]));
      },

      deleteItem: function (kind, id) {
        load();
        var coll = kind === "folder" ? data.folders : data.files;
        delete coll[id];
        save();
        return Promise.resolve();
      },

      deleteBlob: function (storagePath) {
        if (!storagePath) return Promise.resolve();
        return IDB.del(storagePath).catch(function () {});
      },

      getBlob: function (item) {
        return IDB.get(item.storagePath).then(function (b) {
          if (!b) throw new Error("File data not found in this browser.");
          return b;
        });
      },

      getURL: function (item) {
        return IDB.get(item.storagePath).then(function (b) {
          if (!b) throw new Error("File data not found in this browser.");
          return URL.createObjectURL(b);
        });
      },

      /* --- upload: FileReader gives real progress, IndexedDB stores the blob --- */
      upload: function (file, opts) {
        opts = opts || {};
        var storagePath = (opts.storagePath) || ("users/" + currentUid + "/" + U.uid(18) + "/" + file.name);
        var cancelled = false, paused = false;
        var cancelledReject, cancelPromise = new Promise(function (_, rej) { cancelledReject = rej; });

        var progress = new Promise(function (resolve, reject) {
          var reader = new FileReader();
          var lastPct = -1;

          function tick() {
            if (cancelled) return;
            if (paused) { setTimeout(tick, 120); return; }
            var pct = file.size ? Math.round((reader.result ? reader.result.byteLength : 0) / file.size * 100) : 0;
            if (pct !== lastPct) { lastPct = pct; opts.onProgress && opts.onProgress(pct); }
            if (reader.readyState === FileReader.LOADING) setTimeout(tick, 90);
          }

          reader.onprogress = function (e) {
            if (paused || cancelled) return;
            var pct = e.lengthComputable ? Math.round(e.loaded / e.total * 100) : 50;
            lastPct = pct;
            opts.onProgress && opts.onProgress(pct);
          };
          reader.onload = function () {
            if (cancelled) return;
            var blob = new Blob([reader.result], { type: file.type || "application/octet-stream" });
            IDB.put(storagePath, blob).then(function () {
              opts.onProgress && opts.onProgress(100);
              resolve();
            }, reject);
          };
          reader.onerror = function () { reject(reader.error || new Error("Could not read file")); };
          reader.readAsArrayBuffer(file);
          tick();
        });

        return {
          storagePath: storagePath,
          promise: Promise.race([progress, cancelPromise]),
          pause: function () { paused = true; },
          resume: function () { paused = false; },
          cancel: function () { cancelled = true; cancelledReject(new Error("Upload cancelled")); }
        };
      },

      createShare: function (shareId, rec) {
        load();
        data.shares[shareId] = Object.assign({ id: shareId, uid: currentUid, createdAt: toISO() }, rec);
        save();
        return Promise.resolve(data.shares[shareId]);
      },
      updateShare: function (shareId, patch) {
        load();
        if (!data.shares[shareId]) return Promise.resolve(null);
        Object.assign(data.shares[shareId], patch);
        save();
        return Promise.resolve(data.shares[shareId]);
      },
      deleteShare: function (shareId) {
        load();
        delete data.shares[shareId];
        save();
        return Promise.resolve();
      },
      getShare: function (shareId) {
        load();
        var s = data.shares[shareId] || null;
        return Promise.resolve(s);
      },
      listShares: function () {
        load();
        return Promise.resolve(Object.keys(data.shares).map(function (k) { return data.shares[k]; }).filter(function (s) { return s.uid === currentUid; }));
      }
    };
  })();

  /* ======================================================================
     FIREBASE BACKEND
     ====================================================================== */
  var cloud = (function () {
    var app = null, auth = null, db = null, storage = null;
    var profileCache = null;

    function init() {
      if (app) return Promise.resolve();
      app = firebase.initializeApp(CB.config);
      auth = firebase.auth();
      db = firebase.firestore();
      storage = firebase.storage();
      try { db.enablePersistence({ synchronizeTabs: true }).catch(function () {}); } catch (e) {}
      return Promise.resolve();
    }

    function profileRef(uid) { return db.collection("users").doc(uid); }

    function ensureProfile(fbUser) {
      if (!fbUser) return Promise.resolve(null);
      var ref = profileRef(fbUser.uid);
      return ref.get().then(function (snap) {
        if (snap.exists) {
          var d = snap.data();
          profileCache = d;
          // keep email fresh
          if (d.email !== fbUser.email) ref.set({ email: fbUser.email }, { merge: true });
          return normalizeUser(fbUser, Object.assign({ uid: fbUser.uid }, d));
        }
        var fresh = {
          uid: fbUser.uid,
          email: fbUser.email || "",
          name: fbUser.displayName || (fbUser.email || "").split("@")[0] || "User",
          photoURL: fbUser.photoURL || null,
          quotaBytes: CB.QUOTA_BYTES,
          usedBytes: 0,
          createdAt: toISO()
        };
        profileCache = fresh;
        return ref.set(fresh).then(function () { return normalizeUser(fbUser, fresh); });
      });
    }

    function mapDoc(doc, kind) {
      var d = doc.data() || {};
      d.id = doc.id;
      d.kind = kind;
      d.createdAt = toISO(d.createdAt);
      d.updatedAt = toISO(d.updatedAt || d.createdAt);
      return d;
    }

    return {
      mode: "firebase",
      init: init,

      onAuthChanged: function (cb) {
        auth.onAuthStateChanged(function (fbUser) {
          if (!fbUser) { profileCache = null; cb(null); return; }
          ensureProfile(fbUser).then(cb, function (err) {
            console.error("profile load failed", err);
            cb(normalizeUser(fbUser, profileCache));
          });
        });
      },

      currentUser: function () {
        return auth.currentUser ? normalizeUser(auth.currentUser, profileCache) : null;
      },

      signUp: function (email, password, name) {
        return auth.createUserWithEmailAndPassword(email, password).then(function (cred) {
          return cred.user.updateProfile({ displayName: name }).then(function () {
            return profileRef(cred.user.uid).set({
              uid: cred.user.uid,
              email: email,
              name: name,
              quotaBytes: CB.QUOTA_BYTES,
              usedBytes: 0,
              createdAt: toISO()
            });
          }).then(function () {
            profileCache = { uid: cred.user.uid, email: email, name: name, quotaBytes: CB.QUOTA_BYTES, createdAt: toISO() };
            return normalizeUser(cred.user, profileCache);
          });
        });
      },

      signIn: function (email, password) {
        return auth.signInWithEmailAndPassword(email, password).then(function (cred) {
          return ensureProfile(cred.user);
        });
      },

      signInWithGoogle: function () {
        var provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        return auth.signInWithPopup(provider).then(function (cred) { return ensureProfile(cred.user); });
      },

      signOut: function () { return auth.signOut(); },

      sendResetPassword: function (email) { return auth.sendPasswordResetEmail(email); },

      updateName: function (name) {
        var fbUser = auth.currentUser;
        if (!fbUser) return Promise.reject(new Error("Not signed in"));
        return fbUser.updateProfile({ displayName: name })
          .then(function () { return profileRef(fbUser.uid).set({ name: name }, { merge: true }); })
          .then(function () {
            profileCache = Object.assign({}, profileCache, { name: name });
            return normalizeUser(fbUser, profileCache);
          });
      },

      updateQuota: function (bytes) {
        var fbUser = auth.currentUser;
        if (!fbUser) return Promise.resolve(null);
        return profileRef(fbUser.uid).set({ quotaBytes: bytes }, { merge: true }).then(function () {
          profileCache = Object.assign({}, profileCache, { quotaBytes: bytes });
          return normalizeUser(fbUser, profileCache);
        });
      },

      deleteAccount: function () {
        var fbUser = auth.currentUser;
        if (!fbUser) return Promise.reject(new Error("Not signed in"));
        var uid = fbUser.uid;

        // Collect everything we own, delete the Storage blobs, then the docs.
        return Promise.all([
          db.collection("files").where("uid", "==", uid).get(),
          db.collection("folders").where("uid", "==", uid).get(),
          db.collection("shares").where("uid", "==", uid).get()
        ]).then(function (results) {
          var fileDocs = results[0].docs, folderDocs = results[1].docs, shareDocs = results[2].docs;

          var blobDeletes = fileDocs.map(function (d) {
            var path = (d.data() || {}).storagePath;
            if (!path) return Promise.resolve();
            return storage.ref(path).delete().catch(function () {});
          });

          var docDeletes = []
            .concat(fileDocs.map(function (d) { return d.ref.delete(); }))
            .concat(folderDocs.map(function (d) { return d.ref.delete(); }))
            .concat(shareDocs.map(function (d) { return d.ref.delete(); }));

          return Promise.all(blobDeletes).then(function () { return Promise.all(docDeletes); });
        })
        .then(function () { return profileRef(uid).delete().catch(function () {}); })
        .then(function () { return fbUser.delete(); });
      },

      subscribeItems: function (cb) {
        var uid = auth.currentUser ? auth.currentUser.uid : null;
        if (!uid) { cb({ files: [], folders: [] }); return function () {}; }

        var files = [], folders = [];
        function publish() { cb({ files: files.slice(), folders: folders.slice() }); }

        var un1 = db.collection("files").where("uid", "==", uid).onSnapshot(function (snap) {
          files = snap.docs.map(function (d) { return mapDoc(d, "file"); });
          publish();
        }, function (err) { console.error("files listener", err); CB.toast({ type: "error", message: "Could not load files: " + err.message }); });

        var un2 = db.collection("folders").where("uid", "==", uid).onSnapshot(function (snap) {
          folders = snap.docs.map(function (d) { return mapDoc(d, "folder"); });
          publish();
        }, function (err) { console.error("folders listener", err); });

        return function () { un1(); un2(); };
      },

      createFolder: function (rec) {
        var uid = auth.currentUser.uid;
        var ref = db.collection("folders").doc();
        var doc = Object.assign({
          uid: uid, name: rec.name, parentId: rec.parentId || null,
          starred: false, trashed: false, createdAt: toISO(), updatedAt: toISO()
        }, rec);
        doc.createdAt = toISO(); doc.updatedAt = doc.createdAt;
        return ref.set(doc).then(function () { return Object.assign({ id: ref.id, kind: "folder" }, doc); });
      },

      createFileDoc: function (rec) {
        var uid = auth.currentUser.uid;
        var ref = db.collection("files").doc();
        var doc = Object.assign({
          uid: uid, folderId: rec.folderId || null, starred: false, trashed: false,
          createdAt: toISO(), updatedAt: toISO()
        }, rec);
        doc.createdAt = toISO(); doc.updatedAt = doc.createdAt;
        return ref.set(doc).then(function () { return Object.assign({ id: ref.id, kind: "file" }, doc); });
      },

      updateItem: function (kind, id, patch) {
        var coll = kind === "folder" ? "folders" : "files";
        var payload = Object.assign({}, patch, { updatedAt: toISO() });
        return db.collection(coll).doc(id).set(payload, { merge: true }).then(function () { return { id: id, kind: kind }; });
      },

      deleteItem: function (kind, id) {
        var coll = kind === "folder" ? "folders" : "files";
        return db.collection(coll).doc(id).delete();
      },

      deleteBlob: function (storagePath) {
        if (!storagePath) return Promise.resolve();
        return storage.ref(storagePath).delete().catch(function (e) {
          if (e && e.code === "storage/object-not-found") return;
          console.warn("blob delete failed", e);
        });
      },

      getBlob: function (item) {
        return storage.ref(item.storagePath).getBlob();
      },

      getURL: function (item) {
        return storage.ref(item.storagePath).getDownloadURL();
      },

      upload: function (file, opts) {
        opts = opts || {};
        var uid = auth.currentUser.uid;
        var storagePath = opts.storagePath || ("users/" + uid + "/" + U.uid(18) + "/" + file.name);
        var ref = storage.ref(storagePath);
        var task = ref.put(file, { contentType: file.type || "application/octet-stream", customMetadata: { originalName: file.name, owner: uid } });

        task.on("state_changed", function (snap) {
          var pct = snap.totalBytes ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0;
          opts.onProgress && opts.onProgress(pct);
        }, function (err) {
          opts.onError && opts.onError(err);
        });

        var promise = task.then(function () { opts.onProgress && opts.onProgress(100); return storagePath; });
        promise.catch(function () {});
        return {
          storagePath: storagePath,
          promise: promise,
          pause: function () { task.pause(); },
          resume: function () { task.resume(); },
          cancel: function () { task.cancel(); }
        };
      },

      createShare: function (shareId, rec) {
        var uid = auth.currentUser.uid;
        var doc = Object.assign({ id: shareId, uid: uid, createdAt: toISO() }, rec);
        return db.collection("shares").doc(shareId).set(doc).then(function () { return doc; });
      },
      updateShare: function (shareId, patch) {
        return db.collection("shares").doc(shareId).set(patch, { merge: true });
      },
      deleteShare: function (shareId) {
        return db.collection("shares").doc(shareId).delete();
      },
      getShare: function (shareId) {
        return db.collection("shares").doc(shareId).get().then(function (snap) {
          if (!snap.exists) return null;
          var d = snap.data();
          d.id = snap.id;
          d.createdAt = toISO(d.createdAt);
          return d;
        });
      },
      listShares: function () {
        var uid = auth.currentUser.uid;
        return db.collection("shares").where("uid", "==", uid).get().then(function (snap) {
          return snap.docs.map(function (d) { var x = d.data(); x.id = d.id; return x; });
        });
      }
    };
  })();

  /* ======================================================================
     Active backend
     ====================================================================== */
  var backend = CB.isConfigured ? cloud : local;

  backend.init().catch(function (err) {
    console.error("Backend init failed, falling back to local demo mode:", err);
    backend = local;
    return local.init();
  });

  // Resolve a usable URL for a shared file. In local demo mode the blob is
  // read straight from IndexedDB; with Firebase we prefer the tokenized
  // download URL captured when the share was created (public visitors are
  // not allowed to call getDownloadURL on someone else's Storage object).
  backend.sharedURL = function (share) {
    if (backend.mode === "local") {
      return IDB.get(share.storagePath).then(function (b) {
        if (!b) throw new Error("File data not available in this browser.");
        return URL.createObjectURL(b);
      });
    }
    if (share.url) return Promise.resolve(share.url);
    return firebase.storage().ref(share.storagePath).getDownloadURL();
  };

  // Called (by the owner) when a share is created so the public token URL
  // can be stored alongside the share document.
  backend.resolveDownloadURL = function (storagePath) {
    if (backend.mode === "local") return Promise.resolve(null);
    return firebase.storage().ref(storagePath).getDownloadURL().catch(function () { return null; });
  };

  CB.backend = backend;
  CB.cloud = cloud;
  CB.local = local;
  CB.IDB = IDB;
  CB.toISO = toISO;
  CB.normalizeUser = normalizeUser;
})();
