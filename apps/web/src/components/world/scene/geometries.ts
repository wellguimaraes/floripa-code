import {
  BoxGeometry,
  CapsuleGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
} from "three";

/**
 * Shared low-poly geometry. Every character and prop reuses these, so the GPU
 * holds one copy no matter how many agents are in the world.
 */
export const geometry = {
  torso: new CapsuleGeometry(0.2, 0.2, 4, 10),
  limb: new CapsuleGeometry(0.06, 0.24, 3, 6),
  leg: new CapsuleGeometry(0.075, 0.16, 3, 6),
  head: new SphereGeometry(0.22, 14, 10),
  eye: new SphereGeometry(0.03, 6, 4),
  shadow: new CircleGeometry(0.34, 16),
  ring: new RingGeometry(0.38, 0.46, 24),
  puff: new SphereGeometry(0.13, 8, 6),
  box: new BoxGeometry(1, 1, 1),
  cylinder: new CylinderGeometry(1, 1, 1, 10),
  cone: new ConeGeometry(1, 1, 8),
  fin: new ConeGeometry(1, 1, 3),
  foliage: new IcosahedronGeometry(1, 0),
  plane: new PlaneGeometry(1, 1),
  disc: new CylinderGeometry(1, 1, 1, 48),
  ripple: new RingGeometry(0.95, 1, 64),
};
