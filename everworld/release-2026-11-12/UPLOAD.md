# Release 2026-11-12

Only these files changed. Upload each Space's files to that Space and nowhere else.

## courtside-arcade

Upload page: https://huggingface.co/spaces/everworldlife/courtside-arcade/upload/main
Live link: https://everworldlife-courtside-arcade.static.hf.space/

- `app.js` (114138 bytes)
- `data.js` (23658 bytes)
- `engine.js` (234175 bytes)
- `sw.js` (1441 bytes)

On the upload page, add ALL of these files in one go and commit once (a phone that updates between two separate uploads could save a mix of old and new files).

With the Hugging Face CLI (after `hf auth login`), one commit for the whole Space:

```
hf upload everworldlife/courtside-arcade release-2026-11-12/courtside-arcade . --repo-type space --commit-message "Release 2026-11-12"
```

## gg-winner

Upload page: https://huggingface.co/spaces/everworldlife/gg-winner/upload/main
Live link: https://everworldlife-gg-winner.static.hf.space/

- `app.js` (124888 bytes)
- `index.html` (15941 bytes)
- `sw.js` (1825 bytes)

On the upload page, add ALL of these files in one go and commit once (a phone that updates between two separate uploads could save a mix of old and new files).

With the Hugging Face CLI (after `hf auth login`), one commit for the whole Space:

```
hf upload everworldlife/gg-winner release-2026-11-12/gg-winner . --repo-type space --commit-message "Release 2026-11-12"
```

Or both Spaces, with the checks, in one step: `tools/publish.sh release-2026-11-12`.

After publishing: `node tools/mkrelease.js --verify release-2026-11-12` then `node tools/livecheck.js`.
