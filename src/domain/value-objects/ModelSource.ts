/**
 * De dónde sale la geometría de un modelo.
 *
 * 'primitive' existe para que la app funcione sin assets: puedes desplegar
 * y probar en el teléfono hoy, y migrar a 'gltf' cuando tengas los .glb.
 */
export type PrimitiveShape = 'torus-knot' | 'crystal' | 'headphones';

export type ModelSource =
  | { readonly kind: 'gltf'; readonly url: string }
  | { readonly kind: 'primitive'; readonly shape: PrimitiveShape; readonly colorHex: number };

export const ModelSource = {
  gltf(url: string): ModelSource {
    if (!url.endsWith('.glb') && !url.endsWith('.gltf')) {
      throw new RangeError(`Formato no soportado: ${url}. Usa .glb o .gltf`);
    }
    return { kind: 'gltf', url };
  },

  primitive(shape: PrimitiveShape, colorHex: number): ModelSource {
    if (!Number.isInteger(colorHex) || colorHex < 0 || colorHex > 0xffffff) {
      throw new RangeError(`Color inválido: ${colorHex}. Usa un entero 0x000000–0xffffff`);
    }
    return { kind: 'primitive', shape, colorHex };
  },
} as const;
