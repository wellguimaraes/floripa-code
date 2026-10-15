import { useThree } from "@react-three/fiber";
import { createContext, useLayoutEffect } from "react";
import { Color, type Material, ShaderChunk } from "three";

import { useWorldContrastStore } from "../worldContrastStore";

/**
 * The contrast slider desaturates the scene in the tone-mapping step, so a drag
 * only changes one renderer uniform: no material or React tree re-renders. The
 * scene uses CustomToneMapping, which runs three's ACES at exposure 1 and reads
 * `toneMappingExposure` as the saturation instead. Materials that define
 * WORLD_KEEP_COLOR (see `keepColors`) skip the desaturation.
 */
ShaderChunk.tonemapping_pars_fragment = ShaderChunk.tonemapping_pars_fragment.replace(
  "vec3 CustomToneMapping( vec3 color ) { return color; }",
  /* glsl */ `
vec3 CustomToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),
		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),
		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color = saturate( ACESOutputMat * RRTAndODTFit( ACESInputMat * ( color / 0.6 ) ) );
	#ifndef WORLD_KEEP_COLOR
	color = mix( vec3( dot( color, vec3( 0.2126, 0.7152, 0.0722 ) ) ), color, toneMappingExposure );
	#endif
	return color;
}`,
);

const KEEP_COLOR = { WORLD_KEEP_COLOR: "" };

/** Makes a material keep its colours at any contrast. Call it before the material's first draw. */
export function keepColors(material: Material) {
  // Every material passes its defines to the shader; the types only declare them on ShaderMaterial.
  Object.assign(material, { defines: KEEP_COLOR });
}

/** True inside a character: its materials keep their colours at any contrast. */
export const KeepColorContext = createContext(false);

/** Applies the contrast slider to the scene, sky included (the clear colour skips tone mapping). */
export function SceneContrast(props: { readonly sky: Color }) {
  const contrast = useWorldContrastStore((state) => state.contrast);
  const get = useThree((state) => state.get);
  // Full contrast greys the world out completely; characters always keep their colours.
  const saturation = 1 - contrast;

  useLayoutEffect(() => {
    const { gl, invalidate } = get();
    gl.toneMappingExposure = saturation;
    invalidate();
  }, [get, saturation]);

  const { r, g, b } = props.sky;
  const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sky = props.sky.clone().lerp(new Color(grey, grey, grey), 1 - saturation);

  return <color attach="background" args={[sky.r, sky.g, sky.b]} />;
}
