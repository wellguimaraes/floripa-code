import { useEffect, useMemo } from "react";
import { CanvasTexture, Color, SRGBColorSpace } from "three";

import type { WorldSlot } from "../definition/types";
import { KeepColorContext, keepColors } from "./contrast";
import { geometry } from "./geometries";
import { LitMaterial } from "./lighting";
import { palette } from "./palette";

const BOARD_HEIGHT = 2.2;
const BOARD_LIFT = 4.2;
const FRAME = 0.28;
const POLE_WIDTH = 0.42;
/** A chunky board, so it reads as a solid object rather than a card. */
const DEPTH = 0.5;
/** How high the sign reaches, so the camera can fit it in. */
export const SIGN_TOP = BOARD_LIFT + BOARD_HEIGHT + FRAME + 0.2;
/** The board grows with the name, between these widths; longer names shrink, then truncate. */
const MIN_BOARD_WIDTH = 6;
const MAX_BOARD_WIDTH = 15;
const TEXTURE_HEIGHT = 260;
const PIXELS_PER_UNIT = TEXTURE_HEIGHT / BOARD_HEIGHT;
/** Lucide's git-pull-request glyph, on its 24px grid. */
const PULL_REQUEST_ICON =
  "M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM13 6h3a2 2 0 0 1 2 2v7M6 9v12";

/**
 * The island's name board, painted in the project's colour on a wooden frame,
 * standing at the definition's sign slot. Open PRs from the island's local
 * branches show as a count after the name.
 */
export function Sign(props: {
  readonly slot: WorldSlot;
  readonly text: string;
  readonly color: string;
  readonly pullRequests: number;
}) {
  const { slot, text, color, pullRequests } = props;
  const board = useMemo(() => signBoard(text, color, pullRequests), [text, color, pullRequests]);
  useEffect(() => () => board.texture.dispose(), [board]);
  const width = board.width;
  return (
    // Keeps its colours at any contrast, so the project's name stays easy to spot.
    <KeepColorContext value>
      <group position={slot.position as [number, number, number]} rotation-y={slot.facing}>
        {/* One pole, running up behind the board to its middle. */}
        <mesh
          geometry={geometry.box}
          position={[0, (BOARD_LIFT + BOARD_HEIGHT / 2) / 2, -DEPTH / 2 - POLE_WIDTH / 2]}
          scale={[POLE_WIDTH, BOARD_LIFT + BOARD_HEIGHT / 2, POLE_WIDTH]}
        >
          <LitMaterial color={palette.signPost} />
        </mesh>
        <mesh
          geometry={geometry.box}
          position={[0, BOARD_LIFT + BOARD_HEIGHT / 2, 0]}
          scale={[width + FRAME * 2, BOARD_HEIGHT + FRAME * 2, DEPTH]}
        >
          <LitMaterial color={palette.signPost} />
        </mesh>
        {/* A cap plank overhanging the top, for a bit of silhouette. */}
        <mesh
          geometry={geometry.box}
          position={[0, BOARD_LIFT + BOARD_HEIGHT + FRAME + 0.1, 0]}
          scale={[width + FRAME * 2 + 0.4, 0.2, DEPTH + 0.3]}
        >
          <LitMaterial color={palette.signPost} />
        </mesh>
        <mesh
          geometry={geometry.plane}
          position={[0, BOARD_LIFT + BOARD_HEIGHT / 2, DEPTH / 2 + 0.002]}
          scale={[width, BOARD_HEIGHT, 1]}
        >
          {/* Unlit so the name stays readable whatever the light does. */}
          <meshBasicMaterial map={board.texture} onUpdate={keepColors} />
        </mesh>
      </group>
    </KeepColorContext>
  );
}

function signBoard(
  text: string,
  color: string,
  pullRequests: number,
): { readonly texture: CanvasTexture; readonly width: number } {
  const padding = 70;
  const measure = document.createElement("canvas").getContext("2d")!;
  const font = (px: number) => `700 ${px}px system-ui, -apple-system, sans-serif`;
  // The PR badge: icon, gap, count, inside a pill that sits after the name.
  const badgeFontSize = 96;
  const iconSize = 96;
  const badgePadding = 34;
  const badgeGap = 50;
  measure.font = font(badgeFontSize);
  const count = String(pullRequests);
  const badgeWidth =
    pullRequests > 0 ? badgePadding * 2 + iconSize + 20 + measure.measureText(count).width : 0;
  const badgeSpace = badgeWidth === 0 ? 0 : badgeWidth + badgeGap;
  let size = 150;
  measure.font = font(size);
  const maxTextWidth = MAX_BOARD_WIDTH * PIXELS_PER_UNIT - padding * 2 - badgeSpace;
  while (size > 96 && measure.measureText(text).width > maxTextWidth) {
    size -= 6;
    measure.font = font(size);
  }
  let label = text;
  while (label.length > 1 && measure.measureText(label).width > maxTextWidth) {
    label = label.slice(0, -2) + "…";
  }
  const width = Math.min(
    MAX_BOARD_WIDTH,
    Math.max(
      MIN_BOARD_WIDTH,
      (measure.measureText(label).width + padding * 2 + badgeSpace) / PIXELS_PER_UNIT,
    ),
  );

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * PIXELS_PER_UNIT);
  canvas.height = TEXTURE_HEIGHT;
  const context = canvas.getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const ink = signTextColor(color);
  const middle = canvas.height / 2;
  context.fillStyle = ink;
  context.font = font(size);
  context.textAlign = "center";
  context.textBaseline = "middle";
  // The name centres in whatever the badge leaves.
  context.fillText(label, (canvas.width - badgeSpace) / 2, middle + size * 0.06);
  if (badgeWidth > 0) {
    const left = canvas.width - padding - badgeWidth;
    const height = iconSize + badgePadding * 1.4;
    context.fillStyle = ink === palette.signTextLight ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.3)";
    context.beginPath();
    context.roundRect(left, middle - height / 2, badgeWidth, height, height / 2);
    context.fill();
    context.save();
    context.translate(left + badgePadding, middle - iconSize / 2);
    context.scale(iconSize / 24, iconSize / 24);
    context.strokeStyle = ink;
    context.lineWidth = 2.6;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke(new Path2D(PULL_REQUEST_ICON));
    context.restore();
    context.fillStyle = ink;
    context.font = font(badgeFontSize);
    context.textAlign = "left";
    context.fillText(count, left + badgePadding + iconSize + 20, middle + badgeFontSize * 0.06);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, width };
}

/** The sign's text colour on this board colour: dark where it reads better than white. */
export function signTextColor(color: string): string {
  const { r, g, b } = new Color(color);
  // three's Color holds linear values, which is what the luminance formula wants.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? palette.signTextDark : palette.signTextLight;
}
