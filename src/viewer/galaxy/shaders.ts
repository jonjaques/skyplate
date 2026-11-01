/**
 * GLSL for the plate. Three programs, each one draw call:
 *
 *   stars  every file as a point sprite: soft core + faint halo, holotype and selection rings,
 *          morph between tree and graph positions, history fade and flash, region hover
 *   lanes  import edges and symbol arcs as hairlines whose brightness travels toward the
 *          dependency (or the definition), so direction reads without arrowheads
 *   moons  a selected file's declared symbols, orbiting it
 *
 * Everything blends additively onto the dark glass. Additive is order-independent, so 50k
 * sprites need no depth sort, and overlapping stars brighten the way a dense star field does:
 * the core of a big directory glows because it is dense, not because anything was painted on.
 *
 * Files are 1:1 with vertices, so per-file state that changes on hover (which star is under the
 * pointer) is a uniform compared against gl_VertexID instead of an attribute rewrite.
 */

export const STAR_VERTEX = /* glsl */ `
#define HALO_SPAN 2.6
uniform float uMorph;
uniform float uSizeScale;   // device px per world unit at distance 1
uniform float uBaseSize;    // world size of the smallest star
uniform float uSizeRange;   // world size added at size 1
uniform float uMinPx;
uniform float uMaxPx;
uniform float uHover;       // file id under the pointer, -1 for none
uniform float uSelected;    // selected file id, -1 for none
uniform float uHoverRegion; // region index under the pointer, -1 for none
uniform float uTimeOn;      // 1 while the history scrubber is off HEAD
uniform float uTime;        // scrubber position, days since the first commit
uniform float uClock;       // seconds, for breathing and ripples
uniform float uRippleStart; // uClock when the current symbol was picked, -1 for none
uniform float uMotion;      // 0 under prefers-reduced-motion

attribute vec3 aGraph;
attribute vec3 aColor;
attribute float aSize;
attribute float aEmph;
attribute float aMark;      // 1 holotype ring, 2 definition marker (breathing white), 3 selected (set here)
attribute float aBorn;      // days since the first commit; -1e6 when unknown
attribute float aFlash;     // 0-1, touched near the scrubber position
attribute float aRegion;
attribute float aDepth;     // symbol ripple depth, -1 when not reached

varying vec3 vColor;
varying float vCore;        // core radius as a fraction of the sprite
varying float vMark;
varying float vRingPulse;
varying float vAlpha;
varying float vHalo;        // halo strength: full for small stars, fading for big ones

void main() {
  vec3 p = mix(position, aGraph, uMorph);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  float id = float(gl_VertexID);
  float isHover = 1.0 - step(0.5, abs(id - uHover));
  float isSel = 1.0 - step(0.5, abs(id - uSelected));

  float emph = aEmph;
  if (uHoverRegion >= 0.0) emph *= abs(aRegion - uHoverRegion) < 0.5 ? 1.45 : 0.32;

  // Symbol ripple: lit files come up in order of distance from the definition, one wave.
  float wave = 0.0;
  if (uRippleStart >= 0.0 && aDepth >= 0.0 && uMotion > 0.5) {
    float t = uClock - uRippleStart - aDepth * 0.22;
    emph *= smoothstep(-0.05, 0.25, t) * 0.85 + 0.15;
    wave = exp(-pow(t / 0.16, 2.0));
  }

  // History: files not yet created fade out; files touched near the scrubber flash.
  float visible = 1.0;
  if (uTimeOn > 0.5) visible = clamp((uTime - aBorn) / 10.0 + 1.0, 0.0, 1.0);

  float world = uBaseSize + aSize * uSizeRange;
  float px = world * uSizeScale / max(-mv.z, 1e-3);
  px *= mix(0.7, 1.0, clamp(emph, 0.0, 1.0)) * (1.0 + 0.25 * clamp(emph - 1.0, 0.0, 1.0));
  px *= 1.0 + 0.7 * isHover + 0.35 * isSel + 0.8 * aFlash + 0.5 * wave;
  px = clamp(px, uMinPx, uMaxPx);

  // The sprite is larger than the star so its halo has room to spread: a halo clipped at the
  // core's edge never overlaps a neighbor's, and dense arms then read as scattered dots
  // instead of glowing where files crowd. Rings need more room still.
  float mark = aMark;
  if (isSel > 0.5 && mark < 1.5) mark = max(mark, 3.0);
  float sprite = px * HALO_SPAN;
  if (mark > 0.5) sprite = max(px * 2.8, uMinPx * 7.0);
  gl_PointSize = sprite * visible;
  vCore = px / sprite;
  // The halo is what makes a 2 px star findable and a dense arm glow. A star seen up close is
  // already a disc; at full strength its halo blew out everything near the camera into a
  // white fog, so it fades as the star grows (uMinPx / 1.6 is the device pixel ratio).
  vHalo = clamp(14.0 * (uMinPx / 1.6) / max(px, 1.0), 0.15, 1.0);
  vMark = mark;
  // Only the symbol definition breathes (mark 2); a selected file's ring (mark 3) holds still.
  vRingPulse = mark > 1.5 && mark < 2.5 ? 0.5 + 0.5 * sin(uClock * 2.4 * uMotion) : 0.0;

  float bright = clamp(emph, 0.0, 2.4);
  vColor = aColor * bright + vec3(1.0, 0.95, 0.85) * (aFlash * 0.7 + wave * 0.5 + isHover * 0.35);
  vAlpha = visible;
}
`;

