import type { ThreeEvent } from "@react-three/fiber";
import { type Ref, useContext, useEffect, useMemo } from "react";
import { CanvasTexture, Color, type Group, Object3D, SRGBColorSpace, Vector3 } from "three";

import type { ProjectFaviconProject } from "../../ProjectFavicon";
import type { WorldSlot } from "../definition/types";
import { type SignIcon, useSignIcon } from "../useSignIcon";
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

/**
 * The corners of a sign's board, cap and lamps in the world, so the camera can
 * fit the whole board in.
 */
export function signCorners(sign: Object3D): Vector3[] {
  const { boardWidth } = sign.userData as SignUserData;
  // The cap plank is the widest and deepest part.
  const halfX = boardWidth / 2 + FRAME + 0.2;
  const halfZ = (DEPTH + 0.3) / 2;
  const bottom = BOARD_LIFT - FRAME;
  const top = SIGN_TOP;
  sign.updateWorldMatrix(true, false);
  return [-halfX, halfX].flatMap((x) =>
    [bottom, top].flatMap((y) =>
      [-halfZ, halfZ].map((z) => new Vector3(x, y, z).applyMatrix4(sign.matrixWorld)),
    ),
  );
}

interface SignUserData {
  readonly boardWidth: number;
}
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
/** Lucide's settings glyph, on its 24px grid. */
const SETTINGS_ICON =
  "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0";

interface Badge {
  readonly icon: string;
  readonly count: number;
}

/**
 * The island's name board, painted in the project's colour on a wooden frame,
 * standing at the definition's sign slot. The project's icon leads the name;
 * after it, counts of the
 * island's local branches (the default one aside) and the open PRs from
 * those branches, then a button for the island's preferences.
 */
