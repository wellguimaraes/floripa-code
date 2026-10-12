import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";

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
  return (
    <div aria-hidden className={cn("shrink-0", props.className)}>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        orthographic
        // Feet to the top of the tallest hat, centred.
        camera={{ position: [0, 0.84, 5], rotation: [0, 0, 0], zoom: 23 }}
      >
        <hemisphereLight args={[palette.skyLight, palette.groundLight, 1.7]} />
        <directionalLight position={[6, 14, 9]} intensity={1.6} />
        <Suspense fallback={null}>
          {/* Turned a little, so the body reads in 3D and not as a flat cut-out. */}
          <group rotation-y={-0.4}>
            <CharacterModel
              pose="stand"
              shades={shades}
              isWalking={notWalking}
              headItem={props.hat === null ? undefined : <Hat style={props.hat} />}
            />
          </group>
        </Suspense>
      </Canvas>
    </div>
  );
}
