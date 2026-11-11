#!/usr/bin/env node
/* Collect what a release changes, per Space, into a dated folder, with checksums and upload notes.
 *   node tools/mkrelease.js [--date 2026-11-11]
 * Compares the working copies (cs/build, gg/static) with what is live (baseline/) and copies only the changed files.
 * After publishing, verify byte for byte:  node tools/mkrelease.js --verify release-<date>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('./lib');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const SPACES = [
  { name: 'courtside-arcade', work: 'cs/build', base: 'baseline/cs', live: 'https://everworldlife-courtside-arcade.static.hf.space/', upload: 'https://huggingface.co/spaces/everworldlife/courtside-arcade/upload/main' },
  { name: 'gg-winner', work: 'gg/static', base: 'baseline/gg', live: 'https://everworldlife-gg-winner.static.hf.space/', upload: 'https://huggingface.co/spaces/everworldlife/gg-winner/upload/main' },
];
const SKIP = /(^|\/)(icons|screens|seed)\/|\.png$|\.gitattributes$|^README\.md$|^app\.py$|^requirements\.txt$/;
function walk(dir, rel = '') { const out = []; for (const f of fs.readdirSync(path.join(dir, rel))) { const r = rel ? `${rel}/${f}` : f; if (fs.statSync(path.join(dir, r)).isDirectory()) out.push(...walk(dir, r)); else out.push(r); } return out; }

if (argv.includes('--verify')) {
  const dir = path.resolve(L.ROOT, arg('--verify'));
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  (async () => {
    let ok = true;
    for (const sp of man.spaces) for (const f of sp.files) {
      const r = await fetch(sp.live + f.path + `?t=${Date.now()}`, { headers: { 'User-Agent': L.UA } });
      const buf = Buffer.from(await r.arrayBuffer());
      const same = r.ok && sha(buf) === f.sha256;
      if (!same) ok = false;
      console.log(`${same ? 'same' : 'DIFFERENT'}  ${sp.name}/${f.path}`);
    }
    console.log(ok ? 'Live files match the release byte for byte.' : 'Live files do NOT match the release yet.');
    process.exit(ok ? 0 : 1);
  })();
} else {
  const date = arg('--date', new Date().toISOString().slice(0, 10));
  const out = path.join(L.ROOT, `release-${date}`);
  fs.rmSync(out, { recursive: true, force: true });
  const man = { date, spaces: [] };
  let notes = `# Release ${date}\n\nOnly these files changed. Upload each Space's files to that Space and nowhere else.\n`;
  for (const sp of SPACES) {
    const files = [];
    for (const f of walk(path.join(L.ROOT, sp.work))) {
      if (SKIP.test(f)) continue;
      const a = fs.readFileSync(path.join(L.ROOT, sp.work, f));
      const bp = path.join(L.ROOT, sp.base, f);
      if (fs.existsSync(bp) && sha(fs.readFileSync(bp)) === sha(a)) continue;
      fs.mkdirSync(path.dirname(path.join(out, sp.name, f)), { recursive: true });
      fs.writeFileSync(path.join(out, sp.name, f), a);
      files.push({ path: f, bytes: a.length, sha256: sha(a) });
    }
    man.spaces.push({ name: sp.name, live: sp.live, upload: sp.upload, files });
    notes += `\n## ${sp.name}\n\nUpload page: ${sp.upload}\nLive link: ${sp.live}\n\n${files.map((f) => `- \`${f.path}\` (${f.bytes} bytes)`).join('\n')}\n\nOn the upload page, add ALL of these files in one go and commit once (a phone that updates between two separate uploads could save a mix of old and new files).\n\nWith the Hugging Face CLI (after \`hf auth login\`), one commit for the whole Space:\n\n\`\`\`\nhf upload everworldlife/${sp.name} release-${date}/${sp.name} . --repo-type space --commit-message "Release ${date}"\n\`\`\`\n`;
  }
  notes += `\nOr both Spaces, with the checks, in one step: \`tools/publish.sh release-${date}\`.\n\nAfter publishing: \`node tools/mkrelease.js --verify release-${date}\` then \`node tools/livecheck.js\`.\n`;
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(man, null, 1));
  fs.writeFileSync(path.join(out, 'UPLOAD.md'), notes);
  for (const sp of man.spaces) console.log(`${sp.name}: ${sp.files.map((f) => f.path).join(', ')}`);
  console.log(`→ ${out}`);
}
