# Release 2026-11-11

Only these files changed. Upload each Space's files to that Space and nowhere else.

## courtside-arcade

Upload page: https://huggingface.co/spaces/everworldlife/courtside-arcade/upload/main
Live link: https://everworldlife-courtside-arcade.static.hf.space/

- `app.js` (92762 bytes)
- `data.js` (19786 bytes)
- `engine.js` (204750 bytes)
- `sw.js` (1441 bytes)
- `worker.js` (2283 bytes)

On the upload page, add ALL of these files in one go and commit once (a phone that updates between two separate uploads could save a mix of old and new files).

With the Hugging Face CLI (after `hf auth login`), one commit for the whole Space:

```
hf upload everworldlife/courtside-arcade release-2026-11-11/courtside-arcade . --repo-type space --commit-message "Release 2026-11-11"
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

On the upload page, add ALL of these files in one go and commit once (a phone that updates between two separate uploads could save a mix of old and new files).

With the Hugging Face CLI (after `hf auth login`), one commit for the whole Space:

```
hf upload everworldlife/gg-winner release-2026-11-11/gg-winner . --repo-type space --commit-message "Release 2026-11-11"
```

Or both Spaces, with the checks, in one step: `tools/publish.sh release-2026-11-11`.

After publishing: `node tools/mkrelease.js --verify release-2026-11-11` then `node tools/livecheck.js`.
