import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useLayoutEffect, useRef, useState } from "react";
import { Box3, type Group, type SkinnedMesh, Vector3 } from "three";

import { cn } from "../../../lib/utils";
import { CharacterModel } from "./CharacterModel";
import { Hat, HAT_COUNT } from "./Hat";
import { palette } from "./palette";

const notWalking = () => false;

/**
 * A character standing head to toe, as the world draws it: same model,
 * colours and hat, on a clear background. Renders on demand, so a still
 * portrait draws no frames.
 */
export default function CharacterPortrait(props: {
  readonly hue: number;
  readonly hat: number | null;
  readonly className?: string;
}) {
  const shades = palette.families[props.hue] ?? palette.families[0];
  const figure = useRef<Group>(null);
  return (
    <div aria-hidden className={cn("relative shrink-0", props.className)}>
      <Canvas
        // Out of flow, so the canvas follows the portrait's size and never props it open.
        style={{ position: "absolute", inset: 0 }}
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        orthographic
        camera={{ position: [0, 0.8, 5], rotation: [0, 0, 0], zoom: 23 }}
      >
        {/* Daylight, not the world's night, so the portrait reads clearly in the UI. */}
        <hemisphereLight args={[palette.skyLight, palette.groundLight, 1.7]} />
        <directionalLight position={[6, 14, 9]} intensity={1.6} />
        <Suspense fallback={null}>
          {/* Turned a little, so the body reads in 3D and not as a flat cut-out. */}
          <group ref={figure} rotation-y={-0.4}>
            <CharacterModel
              pose="stand"
              shades={shades}
              isWalking={notWalking}
              headItem={props.hat === null ? undefined : <Hat style={props.hat} />}
            />
          </group>
          {/* A new hat changes the figure's height, so measure again. */}
          <FitFigure key={props.hat ?? "bare"} figure={figure} />
        </Suspense>
      </Canvas>
    </div>
  );
}

/** Each hat style drawn once, kept as an image so a list of hats holds no WebGL contexts. */
const hatImages = new Map<number, string>();

/** A worktree's hat on its own, as the world's agents wear it. */
export function HatPortrait(props: { readonly hat: number; readonly className?: string }) {
  const style = props.hat % HAT_COUNT;
  const [image, setImage] = useState(() => hatImages.get(style));
  const hat = useRef<Group>(null);
  if (image !== undefined)
    return <img src={image} alt="" aria-hidden className={cn("shrink-0", props.className)} />;
  return (
    <div aria-hidden className={cn("relative shrink-0", props.className)}>
      <Canvas
        style={{ position: "absolute", inset: 0 }}
        frameloop="never"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        orthographic
        camera={{ position: [0, 0, 5], rotation: [0, 0, 0], zoom: 23 }}
      >
        <hemisphereLight args={[palette.skyLight, palette.groundLight, 1.7]} />
        <directionalLight position={[6, 14, 9]} intensity={1.6} />
        {/* Tipped toward the viewer, so the crown and brim both read. */}
        <group ref={hat} rotation={[0.35, -0.4, 0]}>
          <Hat style={style} />
        </group>
        <FitFigure figure={hat} />
        <Snapshot
          onImage={(url) => {
            hatImages.set(style, url);
            setImage(url);
          }}
        />
      </Canvas>
    </div>
  );
}

/** Draws the scene once it has a size and hands it back as an image. */
function Snapshot(props: { readonly onImage: (url: string) => void }) {
  const { onImage } = props;
  const get = useThree((state) => state.get);
  const { width, height } = useThree((state) => state.size);
  useLayoutEffect(() => {
    if (width === 0 || height === 0) return;
    const { gl, scene, camera } = get();
    gl.render(scene, camera);
    // Read in the same task as the render, before the drawing buffer clears.
    onImage(gl.domElement.toDataURL());
  }, [get, onImage, width, height]);
  return null;
}

/**
 * Frames the figure from its feet to the top of its head (or hat), so it
 * fills the portrait's height exactly at any size; shrunk to fit when the
 * portrait is too narrow for it, so the arms and hair are never cut off.
 */
function FitFigure(props: { readonly figure: React.RefObject<Group | null> }) {
  const { figure } = props;
  const get = useThree((state) => state.get);
  const { width, height } = useThree((state) => state.size);
  useLayoutEffect(() => {
    const group = figure.current;
    if (group === null || width === 0 || height === 0) return;
    group.updateWorldMatrix(true, true);
    // Skinned vertices are measured through their bones, which only settle on render.
    group.traverse((object) => (object as SkinnedMesh).skeleton?.update());
    const bounds = new Box3().setFromObject(group, true);
    const size = bounds.getSize(new Vector3());
    if (size.x === 0 || size.y === 0) return;
    const { camera, invalidate } = get();
    const center = bounds.getCenter(new Vector3());
    camera.position.x = center.x;
    camera.position.y = center.y;
    camera.zoom = Math.min(height / size.y, width / size.x);
    camera.updateProjectionMatrix();
    invalidate();
  }, [figure, get, width, height]);
  return null;
}
