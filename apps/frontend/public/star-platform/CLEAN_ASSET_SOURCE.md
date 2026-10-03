# Star Platform clean imagery — provenance and acceptance record

Task: `TASK-UX-ASSET-001` (branch `task/ux-asset-001-clean-images`). Registered 2026-10-04.

This file is the runtime provenance record for the six curated "clean" Star Platform
images. The 2026-09 delivery kit keeps its own record in `UPSTREAM_SOURCE.md`; the two
sets are independent and the seven earlier files are **kept on disk unchanged as the
rollback fallback** (they were not overwritten).

## Generation and toolchain

- Source imagery was produced for the project by the Product Owner with their own image
  generation workflow, delivered under
  `/Users/chenyanyan/.codex/visualizations/2026-10-03/01a101bc-eb7f-7e30-8b34-68f04436d255/`.
  The `mystcrag-product-images-v3/` set was reviewed and rejected file-by-file on
  2026-10-03; `mystcrag-product-images-v3-refined/` is the follow-up set.
- Runtime encoding on 2026-10-04 with `cwebp 1.6.0` (libsharpyuv 0.4.2):
  `cwebp -q 82 -m 6 -quiet <source>.png -o <name>.webp`. No cropping, no padding, no
  colour filter, no retouching. Delivered pixels equal source pixels for every file.
- Hero enlargement used macOS `sips --resampleHeightWidth` (see the interpolation note
  below). It was performed by the Product Owner before this task, and the resulting PNGs
  are recorded here by SHA-256.

## Resolution basis — the two heroes are interpolated derivatives

`hero-clean-desktop.webp` and `hero-clean-mobile.webp` are **not native high-resolution
captures (非原生高分辨率采集)**. They are direct interpolation enlargements of smaller
retained originals, approved by the Product Owner on 2026-10-04 (spec §3.1) purely to
reach the current delivery gate:

| Delivered file | Interpolated derivative | Derivative SHA-256 | Retained original | Original size |
| --- | --- | --- | --- | --- |
| `hero-clean-desktop.webp` | `01-desktop-home-hero-v3-upscaled-1920x1080.png` (1920×1080) | `dc6a081be680f5ab5e727c897504426fdd6ddf5ca662997b0d16d848c0a45f01` | `01-desktop-home-hero-v3-refined.png` | 1672×941, `f67b271101921dd5abbb90246c2c4e639993148c21f798e95a1b0e623019206a` |
| `hero-clean-mobile.webp` | `03-mobile-home-hero-v3-upscaled-1080x1920.png` (1080×1920) | `da07d57b55c4c661dea6f5d4905fc4bea4f744762e8817631069124e4e1a56cc` | `03-mobile-home-hero-v3-refined.png` | 941×1672, `74652dfababd0dfdb98cf1052cb948acb871f50f0079d2d1cfe1e1f70bdfd152` |

Both are a uniform ≈1.148× resample with unchanged composition. Meeting 1920×1080 /
1080×1920 in pixels does **not** mean the images carry that much real detail, and it does
not by itself constitute visual acceptance. `STAR_PLATFORM_MIN_SIZE` was **not** lowered;
the portrait mobile hero is gated by its own independent 1080×1920 assertion in
`star-assets.test.tsx`.

## Registered assets

Source directory for every row: `mystcrag-product-images-v3-refined/`.

