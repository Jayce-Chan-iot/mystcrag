# Bracelet Geometry V2

`@mystcrag/bracelet-engine` is the pure TypeScript functional core for 2.5D editing, export, thumbnails, and 3D projection. It imports no React, Next.js, DOM, Canvas, or Three.js API.

For adjacent occupied widths `wi` and `wj`, center-line radius `R`, and gap `g`, the angular step is `2 asin(((((wi + wj) / 2) + g) / (2R)))`. The engine binary-searches a stable `R` for which all adjacent steps sum to `2π`. It emits one immutable layout with radius, center, circumference, and slots containing component identity, angular range, position, dimensions, and rotation. Hit testing resolves these ranges rather than dividing by component count.

Empty/single-component inputs are explicit. Duplicate IDs, non-finite sizes, zero/negative sizes, and unsolvable geometry are rejected.

Fit vocabulary remains distinct:

- user wrist circumference — questionnaire measurement;
- target inner circumference — desired finished inner path from Design Contract;
- assembled material path — bead and inline-accessory occupied widths;
- estimated bracelet fit — current completion estimate;
- elastic allowance — Design Contract assembly allowance;
- delta — estimated fit minus target inner circumference.

The current completion range is 130–200mm inclusive. The UI must not relabel the assembled path as the user’s wrist.
