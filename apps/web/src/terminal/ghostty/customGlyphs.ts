// Block elements and box-drawing lines must tile edge to edge, but font glyphs
// only span the em box, so the terminal line height leaves gaps between rows
// (QR codes, logos, borders). These glyphs are drawn as shapes that fill the
// whole cell instead, snapped to device pixels so neighbors share edges.

type Rect = readonly [x: number, y: number, width: number, height: number];

const EIGHTH = 1 / 8;
const UPPER_LEFT: Rect = [0, 0, 0.5, 0.5];
const UPPER_RIGHT: Rect = [0.5, 0, 0.5, 0.5];
const LOWER_LEFT: Rect = [0, 0.5, 0.5, 0.5];
const LOWER_RIGHT: Rect = [0.5, 0.5, 0.5, 0.5];

// U+2580..U+259F in cell fractions. Shades (U+2591..U+2593) are handled apart.
const BLOCK_RECTS: Readonly<Record<number, readonly Rect[]>> = {
  0x2580: [[0, 0, 1, 0.5]],
  0x2581: [[0, 1 - EIGHTH, 1, EIGHTH]],
  0x2582: [[0, 1 - 2 * EIGHTH, 1, 2 * EIGHTH]],
  0x2583: [[0, 1 - 3 * EIGHTH, 1, 3 * EIGHTH]],
  0x2584: [[0, 0.5, 1, 0.5]],
  0x2585: [[0, 1 - 5 * EIGHTH, 1, 5 * EIGHTH]],
  0x2586: [[0, 1 - 6 * EIGHTH, 1, 6 * EIGHTH]],
  0x2587: [[0, 1 - 7 * EIGHTH, 1, 7 * EIGHTH]],
  0x2588: [[0, 0, 1, 1]],
  0x2589: [[0, 0, 7 * EIGHTH, 1]],
  0x258a: [[0, 0, 6 * EIGHTH, 1]],
  0x258b: [[0, 0, 5 * EIGHTH, 1]],
  0x258c: [[0, 0, 0.5, 1]],
  0x258d: [[0, 0, 3 * EIGHTH, 1]],
  0x258e: [[0, 0, 2 * EIGHTH, 1]],
  0x258f: [[0, 0, EIGHTH, 1]],
  0x2590: [[0.5, 0, 0.5, 1]],
  0x2594: [[0, 0, 1, EIGHTH]],
  0x2595: [[1 - EIGHTH, 0, EIGHTH, 1]],
  0x2596: [LOWER_LEFT],
  0x2597: [LOWER_RIGHT],
  0x2598: [UPPER_LEFT],
  0x2599: [UPPER_LEFT, LOWER_LEFT, LOWER_RIGHT],
  0x259a: [UPPER_LEFT, LOWER_RIGHT],
  0x259b: [UPPER_LEFT, UPPER_RIGHT, LOWER_LEFT],
  0x259c: [UPPER_LEFT, UPPER_RIGHT, LOWER_RIGHT],
  0x259d: [UPPER_RIGHT],
  0x259e: [UPPER_RIGHT, LOWER_LEFT],
  0x259f: [UPPER_RIGHT, LOWER_LEFT, LOWER_RIGHT],
};

const SHADE_ALPHA: Readonly<Record<number, number>> = {
  0x2591: 0.25,
  0x2592: 0.5,
  0x2593: 0.75,
};

// Arm weights in up/right/down/left order: 0 none, 1 light, 2 heavy.
// U+2500..U+254B; null entries (dashed lines) fall back to the font.
// prettier-ignore
const BOX_ARMS: readonly (string | null)[] = [
  "0101", "0202", "1010", "2020", null, null, null, null,
  null, null, null, null, "0110", "0210", "0120", "0220",
  "0011", "0012", "0021", "0022", "1100", "1200", "2100", "2200",
  "1001", "1002", "2001", "2002", "1110", "1210", "2110", "1120",
  "2120", "2210", "1220", "2220", "1011", "1012", "2011", "1021",
  "2021", "2012", "1022", "2022", "0111", "0112", "0211", "0212",
  "0121", "0122", "0221", "0222", "1101", "1102", "1201", "1202",
  "2101", "2102", "2201", "2202", "1111", "1112", "1211", "1212",
  "2111", "1121", "2121", "2112", "2211", "1122", "1221", "2212",
  "1222", "2122", "2221", "2222",
];

// U+2574..U+257F half lines.
// prettier-ignore
const HALF_LINE_ARMS: readonly string[] = [
  "0001", "1000", "0100", "0010", "0002", "2000",
  "0200", "0020", "0201", "1020", "0102", "2010",
];

