# Civic-Chain Partnership Pitchbook

A public, partner-facing proposal built as a guided, sectioned walk-through (cover → contents →
one section per view). Cloned from the gated VC catalog builder and retargeted to a **public**
outreach document: no passphrase gate, partner-appropriate copy and visuals.

**First prospect:** Broadband Telecom Services (`broadband-telecom.com`) — a Virginia firm that
already sells infrastructure to municipalities and runs BEAD federal grant services. The offer is
a **co-sell / referral partnership paying 10% of net profit on every deal they source**.

## Files

- `CIVIC-CHAIN-PARTNER-PITCHBOOK.md` — the content (source of record). Edit this to change copy.
- `build-partner-pitchbook.mjs` — the builder. Parses the markdown, splits it into sections, and
  renders the visuals (product ladder, offer tiles, step timeline, roadmap banner). Fonts, logos,
  and the civic-grid texture are inlined as data-URIs, so the page makes **zero external calls**.
- `site/index.html` — the built, publishable page (what Netlify serves).
- `render-mobile.mjs` — phone-viewport (390px) screenshot + horizontal-overflow harness.

## Build

```sh
node build-partner-pitchbook.mjs            # -> site-preview/index.html  (for review)
node build-partner-pitchbook.mjs --deploy   # -> site/index.html          (for deploy)
```

Both produce the same public page; `--deploy` just writes to the published `site/` folder.
Requires network on build (fetches the markdown renderer + Google Fonts to inline them).

## Deploy

Netlify publishes `site/` (see `netlify.toml`). The page is `noindex` — a shareable link, not a
search-indexed marketing page. To update: edit the markdown, run `--deploy`, commit, push.

## Tailoring to a new prospect

The pitchbook is written for Broadband Telecom. To retarget: edit the prospect name on the cover
and in §4 ("Why this fits …"), adjust the fit bullets to the new partner's business, rebuild.
