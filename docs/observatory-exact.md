# Cloud-reference Observatory

The visual artwork is extracted locally from Jenny's supplied 576×1024 reference, not a new generated interpretation. Her original image is never edited. `scripts/extract-observatory-art.py` removes the reference typography and number; React renders all text and values live in Lexend. The cloud sky, crystal, cubes, orbit, rainbow pedestal, input glass and list frame retain their original positions.

At 576px, the input is x=64, y=545, 448×72; tabs begin y=681; the list begins y=739.5. Desktop centers the same maximum-576px column. Smaller widths scale the reference proportionately.

## Functionality

- Simple = A1…Z26; English = A6…Z156; existing Hebrew-letter ciphers unchanged. All older reverse/reduction/final options remain under Library of Light → Cipher options.
- Existing `wilson_gematria_phrase_library_v1` data is retained. Add, search, select, remove and save remain local.
- Import uses the owner's worker `/gematrix` route, never a public CORS proxy. Imported phrases persist immediately, and Matches compares their calculated totals in the selected cipher. The three source result tables are imported; gematrix's Latin "Jewish" table is explicitly distinguished from Wilson's Hebrew-letter cipher.
- Water Memory is a local reflection journal. No Water Memory implementation existed in the inspected component/history, so this is a new modest journal, not a claim that legacy behavior/data was restored. Its key is `wilson_observatory_water_memory_v1`. There are no scientific claims about water.

## Verification on this box

- `npm run build` and existing Gematria contracts, expanded for English/Simple.
- `/workspace/shotkit/obs-exact.cjs`: 576×1024, 1440×1100 and 390×844 screenshots; totals, storage, reflections and console checks.
- `/workspace/shotkit/obs-exact-import.cjs`: real HTTP import against the local worker handler, CORS, persistence/reload, imported Matches, keyboard ciphers, error path.
- Local import build: `VITE_GEMATRIX_ENDPOINT=http://127.0.0.1:8789/gematrix npm run build`. Normal builds use the production worker endpoint. This is a test-only override, never a committed localhost endpoint.
- Real Wilson import returned 97 unique phrases; 96 newly saved, 48 imported Simple matches + 4 built-in matches. All 97 source Simple totals matched Wilson's own calculation.

## Honest remaining differences

The live gold numeral uses Lexend and the reference's sampled glitter palette, so its glyph shape differs from the reference illustration. Small inpainting differences remain behind removed labels/number. The tiny close control is an additional app necessity.

The illustrated list is NOT arithmetically accurate: "THE KEY IS HIDDEN" = 146, "DIVINE LIGHT" = 119, "STAR OF DAVID" = 119, "COSMIC WISDOM" = 145 in Simple, not 144/108/72/180. Those phrases are saved as starter entries, but Matches displays real equal-total phrases instead. The default four are COSMIC PEACE, HEART MIND, INNER LIFE, SACRED SELF (all 92).

## Publication status

Prepared locally only. No frontend push/merge and no worker deployment are part of this preview. A screenshot was promised before anything goes live; obtain the owner's approval before publishing. The worker change must be deployed before production imports can work.