export const STAR_FRAGMENT = /* glsl */ `
uniform vec3 uHolotype;
varying vec3 vColor;
varying float vCore;
varying float vMark;
varying float vRingPulse;
varying float vAlpha;
varying float vHalo;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;
  float rr = r / max(vCore, 1e-3);
  // A soft round core with a faint exponential halo: reads as a star at 3 px and as a disc at
  // 30 px, and halos add up (the blend is additive) where files crowd, so a dense directory
  // glows because it is dense. The halo fades out before the sprite's edge so no square or
  // circle outline ever shows.
  float core = smoothstep(0.62, 0.2, rr);
  float halo = 0.42 * vHalo * exp(-1.6 * rr) * (1.0 - smoothstep(0.65, 1.0, r));
  vec3 col = vColor * (core + halo);

  if (vMark > 0.5) {
    float ringR = 0.8;
    float w = 0.07;
    if (vMark > 1.5) {
      // Definition marker (breathing) or selection ring (still): white either way.
      ringR = 0.74 + 0.12 * vRingPulse;
      float ring = smoothstep(w, 0.0, abs(r - ringR));
      col += vec3(1.0) * ring * (0.65 + 0.35 * vRingPulse);
    } else {
      float ring = smoothstep(w, 0.0, abs(r - ringR));
      col += uHolotype * ring * 1.15;
    }
  }
  gl_FragColor = vec4(col * vAlpha, 1.0);
}
`;

/**
 * Lanes: line segments with tree and graph endpoints (they follow the morph), a parameter t
 * from 0 at the importer / referencing file to 1 at the dependency / definition, and a style:
 *   0 import lane      brightness grows toward the importer end; dashes drift toward the dependency
 *   1 call arc         solid, pulses of light travel toward the definition
 *   2 other-use arc    dashed (types, reads, imports, implementations), dimmer, no pulses
 *   3 callee link      faint dotted, outward from the definition
 *   4 every edge       faint and static
 */
export const LANE_VERTEX = /* glsl */ `
uniform float uMorph;
attribute vec3 aGraph;
attribute float aT;
attribute float aStyle;
attribute float aWeight;
attribute float aLen;       // lane length in world units, for dash spacing
varying float vT;
varying float vStyle;
varying float vWeight;
varying float vLen;
void main() {
  vec3 p = mix(position, aGraph, uMorph);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  vT = aT;
  vStyle = aStyle;
  vWeight = aWeight;
  vLen = aLen;
}
`;

export const LANE_FRAGMENT = /* glsl */ `
uniform float uClock;
uniform float uMotion;
uniform float uOpacity;
uniform vec3 uInk;
varying float vT;
varying float vStyle;
varying float vWeight;
varying float vLen;
void main() {
  float a = 0.0;
  float clock = uClock * uMotion;
  if (vStyle < 0.5) {
    // Import lane: brighter at the importer end; a slow dash drifts toward the dependency.
    float dash = step(0.5, fract(vT * max(vLen / 26.0, 2.0) - clock * 0.8));
    a = (0.22 + 0.5 * (1.0 - vT)) * (0.55 + 0.45 * dash);
  } else if (vStyle < 1.5) {
    // Call arc: steady base plus pulses heading to the definition.
    float k = max(vLen / 140.0, 1.0);
    float pulse = pow(max(0.0, 1.0 - abs(fract(vT * k - clock * 0.55) - 0.5) * 2.0), 6.0);
    if (uMotion < 0.5) pulse = 0.0;
    a = (0.28 + 0.5 * vWeight) + pulse * 0.9;
  } else if (vStyle < 2.5) {
    // Other use: dashed and dimmer, no pulse.
    float dash = step(0.45, fract(vT * max(vLen / 18.0, 3.0)));
    a = (0.16 + 0.32 * vWeight) * dash;
  } else if (vStyle < 3.5) {
    // Callee link: faint dots.
    float dot = step(0.7, fract(vT * max(vLen / 10.0, 4.0)));
    a = 0.2 * dot;
  } else {
    a = 0.07;
  }
  if (a <= 0.001) discard;
  gl_FragColor = vec4(uInk * a * uOpacity, 1.0);
}
`;

export const MOON_VERTEX = /* glsl */ `
uniform float uPx;
uniform float uHover;
attribute float aKindTone;
varying float vTone;
varying float vHover;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  float isHover = 1.0 - step(0.5, abs(float(gl_VertexID) - uHover));
  gl_PointSize = uPx * (1.0 + 0.6 * isHover);
  vTone = aKindTone;
  vHover = isHover;
}
`;

export const MOON_FRAGMENT = /* glsl */ `
varying float vTone;
varying float vHover;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;
  // Callables are solid moons, types are rings: shape, not color, says which.
  float solid = smoothstep(0.75, 0.45, r);
  float ring = smoothstep(0.16, 0.0, abs(r - 0.62));
  float a = mix(ring, solid, vTone);
  gl_FragColor = vec4(vec3(0.92, 0.95, 0.97) * a * (0.75 + 0.5 * vHover), 1.0);
}
`;
