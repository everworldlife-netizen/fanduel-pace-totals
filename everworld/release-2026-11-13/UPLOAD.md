# Release 2026-11-13

Only these files changed. Upload each Space's files to that Space and nowhere else.

## courtside-arcade

Upload page: https://huggingface.co/spaces/everworldlife/courtside-arcade/upload/main
Live link: https://everworldlife-courtside-arcade.static.hf.space/

- `app.js` (119217 bytes)
- `engine.js` (241129 bytes)
- `sw.js` (1441 bytes)

On the upload page, add ALL of these files in one go and commit once (a phone that updates between two separate uploads could save a mix of old and new files).

With the Hugging Face CLI (after `hf auth login`), one commit for the whole Space:

```
hf upload everworldlife/courtside-arcade release-2026-11-13/courtside-arcade . --repo-type space --commit-message "Release 2026-11-13"
```

## gg-winner

Upload page: https://huggingface.co/spaces/everworldlife/gg-winner/upload/main
Live link: https://everworldlife-gg-winner.static.hf.space/



On the upload page, add ALL of these files in one go and commit once (a phone that updates between two separate uploads could save a mix of old and new files).

With the Hugging Face CLI (after `hf auth login`), one commit for the whole Space:

```
hf upload everworldlife/gg-winner release-2026-11-13/gg-winner . --repo-type space --commit-message "Release 2026-11-13"
```

Or both Spaces, with the checks, in one step: `tools/publish.sh release-2026-11-13`.

After publishing: `node tools/mkrelease.js --verify release-2026-11-13` then `node tools/livecheck.js`.
