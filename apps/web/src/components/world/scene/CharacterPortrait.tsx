import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useLayoutEffect, useRef } from "react";
import { Box3, type Group, type SkinnedMesh, Vector3 } from "three";

import { cn } from "../../../lib/utils";
import { CharacterModel } from "./CharacterModel";
import { Hat } from "./Hat";
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

/**
 * Frames the figure from its feet to the top of its head (or hat), so it
 * fills the portrait's height exactly at any size.
 */
function FitFigure(props: { readonly figure: React.RefObject<Group | null> }) {
  const { figure } = props;
  const get = useThree((state) => state.get);
  const height = useThree((state) => state.size.height);
  useLayoutEffect(() => {
    const group = figure.current;
    if (group === null || height === 0) return;
    group.updateWorldMatrix(true, true);
    // Skinned vertices are measured through their bones, which only settle on render.
    group.traverse((object) => (object as SkinnedMesh).skeleton?.update());
    const bounds = new Box3().setFromObject(group, true);
    const size = bounds.getSize(new Vector3()).y;
    if (size === 0) return;
    const { camera, invalidate } = get();
    camera.position.y = bounds.getCenter(new Vector3()).y;
    camera.zoom = height / size;
    camera.updateProjectionMatrix();
    invalidate();
  }, [figure, get, height]);
  return null;
}
