# Fixtures

The exact government artwork the example annotations are pinned to. Each
annotation carries the SHA-256 of the file it was measured against, and
`tfa lint --pdf <file>` verifies the two agree.

| File | Form | Source | SHA-256 |
| --- | --- | --- | --- |
| `f1040.pdf` | Form 1040 (2025), 2 pages, 612 × 792 | <https://www.irs.gov/pub/irs-pdf/f1040.pdf> | `3d31c226df0d189ced80e039d01cf0f8820c1019681a0f0ca6264de277b7e982` |
| `f1040sc.pdf` | Schedule C (Form 1040) (2025), 2 pages, 612 × 792 | <https://www.irs.gov/pub/irs-pdf/f1040sc.pdf> | `ddf401dbe060467d39f90ad2abf645df1de31512821a150dc68a3882bbf19716` |
| `f941.pdf` | Form 941 (Rev. March 2026), 3 pages, 611.976 × 791.968 | <https://www.irs.gov/pub/irs-pdf/f941.pdf> | `38a3d8cf7a455101d52543c8c48e66202bc25c189ead878627e35c797c88e2ad` |
| `f941sb.pdf` | Schedule B (Form 941) (Rev. March 2024), 1 page, 610.976 × 791.968 | <https://www.irs.gov/pub/irs-pdf/f941sb.pdf> | `95a62159c8367fc50e6b5445f7d80f9a00ac7cdf56d224240fc2776cb545ab63` |

All four are IRS publications in the public domain.

The IRS reissues forms during a season, so the copy at those URLs will not stay
byte-identical to these. That is the entire reason `media.sha256` exists: a
newer file is not a drop-in replacement for coordinates measured against an
older one, and the linter refuses rather than letting it slide.

## How the geometry was derived

```bash
node tools/extract-widgets.mjs fixtures/f1040.pdf              # box for every fillable field
node tools/measure-comb.mjs fixtures/f1040.pdf --page 1 \
    --rect 466 94 114 14 --digits 9 --right 576                # the printed cell dividers
```

The first reads the PDF's own AcroForm widget rectangles and converts them to
TFA's top-left origin. The second rasterises the page at 600 dpi and finds the
vertical rules inside a comb box, because widget rectangles say where a box is
but not where the ticks inside it fall — and on these forms they are not evenly
spaced.
