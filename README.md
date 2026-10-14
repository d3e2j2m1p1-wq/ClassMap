# ClassMap

Seating chart maker for teachers. Runs entirely in the browser; everything is saved on the
teacher's device (with "Back up everything" for a file copy). Works offline as an installable app.

## Getting started

Needs [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install                 # once
npx playwright install chromium   # once, for the tests
npm run dev                 # local site with live reload → http://localhost:5173 (app: /app/)
npm test                    # browser tests (starts the dev server by itself)
npm run build               # finished site in dist/
npm run preview             # serve dist/ locally to check the build
```

## The site

| Address | File | What it is |
|---|---|---|
| `/` | `index.html` | public home page |
| `/app/` | `app/index.html` | the app |
| `/guides/` | `guides/index.html` | seating chart guides (one folder per guide) |
| `/privacy/` | `privacy/index.html` | privacy policy |

`public/` (copied as-is): `manifest.json` (installable app, opens `/app/`), `icons/`, `sw.js`.

**Before going public:** replace the `TODO` contact email in `index.html` and `privacy/index.html`.

**Google sign-in / Drive sync** is optional and off until you add a client ID — see `GOOGLE_SETUP.md`.

## Where data is saved
IndexedDB in the browser (`src/storage/db.js`); data from older versions is moved over from
localStorage automatically. Optional copy in the teacher's own Google Drive (`src/storage/drive.js`,
merge rules in `src/storage/merge.js`).

`public/sw.js` is a new service worker made for this build: the page is fetched fresh
whenever the teacher is online, and the JS/CSS files (whose names change every release)
are cached for offline use. It replaces the old one.

## Deploying

**Automatic (recommended):** push to `main`. `.github/workflows/deploy.yml` builds the site
and publishes it to GitHub Pages. One-time setup: repo Settings → Pages → Source: "GitHub Actions".

**By hand:** `npm run build`, then upload the contents of `dist/`.

If you used ClassMap at its old address (the app at the site root), teachers' saved data is
tied to the site's origin, not the path, so it is still there at `/app/`.

The build uses relative paths, so it works at `username.github.io/ClassMap/` now and on
your own domain later, with no changes.

## How the code is organized

```
index.html                  public home page
privacy/index.html          privacy policy
guides/                     seating chart guides (each guide: guides/<name>/index.html;
                            new folders are built automatically — add them to public/sitemap.xml)
app/index.html              the app's markup (header, tabs, panels, modals, home page)
src/
  config.js                 Google client ID (from .env) and Drive file name
  site/site.css             styles for the public pages
  main.js                   entry: loads styles, exposes onclick functions, starts the app
  core/
    store.js                values several modules change (open chart's photo, selections, landingData…)
    state.js                open chart's state, ids, roster groups and colours
    ui.js                   modals and toasts
  editor/                   chart editor: panel switching, roster view, rules,
                            undo.js (undo/redo), present.js (Present + Print)
  layout/
    canvas.js               Layout tab: tools, placing, moving, rotating
    tables.js               table seats: add, remove, drag
    tableGroups.js          splitting tables into groups + the Table tool / table label menus
    image.js                classroom photo upload and shrinking
  assign/
    panel.js                Assign tab drawing (tables, seat chips, unplaced list)
    interactions.js         tap / drag to seat students (mouse, pen, touch)
    seats.js                every seat's position and group
    rulesEngine.js          checks rules (separate, near, same group, front/back)
    autoAssign.js           auto-assign, the rule-fixing swaps, pins
    repeats.js              who sat together in recent charts (avoid repeat partners)
  roster/                   built-in name list, learned name list, roster paste parsing
  storage/                  db.js (IndexedDB), landingData.js (load/save), autosave, chart file
                            export/import, full backup/restore, drive.js (Google sign-in + sync),
                            merge.js (combining two devices' data)
  landing/                  home page: classes, chart timeline (new chart reuses the room, copy chart),
                            roster, rules, name list viewer, welcome.js (first run, sample class,
                            backup reminder, error banner)
  ui/theme.js               light/dark toggle
  styles/                   CSS, loaded in the order listed in main.js
public/sw.js                service worker (offline support)
tests/app.spec.js           browser tests
```

Two things to know when editing:

- **Functions called from `onclick="…"` in HTML** must be global. They're listed in
  `Object.assign(window, { … })` in `src/main.js` — add new ones there.
- **Shared values that several modules change** live on `store` (`src/core/store.js`), e.g.
  `store.landingData`, `store.layoutImg`, `store.selectedSeatId`. Everything else is a normal
  `import`.

In dev mode every module's exports are also available in the browser console as `window.__cm`
(the tests use it). It isn't included in the built site.
