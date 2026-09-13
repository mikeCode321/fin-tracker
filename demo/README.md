# FirePhin Demo Recorder

Playwright-based screen recorder that produces 9:16 (1080×1920) demo videos
for TikTok, Instagram Reels, and Facebook Reels.

## Setup

```bash
cd demo
npm install
npx playwright install chromium
```

## Record

```bash
npm run record
```

The browser opens, runs the full student scenario, and saves a `.webm` to
`demo/output/`. The terminal prints the `ffmpeg` commands to convert it to MP4.

## Convert to MP4

```bash
# High quality (for editing)
ffmpeg -i demo/output/<file>.webm \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  demo/output/starbucks-student.mp4

# Compressed for upload (under 50MB)
ffmpeg -i demo/output/starbucks-student.mp4 \
  -c:v libx264 -crf 26 -preset veryslow \
  -vf "scale=1080:1920" \
  demo/output/starbucks-student-compressed.mp4
```

## Tweak the scenario

Edit `scenarios/student.js` to change the profile numbers, captions, or the
before/after comparison values. The selectors in `scripts/record.js` under
`SEL` may need updating if FirePhin's DOM changes — add `data-testid`
attributes to the key inputs for the most stable targeting.

## Selector tuning

If fields aren't being found, run in debug mode:

```bash
npm run record:debug
```

This opens Playwright Inspector so you can click elements and copy their
selectors directly.

## Adding more scenarios

1. Copy `scenarios/student.js` to `scenarios/your-scenario.js`
2. Change the import at the top of `scripts/record.js`
3. Run `npm run record`