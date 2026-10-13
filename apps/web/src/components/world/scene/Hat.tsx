import { geometry } from "./geometries";
import { LitMaterial } from "./lighting";
import { palette } from "./palette";

/**
 * Hats mark the worktree an agent works in: agents in the same worktree wear
 * the same one, agents in the project checkout wear none. Each is built in
 * head units: the head is 1 wide and the origin sits on top of it, y up and
 * +z toward the face. Each hat has its own shape and colour, never the
 * wearer's, so a worktree's agents match whatever their family.
 */
export const HAT_COUNT = 6;

export function Hat(props: { readonly style: number }) {
  switch (props.style % HAT_COUNT) {
    case 0:
      return <HardHat />;
    case 1:
      return <StrawHat />;
    case 2:
      return <TopHat />;
    case 3:
      return <Beanie />;
    case 4:
      return <PartyHat />;
    default:
      return <Crown />;
  }
}

function HardHat() {
  return (
    <group position-y={-0.12}>
      <mesh geometry={geometry.dome} scale={[0.5, 0.36, 0.5]}>
        <LitMaterial color={palette.hats.hardHat} />
      </mesh>
      <mesh geometry={geometry.cylinder} position={[0, 0.01, 0.1]} scale={[0.56, 0.035, 0.6]}>
        <LitMaterial color={palette.hats.hardHat} />
      </mesh>
      <mesh geometry={geometry.box} position-y={0.2} scale={[0.08, 0.2, 0.86]}>
        <LitMaterial color={palette.hats.hardHatRidge} />
      </mesh>
    </group>
  );
}

function StrawHat() {
  return (
    <group position-y={-0.1}>
      <mesh geometry={geometry.cylinder} scale={[0.85, 0.03, 0.85]}>
        <LitMaterial color={palette.hats.straw} />
      </mesh>
      <mesh geometry={geometry.cylinder} position-y={0.13} scale={[0.4, 0.26, 0.4]}>
        <LitMaterial color={palette.hats.straw} />
      </mesh>
      <mesh geometry={geometry.cylinder} position-y={0.06} scale={[0.41, 0.08, 0.41]}>
        <LitMaterial color={palette.hats.strawBand} />
      </mesh>
    </group>
  );
}

function TopHat() {
  return (
    <group position-y={-0.06}>
      <mesh geometry={geometry.cylinder} scale={[0.58, 0.03, 0.58]}>
        <LitMaterial color={palette.hats.topHat} />
      </mesh>
      <mesh geometry={geometry.cylinder} position-y={0.3} scale={[0.34, 0.6, 0.34]}>
        <LitMaterial color={palette.hats.topHat} />
      </mesh>
      <mesh geometry={geometry.cylinder} position-y={0.08} scale={[0.35, 0.1, 0.35]}>
        <LitMaterial color={palette.hats.topHatBand} />
      </mesh>
    </group>
  );
}

function Beanie() {
  return (
    <group position-y={-0.14}>
      <mesh geometry={geometry.dome} scale={[0.52, 0.4, 0.52]}>
        <LitMaterial color={palette.hats.beanie} />
      </mesh>
      <mesh geometry={geometry.cylinder} position-y={0.03} scale={[0.53, 0.1, 0.53]}>
        <LitMaterial color={palette.hats.beanieCuff} />
      </mesh>
      <mesh geometry={geometry.puff} position-y={0.42} scale={0.9}>
        <LitMaterial color={palette.hats.beanieCuff} />
      </mesh>
    </group>
  );
}

function PartyHat() {
  return (
    <group position-y={-0.04}>
      <mesh geometry={geometry.cone} position-y={0.3} scale={[0.3, 0.6, 0.3]}>
        <LitMaterial color={palette.hats.party} />
      </mesh>
      <mesh geometry={geometry.puff} position-y={0.62} scale={0.75}>
        <LitMaterial color={palette.hats.partyPuff} />
      </mesh>
    </group>
  );
}

const CROWN_POINTS = [0, 1, 2, 3, 4].map((index) => (index / 5) * Math.PI * 2);

function Crown() {
  return (
    <group position-y={-0.04}>
      <mesh geometry={geometry.cylinder} position-y={0.08} scale={[0.36, 0.16, 0.36]}>
        <LitMaterial color={palette.gold} />
      </mesh>
      {CROWN_POINTS.map((angle) => (
        <mesh
          key={angle}
          geometry={geometry.cone}
          position={[Math.sin(angle) * 0.3, 0.24, Math.cos(angle) * 0.3]}
          scale={[0.09, 0.18, 0.09]}
        >
          <LitMaterial color={palette.gold} />
        </mesh>
      ))}
    </group>
  );
}