| Runtime path | Key | 用途 (purpose) | Delivered size | Source SHA-256 | Delivered SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `hero-clean-desktop.webp` | `heroCleanDesktop` | 首页桌面横版主视觉 | 1920×1080 | `dc6a081be680f5ab5e727c897504426fdd6ddf5ca662997b0d16d848c0a45f01` | `f910aabf0d0113d47833eb27dbc290f1fac28b03ed88c06ab5ac186714d0ec08` |
| `hero-clean-mobile.webp` | `heroCleanMobile` | 首页手机竖版主视觉 | 1080×1920 | `da07d57b55c4c661dea6f5d4905fc4bea4f744762e8817631069124e4e1a56cc` | `eae1d4080dab5987a4810e66fb9a461c7321be06bada935d079eae04a0b12717` |
| `entry-ai-clean.webp` | `entryAiClean` | AI 设计方向入口卡配图 | 1448×1086 | `30f84078e68dcc658f19c5824c9358fb0d232cefa93169f350d16e09e16f0769` (`05-crystal-color-v3-refined.png`) | `93532c137692f30dce59336f6d3236948473206ad423eaca39062d73a973d051` |
| `entry-oracle-clean.webp` | `entryOracleClean` | 星台问卦入口卡装饰氛围图 | 1448×1086 | `f4429ca3dbcf2f8ae33df1687d0efdbc326c4b3b628c16cfc023715ea857fc5c` (`02-oracle-user-selected-unchanged.png`) | `c9da129a79bbf5d3b4d429fe776786cdbdfd0668ca126b72a0d21f81f8f7a277` |
| `entry-tarot-clean.webp` | `entryTarotClean` | Tarot 入口卡装饰氛围图 | 1447×1087 | `65582003f5a18475690b03356f87e0b7ca5e2d64235f5e09c0fe438eeab8ce24` (`06-tarot-user-selected-unchanged.png`) | `7ea42a010ae2b9ce7bb9ce06a1a6376ccb80a044bd8e303aaa5aa2dd9c185199` |
| `entry-diy-clean.webp` | `entryDiyClean` | DIY 手作入口卡配图 | 1448×1086 | `d71455b124a882dac58dda164ba59749ff0aef7294dab3993b65ac85cdde0267` (`04-diy-v3-refined.png`) | `736b72ab8907a135e5208e97a0d2a4259a82d9f5880d414311d37626c88d4d11` |

`entry-tarot-clean.webp` is 1447×1087 (odd dimensions, preserved by `cwebp` in a `VP8 `
chunk); it was not trimmed to even dimensions.

## Manual acceptance at original size (2026-10-04)

Every file above was opened at its native pixel size and inspected before registration.
Automated tests only prove file identity, format, dimensions, mapping and provenance —
they cannot prove the tray is empty, that the tool is a hooked needle, or that any card
art is acceptable. Those judgements are recorded here.

- `hero-clean-desktop.webp` — accepted. Flat matte warm off-white surface, no marble
  veining or crack lines; left ~45% quiet for the headline; card shows an abstract
  engraved star chart, not a figurative tarot face; no text, no price.
- `hero-clean-mobile.webp` — accepted. Same matte surface, portrait composition with a
  clear quiet band in the lower third; abstract star-chart card back only; no text, no
  price.
- `entry-ai-clean.webp` — accepted. Flat matte surface; the rough granite slabs of the
  rejected v3 frame were replaced by smooth matte stone and a matte ceramic bowl; five
  loose unthreaded beads plus a blank five-chip colour card; no text, no price, no
  finished bracelet.
- `entry-diy-clean.webp` — accepted. Verified by native-resolution crop: the round tray
  is **completely empty** (no preset sample bead), and the right-hand tool is a genuine
  beading needle with a **clear small curved hook** at its tip — not an awl, spike or
  reamer. Background is flat matte with no veining.
- `entry-oracle-clean.webp` — **accepted only as a Product Owner selection exception.**
  The aged square-hole coins carry inscription-like marks and the stone is rough, which
  does not satisfy the "blank brass discs only (no coin inscriptions)" rule for
  `entryOracle` in `docs/UI_REFERENCE_AND_ASSET_MANIFEST.md`. Spec §3.1 (2026-10-03)
  records the owner's byte-exact selection of this file, which overrides that rule for
  this decorative entry only. The delivered file hash-matches the pinned source.
- `entry-tarot-clean.webp` — **accepted only as a Product Owner selection exception.**
  It contains two clearly illustrated card faces and an ornate moon-phase back, which
  does not satisfy the "blank card backs and instruments only" rule for `entryTarot`.
  Spec §3.1 records the owner's byte-exact selection. Standing condition: these
  illustrations are mood art for the entry card, are **not** the licensed Rider–Waite
  assets in `apps/frontend/public/tarot/cards/`, and must never be presented as real
  card faces or draw results. The runtime deck is unchanged by this task.

Interpolation quality note: at 2× inspection the two heroes are soft but free of
seams, banding or ringing; the fine gold linework on the card is where the resample
limit shows. Acceptable for full-bleed `object-fit: cover` use at the 1440×900 and
390×844 acceptance viewports, not as a detail-critical crop.

## Rights and usage

- All six files are project-owned imagery supplied by the Product Owner for this
  product; no competitor screenshot, user data, or planning image was used as runtime
  media.
- The two owner-selected entry files are used solely as decorative entry-card art.
- Before any public or commercial release, archive the written authorization for the
  supplied imagery alongside the existing Tarot deck rights gate in
  `apps/frontend/public/tarot/cards/UPSTREAM_SOURCE.md`. This record is not a
  substitute for that release evidence.
