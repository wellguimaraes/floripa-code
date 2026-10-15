import type { ThreeEvent } from "@react-three/fiber";
import { useContext, useEffect, useMemo } from "react";
import { CanvasTexture, Color, Object3D, SRGBColorSpace } from "three";

import type { WorldSlot } from "../definition/types";
import { KeepColorContext, keepColors } from "./contrast";
import { geometry } from "./geometries";
import { LitMaterial, TimeOfDayContext } from "./lighting";
import { palette } from "./palette";

const BOARD_HEIGHT = 2.2;
const BOARD_LIFT = 4.2;
const FRAME = 0.28;
const POLE_WIDTH = 0.42;
/** A chunky board, so it reads as a solid object rather than a card. */
const DEPTH = 0.5;
/** The top of the cap plank, where the lamps stand. */
const CAP_TOP = BOARD_LIFT + BOARD_HEIGHT + FRAME + 0.2;
/** How high the sign reaches, lamps included, so the camera can fit it in. */
export const SIGN_TOP = CAP_TOP + 0.6;
/** The lamps' brightness; with `decay` 1 it fades with distance, not its square. */
const LAMP_INTENSITY = 24;
/** The lamps tip forward this far from level, to shine down on the island. */
const LAMP_TILT = 0.6;
/** Where the lamps' light lands: the island's middle, in front of the sign. */
const LAMP_REACH = 8.5;
/** The board grows with the name, between these widths; longer names shrink, then truncate. */
const MIN_BOARD_WIDTH = 6;
const MAX_BOARD_WIDTH = 15;
const TEXTURE_HEIGHT = 260;
const PIXELS_PER_UNIT = TEXTURE_HEIGHT / BOARD_HEIGHT;
/** Lucide's git-pull-request glyph, on its 24px grid. */
const PULL_REQUEST_ICON =
  "M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM13 6h3a2 2 0 0 1 2 2v7M6 9v12";
/** Lucide's git-branch glyph, on its 24px grid. */
const BRANCH_ICON =
  "M15 6a9 9 0 0 0-9 9V3M21 6a3 3 0 1 1-6 0a3 3 0 1 1 6 0M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0";
/** Lucide's folder-git-2 glyph, on its 24px grid. */
const WORKTREE_ICON =
  "M18 19a5 5 0 0 1-5-5v8M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5M15 12a2 2 0 1 1-4 0a2 2 0 1 1 4 0M22 19a2 2 0 1 1-4 0a2 2 0 1 1 4 0";

interface Badge {
  readonly icon: string;
  readonly count: number;
}

/**
 * The island's name board, painted in the project's colour on a wooden frame,
 * standing at the definition's sign slot. After the name, counts of the
 * island's local branches (the default one aside), its worktrees, and the open
 * PRs from those branches, so stale branches and worktrees are easy to spot.
 */
export function Sign(props: {
  readonly slot: WorldSlot;
  readonly text: string;
  readonly color: string;
  readonly branches: number;
  readonly pullRequests: number;
  readonly worktrees: number;
  /** Clicking the branch count, e.g. to list the branches. */
  readonly onBranchesClick: () => void;
}) {
  const { slot, text, color, branches, pullRequests, worktrees, onBranchesClick } = props;
  // The lamps on top come on after sunset, on every island, empty ones too.
  const lit = useContext(TimeOfDayContext).lampsOn;
  const board = useMemo(
    () =>
      signBoard(text, color, [
        { icon: BRANCH_ICON, count: branches },
        { icon: WORKTREE_ICON, count: worktrees },
        { icon: PULL_REQUEST_ICON, count: pullRequests },
      ]),
    [text, color, branches, pullRequests, worktrees],
  );
  useEffect(() => () => board.texture.dispose(), [board]);
  // The first badge is the branch count; it takes clicks, the rest of the board doesn't.
  const onBranches = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
    const x = (event.uv?.x ?? -1) * board.pixelWidth;
    const branchesBadge = board.badges[0];
    return branchesBadge !== undefined && x >= branchesBadge.left && x <= branchesBadge.right;
  };
  const width = board.width;
  const lampTarget = useMemo(() => new Object3D(), []);
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

          onClick={(event) => {
            if (!onBranches(event)) return;
            event.stopPropagation();
            onBranchesClick();
          }}
          onPointerMove={(event) => {
            document.body.style.cursor = onBranches(event) ? "pointer" : "";
          }}
          onPointerOut={() => {
            document.body.style.cursor = "";
          }}
        >
          {/* Unlit so the name stays readable whatever the light does. */}
          <meshBasicMaterial map={board.texture} onUpdate={keepColors} />
        </mesh>
        {[-width / 3, width / 3].map((x) => (
          <group key={x} position={[x, CAP_TOP + 0.3, 0.1]} rotation-x={LAMP_TILT}>
            <mesh geometry={geometry.cylinder} rotation-x={Math.PI / 2} scale={[0.3, 0.6, 0.3]}>
              <LitMaterial color={palette.lampHousing} />
            </mesh>
            {/* The bulb's face, unlit so it glows at night. */}
            <mesh
              geometry={geometry.cylinder}
              position-z={0.31}
              rotation-x={Math.PI / 2}
              scale={[0.24, 0.02, 0.24]}
            >
              <meshBasicMaterial
                color={lit ? palette.lampBulb : palette.lampHousing}
                onUpdate={keepColors}
              />
            </mesh>
          </group>
        ))}
        {/*
         * One light for both lamps: a warm pool on the island in front of the
         * sign. Off is zero intensity, not unmounted, so the scene's light count
         * holds and no material recompiles as islands empty and fill.
         */}
        <primitive object={lampTarget} position={[0, 0, LAMP_REACH]} />
        <spotLight
          position={[0, CAP_TOP + 0.3, 0.4]}
          target={lampTarget}
          color={palette.lampLight}
          intensity={lit ? LAMP_INTENSITY : 0}
          angle={0.75}
          penumbra={0.7}
          decay={1}
          distance={28}
        />
      </group>
    </KeepColorContext>
  );
}

