# OSUBB brand assets

These PNGs are byte-for-byte copies of the repository's verified OSUBB logo
exports. The filenames describe the surface they are designed for, avoiding the
ambiguous interpretation of `light` and `dark` as either artwork or background.

The official Brand Book and [`docs/brand/reference.md`](../../../../docs/brand/reference.md)
govern their use. The files in `mockup/assets` are retained only as historical
sources; application code must import assets from this directory.

| Application asset         | Historical source              | Form                                 | Intended surface |    Pixels | SHA-256                                                            |
| ------------------------- | ------------------------------ | ------------------------------------ | ---------------- | --------: | ------------------------------------------------------------------ |
| `osubb-logo-on-light.png` | `mockup/assets/logo-light.png` | Principal logo: mark + OSUBB acronym | White or light   | 889 x 459 | `30910464D92EA4F1D827150C23A2CE8CD295E373A4C6BDCA2BF3C7CE45D566C9` |
| `osubb-logo-on-dark.png`  | `mockup/assets/logo-dark.png`  | Principal logo: mark + OSUBB acronym | Black or dark    | 889 x 459 | `BEB780B9FB484252C97F71E069A5F2FECD092E5D48F14F1ACDA07A770D10210C` |
| `osubb-icon-on-light.png` | `mockup/assets/icon-light.png` | Simplified logo: mark only           | White or light   | 356 x 420 | `5DA33F09C031096560F9D15B583BE9250D8C43CFD7EC678A8FB784BE420D20D1` |
| `osubb-icon-on-dark.png`  | `mockup/assets/icon-dark.png`  | Simplified logo: mark only           | Black or dark    | 356 x 419 | `FCC8B60BBE652B2F4A367F7E38DDF34AC4F916065796A12C42E873210263B725` |

## Usage rules

- Preserve each image's aspect ratio, transparency, colours, and clear space.
- Choose the variant that contrasts with its background.
- Do not recolour, crop, distort, redraw, add shadows, apply filters, or add
  effects.
- Use the principal logo where the full lockup fits and the simplified logo in
  compact navigation.
- Add meaningful alternative text when the logo identifies OSUBB; hide a
  repeated decorative copy from assistive technology.

Logo placement belongs to GitHub issue #217. This directory deliberately makes
no screen or component decisions.
