import { AdditiveBlending, CanvasTexture, SRGBColorSpace } from "three";

import { geometry } from "./geometries";
import { LitMaterial } from "./lighting";
import { palette } from "./palette";

// The fire's flame and light are drawn unlit and on top, so they stay bright
// on an island whose colours have gone dark.
const FIRE_ORDER = 6;

/** Deeper blue water around a sleeping island, softened only at its rim. */
export function NightWater(props: {
  readonly center: readonly [x: number, z: number];
  readonly radius: number;
}) {
  return (
    <mesh
      geometry={geometry.shadow}
      position={[props.center[0], -0.24, props.center[1]]}
      rotation-x={-Math.PI / 2}
      // The shared circle has radius 0.34; scale it out to `radius`.
      scale={props.radius / 0.34}
    >
      <meshBasicMaterial map={shadeTexture()} transparent depthWrite={false} />
    </mesh>
  );
}

const STONES = Array.from({ length: 9 }, (_, index) => {
  const angle = (index / 9) * Math.PI * 2;
  return [Math.cos(angle) * 0.5, Math.sin(angle) * 0.5] as const;
});

/** A ring of stones, crossed logs and a flame, with a warm glow around it. */
export function Campfire({ position }: { readonly position: readonly [x: number, z: number] }) {
  return (
    <group position={[position[0], 0, position[1]]}>
      {STONES.map(([x, z]) => (
        <mesh key={`${x}:${z}`} geometry={geometry.foliage} position={[x, 0.08, z]} scale={0.13}>
          <LitMaterial color={palette.stoneDark} flatShading />
        </mesh>
      ))}
      {[Math.PI / 4, -Math.PI / 4].map((yaw) => (
        <group key={yaw} rotation-y={yaw}>
          <mesh
            geometry={geometry.cylinder}
            position-y={0.1}
            rotation-x={Math.PI / 2}
            scale={[0.07, 0.75, 0.07]}
          >
            <LitMaterial color={palette.log} />
          </mesh>
        </group>
      ))}
      <mesh
        geometry={geometry.cone}
        position-y={0.6}
        scale={[0.38, 1, 0.38]}
        renderOrder={FIRE_ORDER}
      >
        <meshBasicMaterial color={palette.flame} transparent depthWrite={false} />
      </mesh>
      <mesh
        geometry={geometry.cone}
        position-y={0.48}
        scale={[0.22, 0.66, 0.22]}
        renderOrder={FIRE_ORDER}
      >
        <meshBasicMaterial color={palette.flameCore} transparent depthWrite={false} />
      </mesh>
      {/* Firelight on the ground, reaching the sleepers around it. */}
      <mesh
        geometry={geometry.shadow}
        position-y={0.03}
        rotation-x={-Math.PI / 2}
        scale={8}
        renderOrder={FIRE_ORDER}
      >
        <meshBasicMaterial
          map={glowTexture()}
          transparent
          blending={AdditiveBlending}
          depthWrite={false}
          opacity={0.8}
        />
      </mesh>
      <sprite position-y={0.7} scale={[2.2, 2.2, 1]} renderOrder={FIRE_ORDER - 1}>
        <spriteMaterial
          map={glowTexture()}
          blending={AdditiveBlending}
          depthWrite={false}
          opacity={0.55}
        />
      </sprite>
    </group>
  );
}

let shade: CanvasTexture | null = null;

/** Night water, drawn once and shared. */
function shadeTexture(): CanvasTexture {
  if (shade !== null) return shade;
  shade = radialTexture(palette.nightWater, palette.nightWaterEdge, 0.9);
  return shade;
}

let glow: CanvasTexture | null = null;

/** A soft warm disc, drawn once and shared. */
function glowTexture(): CanvasTexture {
  if (glow !== null) return glow;
  glow = radialTexture(palette.firelight, palette.firelightEdge, 0.6);
  return glow;
}

/** `inner` out to `solidUntil` (0–1 of the radius), then fading to `outer`. */
function radialTexture(inner: string, outer: string, solidUntil: number): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const middle = size / 2;
  const gradient = context.createRadialGradient(middle, middle, 0, middle, middle, middle);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(solidUntil, inner);
  gradient.addColorStop(1, outer);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