function signBoard(
  text: string,
  color: string,
  badges: ReadonlyArray<Badge>,
): {
  readonly texture: CanvasTexture;
  readonly width: number;
  /** The canvas's width, and each badge's span across it, in pixels. */
  readonly pixelWidth: number;
  readonly badges: ReadonlyArray<{ readonly left: number; readonly right: number }>;
} {
  const padding = 70;
  const measure = document.createElement("canvas").getContext("2d")!;
  const font = (px: number, weight = 700) =>
    `${weight} ${px}px system-ui, -apple-system, sans-serif`;
  // Lighter than the name, so the counts read as details beside it.
  const countWeight = 500;
  // Each badge: icon, gap, count, inside a pill; the pills sit in a row after the name.
  const badgeFontSize = 96;
  const iconSize = 96;
  const badgePadding = 34;
  const badgeGap = 50;
  const betweenBadges = 28;
  measure.font = font(badgeFontSize, countWeight);
  const widths = badges.map(
    (badge) => badgePadding * 2 + iconSize + 20 + measure.measureText(String(badge.count)).width,
  );
  const badgesWidth =
    widths.reduce((sum, width) => sum + width, 0) + betweenBadges * (badges.length - 1);
  const badgeSpace = badges.length === 0 ? 0 : badgesWidth + badgeGap;
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
  let left = canvas.width - padding - badgesWidth;
  const spans: Array<{ readonly left: number; readonly right: number }> = [];
  badges.forEach((badge, index) => {
    const badgeWidth = widths[index]!;
    spans.push({ left, right: left + badgeWidth });
    // Nothing to count: still there, but faded back so the counts that matter stand out.
    context.globalAlpha = badge.count === 0 ? 0.4 : 1;
    const height = iconSize + badgePadding * 1.4;
    context.fillStyle = ink === palette.signTextLight ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.3)";
    context.beginPath();
    context.roundRect(left, middle - height / 2, badgeWidth, height, height / 2);
    context.fill();
    context.save();
    context.translate(left + badgePadding, middle - iconSize / 2);
    context.scale(iconSize / 24, iconSize / 24);
    context.strokeStyle = ink;
    context.lineWidth = 1.8;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke(new Path2D(badge.icon));
    context.restore();
    context.fillStyle = ink;
    context.font = font(badgeFontSize, countWeight);
    context.textAlign = "left";
    context.fillText(
      String(badge.count),
      left + badgePadding + iconSize + 20,
      middle + badgeFontSize * 0.06,
    );
    left += badgeWidth + betweenBadges;
  });
  context.globalAlpha = 1;

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, width, pixelWidth: canvas.width, badges: spans };
}

/** The sign's text colour on this board colour: dark where it reads better than white. */
export function signTextColor(color: string): string {
  const { r, g, b } = new Color(color);
  // three's Color holds linear values, which is what the luminance formula wants.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? palette.signTextDark : palette.signTextLight;
}
