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

/**
 * The island's name board, painted in the project's colour on a wooden frame,
 * standing at the definition's sign slot.
 */
export function Sign(props: {
  readonly slot: WorldSlot;
  readonly text: string;
  readonly color: string;
}) {
  const { slot, text, color } = props;
  const board = useMemo(() => signBoard(text, color), [text, color]);
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
): { readonly texture: CanvasTexture; readonly width: number } {
  const padding = 70;
  const measure = document.createElement("canvas").getContext("2d")!;
  const font = (px: number) => `700 ${px}px system-ui, -apple-system, sans-serif`;
  let size = 150;
  measure.font = font(size);
  const maxTextWidth = MAX_BOARD_WIDTH * PIXELS_PER_UNIT - padding * 2;
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
    Math.max(MIN_BOARD_WIDTH, (measure.measureText(label).width + padding * 2) / PIXELS_PER_UNIT),
  );

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * PIXELS_PER_UNIT);
  canvas.height = TEXTURE_HEIGHT;
  const context = canvas.getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = signTextColor(color);
  context.font = font(size);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, canvas.width / 2, canvas.height / 2 + size * 0.06);

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
