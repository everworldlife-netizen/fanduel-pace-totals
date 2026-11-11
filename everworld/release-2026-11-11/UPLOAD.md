# Release 2026-11-11

Only these files changed. Upload each Space's files to that Space and nowhere else.

## courtside-arcade

Upload page: https://huggingface.co/spaces/everworldlife/courtside-arcade/upload/main
Live link: https://everworldlife-courtside-arcade.static.hf.space/

- `app.js` (92303 bytes)
- `data.js` (19289 bytes)
- `engine.js` (198627 bytes)
- `sw.js` (1441 bytes)
- `worker.js` (2283 bytes)

With the Hugging Face CLI (after `hf auth login`):

```
hf upload everworldlife/courtside-arcade release-2026-11-11/courtside-arcade/app.js app.js --repo-type space
hf upload everworldlife/courtside-arcade release-2026-11-11/courtside-arcade/data.js data.js --repo-type space
hf upload everworldlife/courtside-arcade release-2026-11-11/courtside-arcade/engine.js engine.js --repo-type space
hf upload everworldlife/courtside-arcade release-2026-11-11/courtside-arcade/sw.js sw.js --repo-type space
hf upload everworldlife/courtside-arcade release-2026-11-11/courtside-arcade/worker.js worker.js --repo-type space
```

## gg-winner

Upload page: https://huggingface.co/spaces/everworldlife/gg-winner/upload/main
Live link: https://everworldlife-gg-winner.static.hf.space/

- `app.js` (122540 bytes)
- `index.html` (15941 bytes)
- `league-live.js` (27102 bytes)
- `profiles.js` (24820 bytes)
- `research.js` (22719 bytes)
- `sw.js` (1825 bytes)

With the Hugging Face CLI (after `hf auth login`):

```
hf upload everworldlife/gg-winner release-2026-11-11/gg-winner/app.js app.js --repo-type space
hf upload everworldlife/gg-winner release-2026-11-11/gg-winner/index.html index.html --repo-type space
hf upload everworldlife/gg-winner release-2026-11-11/gg-winner/league-live.js league-live.js --repo-type space
hf upload everworldlife/gg-winner release-2026-11-11/gg-winner/profiles.js profiles.js --repo-type space
hf upload everworldlife/gg-winner release-2026-11-11/gg-winner/research.js research.js --repo-type space
hf upload everworldlife/gg-winner release-2026-11-11/gg-winner/sw.js sw.js --repo-type space
```

After publishing: `node tools/mkrelease.js --verify release-2026-11-11` then `node tools/livecheck.js`.