function boxArms(code: number): string | null {
  if (code >= 0x2500 && code <= 0x254b) return BOX_ARMS[code - 0x2500] ?? null;
  if (code >= 0x2574 && code <= 0x257f) return HALF_LINE_ARMS[code - 0x2574] ?? null;
  return null;
}

function singleCodePoint(text: string): number | null {
  return text.length === 1 ? text.charCodeAt(0) : null;
}

export function isGhosttyCustomGlyph(text: string): boolean {
  const code = singleCodePoint(text);
  if (code === null || code < 0x2500 || code > 0x259f) return false;
  if (code >= 0x2580) return true;
  return (code >= 0x256d && code <= 0x2570) || boxArms(code) !== null;
}

/**
 * Draws `text` filling the cell at (left, top) when it is a block or box glyph.
 * Uses the caller's fillStyle. Returns false when the font should draw it.
 */
export function drawGhosttyCustomGlyph(
  context: CanvasRenderingContext2D,
  text: string,
  left: number,
  top: number,
  width: number,
  height: number,
  pixelRatio: number,
): boolean {
  const code = singleCodePoint(text);
  if (code === null) return false;
  const snap = (value: number) => Math.round(value * pixelRatio) / pixelRatio;

  const rects = BLOCK_RECTS[code];
  const shade = SHADE_ALPHA[code];
  if (rects !== undefined || shade !== undefined) {
    const fill = (rect: Rect) => {
      const x0 = snap(left + rect[0] * width);
      const y0 = snap(top + rect[1] * height);
      const x1 = snap(left + (rect[0] + rect[2]) * width);
      const y1 = snap(top + (rect[1] + rect[3]) * height);
      context.fillRect(x0, y0, x1 - x0, y1 - y0);
    };
    if (shade !== undefined) {
      const alpha = context.globalAlpha;
      context.globalAlpha = alpha * shade;
      fill([0, 0, 1, 1]);
      context.globalAlpha = alpha;
    } else {
      for (const rect of rects ?? []) fill(rect);
    }
    return true;
  }

  // Line strokes are whole device pixels centered on the cell, so every glyph
  // in a border lands on the same pixel column or row.
  const light = Math.max(1, Math.round(Math.min(width, height) * pixelRatio * 0.12)) / pixelRatio;
  const thickness = (weight: number) => (weight === 2 ? light * 2 : light);
  const lineStart = (center: number, size: number) => snap(center - size / 2);
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  const right = snap(left + width);
  const bottom = snap(top + height);
  const cellLeft = snap(left);
  const cellTop = snap(top);

  if (code >= 0x256d && code <= 0x2570) {
    const x = lineStart(centerX, light) + light / 2;
    const y = lineStart(centerY, light) + light / 2;
    const radius = Math.min(width, height) / 2;
    const towardDown = code === 0x256d || code === 0x256e;
    const towardRight = code === 0x256d || code === 0x2570;
    context.save();
    context.strokeStyle = context.fillStyle;
    context.lineWidth = light;
    context.beginPath();
    context.moveTo(x, towardDown ? bottom : cellTop);
    context.arcTo(x, y, towardRight ? right : cellLeft, y, radius);
    context.lineTo(towardRight ? right : cellLeft, y);
    context.stroke();
    context.restore();
    return true;
  }

  const arms = boxArms(code);
  if (arms === null) return false;
  const [up, rightArm, down, leftArm] = [...arms].map(Number) as [number, number, number, number];
  // Arms overlap through the center by the widest crossing stroke so joints are solid.
  const verticalSize = thickness(Math.max(up, down));
  const horizontalSize = thickness(Math.max(leftArm, rightArm));
  const verticalReach = up || down ? verticalSize / 2 : 0;
  const horizontalReach = leftArm || rightArm ? horizontalSize / 2 : 0;
  if (up) {
    const size = thickness(up);
    const end = snap(centerY + horizontalReach);
    context.fillRect(lineStart(centerX, size), cellTop, size, Math.max(end - cellTop, size));
  }
  if (down) {
    const size = thickness(down);
    const start = snap(centerY - horizontalReach);
    context.fillRect(lineStart(centerX, size), start, size, bottom - start);
  }
  if (leftArm) {
    const size = thickness(leftArm);
    const end = snap(centerX + verticalReach);
    context.fillRect(cellLeft, lineStart(centerY, size), Math.max(end - cellLeft, size), size);
  }
  if (rightArm) {
    const size = thickness(rightArm);
    const start = snap(centerX - verticalReach);
    context.fillRect(start, lineStart(centerY, size), right - start, size);
  }
  return true;
}
