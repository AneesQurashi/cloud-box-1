# CloudBox — a MediaFire-inspired cloud storage web app

A complete, build-step-free cloud storage **single-page application** built with
**vanilla HTML, CSS and JavaScript** on top of **Firebase** (Authentication,
Cloud Firestore, Cloud Storage).

> No bundler, no npm install — just static files you can host anywhere.

---

## Features

**Accounts & quotas**
- Email/password sign-up and login, Google sign-in, password reset
- 10 GB quota per account with live usage meters in the sidebar & user menu
- Dashboard with file counts, storage breakdown by type and recent uploads

**Files & folders**
- Drag & drop uploads (files *and* whole folders) with a live upload dock
- Per-file progress, **pause / resume**, cancel, retry and upload queue
- Create, rename, move (with a folder picker), star and delete folders/files
- Breadcrumb navigation, multi-select with bulk actions, right-click context menu
- Grid and list layouts, sorting (name/size/date), search across all folders
- Type filters (Images, Video, Audio, Documents, Archives…)
- Trash with restore and "empty trash"

**Sharing**
- Generate public share links for any file
- Optional password protection and link expiry (1 / 7 / 30 days)
- QR code for every link, one-click copy
- A standalone public download page with inline preview and password gate

**Preview**
- In-browser preview for images, video, audio, PDF, plain text and code
- Graceful "download instead" fallback for everything else

**UI**
- Responsive, MediaFire-flavoured layout: top bar, sidebar, cards, table view
- Light / dark / system themes, toast notifications, accessible modals

---

## Two modes: demo & Firebase

The app **runs immediately with no setup** in **local demo mode**: metadata is
kept in `localStorage` and file blobs in `IndexedDB`, scoped to this browser.
Every feature works except cross-device access.

As soon as you drop in real Firebase keys it automatically switches to
**Firebase mode** with real auth, a Firestore database and Cloud Storage.

### 1. Run it locally

The app must be served over `http://` (Firebase Auth and IndexedDB need it), so
start any static server in this folder:

```bash
# Option A — Python (already installed on most machines)
python -m http.server 8080

# Option B — Node
npx serve .

# Option C — Node one-liner (no install)
node serve.js
```

Then open <http://localhost:8080>.

### 2. Connect Firebase (optional)

1. Create a project at <https://console.firebase.google.com>.
2. **Authentication → Sign-in method**: enable *Email/Password* and *Google*.
3. **Firestore Database**: create it, then publish the rules from
   [`firestore.rules`](firestore.rules).
4. **Storage**: enable it, then publish the rules from
   [`storage.rules`](storage.rules).
5. **Project settings → Your apps → Web app**: copy the `firebaseConfig` object
   into [`js/config.js`](js/config.js), replacing the `YOUR_...` placeholders.
6. Add your host (e.g. `localhost`, your domain) under
   **Authentication → Settings → Authorized domains**.

That's it — reload the page and the console will report `Firebase mode`.

---

## Project structure

```
cloud-storage-app/
├── index.html            # every screen (auth, app shell, modals, public page)
├── css/styles.css        # one stylesheet, CSS custom properties, dark mode
├── assets/favicon.svg
├── js/
│   ├── config.js         # Firebase keys + app constants (quota, limits, categories)
│   ├── utils.js          # DOM, formatting, file-type, icon and misc helpers
│   ├── state.js          # event bus, app state, selectors (filter + sort), toasts
│   ├── firebase.js       # CB.backend: Firebase implementation + local demo implementation
│   ├── auth.js           # login / signup / reset / Google / logout, auth gate
│   ├── files.js          # open, download, rename, star, trash, delete, selection, context menu
│   ├── folders.js        # create folders, breadcrumbs, navigation, move dialog
│   ├── upload.js         # upload queue, drag & drop, folder uploads, progress dock
│   ├── share.js          # share dialog (link/password/expiry/QR) + public page
│   ├── preview.js        # image / video / audio / PDF / text preview modal
│   ├── views.js          # renders sidebar, breadcrumbs, grid & list, quota meters
│   ├── settings.js       # dashboard + settings screen, theme handling
│   └── app.js            # bootstrap and global keyboard shortcuts
├── firestore.rules
├── storage.rules
└── serve.js              # tiny zero-dependency static server
```

---

## Data model

```
users/{uid}          { name, email, quotaBytes, usedBytes, createdAt }

files/{fileId}       { uid, name, mime, size, type, folderId, storagePath,
                       starred, trashed, shareId, createdAt, updatedAt }

folders/{folderId}   { uid, name, parentId, starred, trashed, createdAt, updatedAt }

shares/{shareId}     { uid, fileId, name, mime, size, type, storagePath, url,
                       enabled, expiresAt, expiryDays, passwordHash, createdAt }
```

Blobs live in Cloud Storage at
`users/{uid}/{randomId}/{originalFileName}`.

`CB.backend` (`js/firebase.js`) is the single abstraction the whole UI talks to,
so swapping in a different backend (S3, Supabase, a REST API…) only means
implementing the same method list — nothing in the UI changes.

---

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | Focus search |
| `Esc` | Close modal / preview |
| `Backspace` | Go up one folder |
| `Delete` | Move selection to trash |
| `Ctrl/⌘ + U` | Upload files |

---

## Security notes

- Firestore rules restrict every `files` / `folders` / `shares` write to the
  owning `uid`; share documents are publicly **readable** (needed for links)
  but only owner-writable.
- Storage rules restrict reads/writes to `users/{uid}/**` for that user and cap
  uploads at 2 GB.
- Share links use an unguessable 14-character id; the public URL stored on the
  share document is a Firebase download token, so files stay private otherwise.
- Share passwords are hashed client-side before being stored. **This is a
  convenience gate, not strong cryptography** — for sensitive data, put the
  password check behind a Cloud Function instead.

## License

MIT — do whatever you like with it.
