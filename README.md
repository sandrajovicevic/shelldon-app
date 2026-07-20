# Shelldon

A grumpy, deadpan, weirdly helpful 8-bit shell that helps ADHD brains beat decision paralysis. Think Magic Conch from SpongeBob, crossed with Clippy's earnestness and Squidward's total lack of enthusiasm about it.

Give Shelldon 2-5 things you're stuck between, shake him, and he picks one. You get 10 seconds to lock it in, one re-roll max, then mark it done or skip it — no guilt either way. A light streak counter tracks days you actually followed through.

## Running it

No build step. It's a static PWA — open `index.html` in a browser, or serve the folder with any static server:

```
python3 -m http.server 8080
```

## Installing on a phone

Serve it over HTTPS (e.g. GitHub Pages), then use "Add to Home Screen" (iOS Safari) or "Install app" (Android Chrome). It works offline once installed.

## Structure

- `index.html`, `styles.css`, `app.js` — the app
- `shell-design.js` — shared pixel-art module; generates Shelldon's expressions for both the live in-app character and the manifest icons
- `scripts/gen-icons.js` — regenerates `icons/*.png` from `shell-design.js`
- `scripts/e2e-check.js` — a Playwright smoke-test driver for the golden path (dev tool, not required to run the app)
- `manifest.webmanifest`, `service-worker.js` — PWA install + offline support
