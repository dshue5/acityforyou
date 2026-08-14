# Vibe Cartographer

A 33-city vibe quiz. Pure static site — no build step, no dependencies.

## Run locally
Just open `index.html` in a browser. That's it.
(Or serve it: `npx serve` from this folder, then visit the printed URL.)

## Files
- `index.html` — page skeleton, loads the CSS + JS
- `style.css`  — all styling
- `data.js`    — CITIES, BIAS (fairness offsets), BIO, FAMILIES (questions + answer vectors), glyphs. **Edit content here.**
- `main.js`    — the matching engine and rendering. Rarely needs touching.
- `public/art/`— drop commissioned images here later

## Deploy to Vercel
Option A — dashboard:
1. Push this folder to a GitHub repo.
2. vercel.com -> Add New -> Project -> Import the repo.
3. Framework preset: **Other** (it's static). No build command, no output dir needed.
4. Deploy. Every `git push` redeploys.

Option B — CLI:
1. `npm i -g vercel`
2. From this folder: `vercel` (follow prompts). `vercel --prod` to promote.

## Analytics
When live, paste your PostHog snippet into the `<head>` of `index.html`
(there's a comment marking the spot).

## Editing the quiz
- Change a question or answer: edit `FAMILIES` in `data.js`.
- Change a city's coordinates or bio: edit `CITIES` / `BIO` in `data.js`.
- Note: if you change answer *vectors* or add/remove cities, the `BIAS`
  fairness offsets should be re-tuned to keep results evenly distributed.