export function Sign(props: {
  readonly slot: WorldSlot;
  /** The project whose icon the sign shows. */
  readonly project: ProjectFaviconProject;
  readonly text: string;
  readonly color: string;
  readonly branches: number;
  readonly pullRequests: number;
  /** Clicking the branch count, at this point on screen, e.g. to list the branches. */
  readonly onListClick: (point: { readonly x: number; readonly y: number }) => void;
  /** Clicking the project's icon, at this point on screen, e.g. to change it. */
  readonly onIconClick: (point: { readonly x: number; readonly y: number }) => void;
  /** Right-clicking the project's icon, for every way to change it. */
  readonly onIconMenu: (point: { readonly x: number; readonly y: number }) => void;
  /** Clicking the preferences button. */
  readonly onPrefsClick: () => void;
  /** The sign's root, for `signCorners`. */
  readonly ref: Ref<Group>;
}) {
  const {
    slot,
    project,
    text,
    color,
    branches,
    pullRequests,
    onListClick,
    onIconClick,
    onIconMenu,
    onPrefsClick,
    ref,
  } = props;
  // The icon sits on a white tile, so lucide glyphs take the dark ink whatever the board's colour.
  const icon = useSignIcon(project, palette.signTextDark);
  // The lamps on top come on after sunset, on every island, empty ones too.
  const lit = useContext(TimeOfDayContext).lampsOn;
  const board = useMemo(
    () =>
      signBoard(text, color, icon, [
        { icon: BRANCH_ICON, count: branches },
        { icon: PULL_REQUEST_ICON, count: pullRequests },
      ]),
    [text, color, icon, branches, pullRequests],
  );
  useEffect(() => () => board.texture.dispose(), [board]);
  // The icon, the branch count and the preferences button take clicks; the rest
  // of the board doesn't.
  const target = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
    const x = (event.uv?.x ?? -1) * board.pixelWidth;
    const within = (span: { readonly left: number; readonly right: number } | undefined) =>
      span !== undefined && x >= span.left && x <= span.right;
    if (within(board.icon)) return "icon";
    if (within(board.badges[0])) return "list";
    if (within(board.prefs)) return "prefs";
    return null;
  };
  const width = board.width;
  const lampTarget = useMemo(() => new Object3D(), []);
  return (
    // Keeps its colours at any contrast, so the project's name stays easy to spot.
    <KeepColorContext value>
      <group
        ref={ref}
        position={slot.position as [number, number, number]}
        rotation-y={slot.facing}
        userData={{ boardWidth: width } satisfies SignUserData}
      >
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
            const clicked = target(event);
            if (clicked === null) return;
            event.stopPropagation();
            const point = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY };
            if (clicked === "icon") onIconClick(point);
            else if (clicked === "prefs") onPrefsClick();
            else onListClick(point);
          }}
          onContextMenu={(event) => {
            if (target(event) !== "icon") return;
            event.stopPropagation();
            event.nativeEvent.preventDefault();
            onIconMenu({ x: event.nativeEvent.clientX, y: event.nativeEvent.clientY });
          }}
          onPointerMove={(event) => {
            document.body.style.cursor = target(event) === null ? "" : "pointer";
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
  icon: SignIcon,
  badges: ReadonlyArray<Badge>,
): {
  readonly texture: CanvasTexture;
  readonly width: number;
  /** The canvas's width, and the icon's and each badge's span across it, in pixels. */
  readonly pixelWidth: number;
  readonly icon: { readonly left: number; readonly right: number };
  readonly badges: ReadonlyArray<{ readonly left: number; readonly right: number }>;
  readonly prefs: { readonly left: number; readonly right: number };
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
  // The icon's tile is as tall as a badge pill, and square; so is the preferences button.
  const pillHeight = iconSize + badgePadding * 1.4;
  // The badges, then the preferences button.
  const badgesWidth =
    widths.reduce((sum, width) => sum + width, 0) + betweenBadges * badges.length + pillHeight;
  const badgeSpace = badgesWidth + badgeGap;
  const iconSpace = pillHeight + badgeGap;
  let size = 150;
  measure.font = font(size);
  const maxTextWidth = MAX_BOARD_WIDTH * PIXELS_PER_UNIT - padding * 2 - iconSpace - badgeSpace;
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
      (measure.measureText(label).width + padding * 2 + iconSpace + badgeSpace) / PIXELS_PER_UNIT,
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
  const pillFill = ink === palette.signTextLight ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.3)";
  const tileTop = middle - pillHeight / 2;
  // White, so favicons and glyphs read the same on every board colour. An emoji brings its own
  // colours, so it stands on the board bare.
  if (icon.kind !== "emoji") {
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.roundRect(padding, tileTop, pillHeight, pillHeight, pillHeight / 4);
    context.fill();
  }
  context.textAlign = "center";
  context.textBaseline = "middle";
  if (icon.kind === "emoji") {
    // As big as the tile it replaces.
    const glyphSize = Math.round(pillHeight * 0.86);
    context.font = font(glyphSize);
    context.fillText(icon.text, padding + pillHeight / 2, middle + glyphSize * 0.06);
  } else if (icon.kind === "image") {
    // Contained in the tile, its corners rounded like the sidebar's favicons.
    const inset = 8;
    const box = pillHeight - inset * 2;
    const scale = Math.min(box / icon.image.naturalWidth, box / icon.image.naturalHeight);
    const drawWidth = icon.image.naturalWidth * scale;
    const drawHeight = icon.image.naturalHeight * scale;
    context.save();
    context.beginPath();
    context.roundRect(padding + inset, tileTop + inset, box, box, box / 4);
    context.clip();
    context.drawImage(
      icon.image,
      padding + (pillHeight - drawWidth) / 2,
      middle - drawHeight / 2,
      drawWidth,
      drawHeight,
    );
    context.restore();
  } else {
    // As `ProjectMonogram` draws it: the colour washed over the tile, bold monospace letters
    // stretched to a set width, on a baseline two thirds down.
    context.save();
    context.globalAlpha = 0.14;
    context.fillStyle = icon.color;
    context.beginPath();
    context.roundRect(padding, tileTop, pillHeight, pillHeight, pillHeight / 4);
    context.fill();
    context.restore();
    const unit = pillHeight / 16;
    const width = (Array.from(icon.text).length === 1 ? 6 : 12) * unit;
    context.save();
    context.fillStyle = icon.color;
    context.font = `700 ${8.25 * unit}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.textBaseline = "alphabetic";
    const measured = context.measureText(icon.text).width;
    context.translate(padding + pillHeight / 2, tileTop + 10.8 * unit);
    if (measured > 0) context.scale(width / measured, 1);
    context.fillText(icon.text, 0, 0);
    context.restore();
  }
  context.fillStyle = ink;
  context.font = font(size);
  // The name centres in whatever the icon and badges leave.
  context.fillText(label, (iconSpace + canvas.width - badgeSpace) / 2, middle + size * 0.06);
  let left = canvas.width - padding - badgesWidth;
  const spans: Array<{ readonly left: number; readonly right: number }> = [];
  badges.forEach((badge, index) => {
    const badgeWidth = widths[index]!;
    spans.push({ left, right: left + badgeWidth });
    // Nothing to count: still there, but faded back so the counts that matter stand out.
    context.globalAlpha = badge.count === 0 ? 0.4 : 1;
    context.fillStyle = pillFill;
    context.beginPath();
    context.roundRect(left, tileTop, badgeWidth, pillHeight, pillHeight / 2);
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
  // The preferences button: a round tile with a gear.
  const prefs = { left, right: left + pillHeight };
  context.fillStyle = pillFill;
  context.beginPath();
  context.roundRect(left, tileTop, pillHeight, pillHeight, pillHeight / 2);
  context.fill();
  context.save();
  context.translate(left + (pillHeight - iconSize) / 2, middle - iconSize / 2);
  context.scale(iconSize / 24, iconSize / 24);
  context.strokeStyle = ink;
  context.lineWidth = 1.8;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke(new Path2D(SETTINGS_ICON));
  context.restore();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return {
    texture,
    width,
    pixelWidth: canvas.width,
    icon: { left: padding, right: padding + pillHeight },
    badges: spans,
    prefs,
  };
}

/** The sign's text colour on this board colour: dark where it reads better than white. */
export function signTextColor(color: string): string {
  const { r, g, b } = new Color(color);
  // three's Color holds linear values, which is what the luminance formula wants.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? palette.signTextDark : palette.signTextLight;
}
