/**
 * GLSL for the plate. Five programs, each one draw call:
 *
 *   stars  every file as a point sprite: soft core + faint halo, holotype and selection rings,
 *          morph between the engine's from and to slots, history fade and flash (on the core
 *          only), the hovered group's members and the pointer's reticle
 *   filaments  the web's strands between coupled clusters: faint, additive, brighter for more
 *          coupling and for the hovered, selected or open group
 *   lanes  import edges and symbol arcs as hairlines whose brightness travels toward the
 *          dependency (or the definition), so direction reads without arrowheads
 *   moons  a selected file's declared symbols, orbiting it
 *   knockout  a plate-colored disc under a symbol's definition star, the one normally blended
 *          draw: it clears the arcs where they converge so the definition ring stays visible
 *
 * Everything blends additively onto the dark glass. Additive is order-independent, so 50k
 * sprites need no depth sort, and overlapping stars brighten the way a dense star field does:
 * the core of a big directory glows because it is dense, not because anything was painted on.
 *
 * Files are 1:1 with vertices, so per-file state that changes on hover (which star is under the
 * pointer) is a uniform compared against gl_VertexID instead of an attribute rewrite. A hovered
 * group is the same idea one level up: aOrder is each file's depth-first ordinal, every
 * directory's subtree is one contiguous range of them, and the range arrives as a uniform.
 */

export const STAR_VERTEX = /* glsl */ `
#define HALO_SPAN 2.6
uniform float uMorph;
uniform float uSizeScale;   // device px per world unit at distance 1
uniform float uBaseSize;    // world size of the smallest star
uniform float uSizeRange;   // world size added at size 1
uniform float uMinPx;
uniform float uMaxPx;
uniform float uHover;       // the committed hover's file id (it has a card), -1 for none
uniform float uReticle;     // the star under the pointer right now, committed or not, -1 for none
uniform float uSelected;    // selected file id, -1 for none
uniform vec2 uHotRange;     // the hovered group's [lo, hi) in depth-first order, (-1, -1) for none
uniform float uTimeOn;      // 1 while the history scrubber is off HEAD
uniform float uTime;        // scrubber position, days since the first commit
uniform float uClock;       // seconds, for breathing and ripples
uniform float uRippleStart; // uClock when the current symbol was picked, -1 for none
uniform float uMotion;      // 0 under prefers-reduced-motion

attribute vec3 aTo;         // the slot the morph is heading to (position is where it started)
attribute vec3 aColor;
attribute float aSize;
attribute float aEmph;
attribute float aMark;      // 1 holotype ring, 2 definition marker (breathing white), 3 selected (set here)
attribute float aBorn;      // days since the first commit; -1e6 when unknown
attribute float aFlash;     // 0-1, touched near the scrubber position
attribute float aOrder;     // depth-first ordinal (Model.fileOrderIndex)
attribute float aDepth;     // symbol ripple depth, -1 when not reached

varying vec3 vColor;
varying float vCore;        // core radius as a fraction of the sprite
varying float vMark;
varying float vRingPulse;
varying float vAlpha;
varying float vHalo;        // halo strength: full for small stars, fading for big ones
varying float vGhost;       // 1 for a selected file not yet created at the scrubber's date
varying float vFlash;
varying vec3 vReticle;      // the reticle's ticks: inner and outer radius, half width (sprite units); 0 when off

void main() {
  vec3 p = mix(position, aTo, uMorph);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  float id = float(gl_VertexID);
  float isHover = 1.0 - step(0.5, abs(id - uHover));
  float isSel = 1.0 - step(0.5, abs(id - uSelected));
  float isReticle = 1.0 - step(0.5, abs(id - uReticle));

  float emph = aEmph;
  // A hovered group's members come up and the rest step back a little: enough to see the
  // group's shape inside a busy web, not so much that the plate blinks as the pointer moves
  // from group to group (the region hover this replaced dimmed the rest to a third).
  if (uHotRange.x >= 0.0) emph *= (aOrder > uHotRange.x - 0.5 && aOrder < uHotRange.y - 0.5) ? 1.35 : 0.55;

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
  // The flash barely grows the star: a bigger sprite is a bigger halo, and halos add up.
  px *= 1.0 + 0.7 * isHover + 0.35 * isSel + 0.25 * aFlash + 0.5 * wave;
  px = clamp(px, uMinPx, uMaxPx);

  // The sprite is larger than the star so its halo has room to spread: a halo clipped at the
  // core's edge never overlaps a neighbor's, and dense clumps then read as scattered dots
  // instead of glowing where files crowd. Rings need more room still.
  float mark = aMark;
  if (isSel > 0.5 && mark < 1.5) mark = max(mark, 3.0);
  float sprite = px * HALO_SPAN;
  if (mark > 0.5) sprite = max(px * 2.8, uMinPx * 7.0);
  // The definition ring sits inside the knockout disc (see KNOCKOUT_*), so it is drawn larger
  // than a holotype ring: at the old size a heavily used symbol's arcs buried it.
  if (mark > 1.5 && mark < 2.5) sprite = max(sprite, uMinPx * 11.0);
  // The reticle's ticks sit just outside the star at a fixed size on screen (2 px clear of the
  // core, 4 px long), so its sprite needs that much room around the core. Sized to the sprite
  // instead, they grew with a hovered star into a heavy cross over its neighbors.
  float dpr = uMinPx / 1.6;
  float tickIn = px * 0.42 + 2.0 * dpr;
  float tickOut = tickIn + 4.0 * dpr;
  if (isReticle > 0.5) sprite = max(sprite, tickOut * 2.0 + 2.0 * dpr);
  // A selected file the scrubber has not reached yet keeps a dashed ghost ring where it will
  // be, so a selection made at a past date does not fly to an unexplained empty spot.
  vGhost = isSel * step(visible, 0.999);
  gl_PointSize = max(sprite * visible, vGhost * uMinPx * 15.0);
  vCore = px / sprite;
  // The halo is what makes a 2 px star findable and a dense clump glow. A star seen up close is
  // already a disc; at full strength its halo blew out everything near the camera into a
  // white fog, so it fades as the star grows (uMinPx / 1.6 is the device pixel ratio).
  vHalo = clamp(14.0 * (uMinPx / 1.6) / max(px, 1.0), 0.15, 1.0);
  vMark = mark;
  // Only the symbol definition breathes (mark 2); a selected file's ring (mark 3) holds still.
  vRingPulse = mark > 1.5 && mark < 2.5 ? 0.5 + 0.5 * sin(uClock * 2.4 * uMotion) : 0.0;

  float bright = clamp(emph, 0.0, 2.4);
  // The history flash is not in here: added to the color it lit the halo too, and where a
  // busy week touched a whole cluster the summed halos went near-white, taking every
  // language's color and the selection's ghost ring with them. The fragment shader puts it on
  // the core alone (see STAR_FRAGMENT).
  vColor = aColor * bright + vec3(1.0, 0.95, 0.85) * (wave * 0.5 + isHover * 0.35);
  vFlash = aFlash;
  vAlpha = visible;
  vReticle = isReticle * vec3(tickIn, tickOut, 0.55 * dpr) / (sprite * 0.5);
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
varying float vGhost;
varying float vFlash;
varying vec3 vReticle;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;
  if (vGhost > 0.5) {
    // Eight dashes on a thin ring, no core: "it will be here".
    float ring = smoothstep(0.07, 0.0, abs(r - 0.8));
    float dash = step(0.0, sin(atan(c.y, c.x) * 8.0));
    gl_FragColor = vec4(vec3(0.92, 0.95, 0.97) * ring * dash * 1.2, 1.0);
    return;
  }
  float rr = r / max(vCore, 1e-3);
  // A soft round core with a faint exponential halo: reads as a star at 3 px and as a disc at
  // 30 px, and halos add up (the blend is additive) where files crowd, so a dense directory
  // glows because it is dense. The halo fades out before the sprite's edge so no square or
  // circle outline ever shows.
  float core = smoothstep(0.62, 0.2, rr);
  float halo = 0.42 * vHalo * exp(-1.6 * rr) * (1.0 - smoothstep(0.65, 1.0, r));
  // A flash brightens the core in its own hue, with a faint warm glint at the center: a lone
  // touched file still twinkles, and a touched cluster stays the color of its language.
  vec3 col = vColor * (core * (1.0 + vFlash) + halo) + vec3(1.0, 0.95, 0.85) * (vFlash * 0.45 * core * core);

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
  if (vReticle.y > 0.0) {
    // The reticle: four short ticks at the compass points, clear of the core. It answers
    // "this is the star you are on" while the pointer is still moving, before hover intent
    // commits a card; ticks rather than a ring so it never reads as the selection's white ring
    // or a holotype's red one.
    float band = step(vReticle.x, r) * step(r, vReticle.y);
    float tick = max(1.0 - smoothstep(vReticle.z * 0.5, vReticle.z * 1.5, abs(c.x)), 1.0 - smoothstep(vReticle.z * 0.5, vReticle.z * 1.5, abs(c.y)));
    col += vec3(0.86, 0.91, 0.94) * band * tick * 0.55;
  }
  gl_FragColor = vec4(col * vAlpha, 1.0);
}
`;

/**
 * Filaments: one LineSegments for the whole web, each strand sampled along its Bézier with both
 * slots' positions (it follows the morph like the stars). Brightness grows with log coupling
 * (aWeight); a strand whose cluster overlaps the hovered, selected or open group (ranges in the
 * model's depth-first file order, compared as [lo, hi) intervals, so a group at any depth finds
 * its strands without an attribute upload) comes up. The strand fades toward its ends, where it
 * would otherwise draw a bright knot inside the cluster it attaches to, and with the web's share
 * of the plate as it morphs to the import graph, which has no clusters to string together.
 */
export const FILAMENT_VERTEX = /* glsl */ `
uniform float uMorph;
attribute vec3 aTo;
attribute float aT;
attribute float aWeight;
attribute vec4 aRange;      // cluster a's [lo, hi) and cluster b's [lo, hi), in depth-first file order
varying float vT;
varying float vWeight;
varying float vHot;
uniform vec2 uHot;          // hovered group's range, (-1, -1) for none
uniform vec2 uSel;          // selected group's range
uniform vec2 uFocus;        // the open drawer's range
float overlaps(vec2 r, vec2 g) {
  return step(g.x, r.y - 0.5) * step(r.x, g.y - 0.5);
}
float touches(vec2 g) {
  return max(overlaps(aRange.xy, g), overlaps(aRange.zw, g));
}
void main() {
  vec3 p = mix(position, aTo, uMorph);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  vT = aT;
  vWeight = aWeight;
  vHot = max(touches(uHot), max(touches(uSel) * 0.8, touches(uFocus) * 0.6));
}
`;

export const FILAMENT_FRAGMENT = /* glsl */ `
uniform vec3 uInk;
uniform float uOpacity;     // overall strength: the web's share of the plate, and a count falloff
uniform float uAnyHot;      // 1 while some group is hovered, selected or open
varying float vT;
varying float vWeight;
varying float vHot;
void main() {
  // Fade into each end so a strand meets its cluster as a haze, not a bright joint.
  float ends = smoothstep(0.0, 0.18, vT) * smoothstep(1.0, 0.82, vT);
  float base = 0.05 + 0.2 * vWeight;
  // With a group lit, the rest of the web steps back so its strands read.
  float a = mix(base * (1.0 - 0.45 * uAnyHot), 0.16 + 0.42 * vWeight, vHot) * ends * uOpacity;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(uInk * a, 1.0);
}
`;

/**
 * Lanes: line segments with from- and to-slot endpoints (they follow the morph), a parameter t
 * from 0 at the importer / referencing file to 1 at the dependency / definition, and a style:
 *   0 import lane      brightness grows toward the importer end; dashes drift toward the dependency
 *   1 call arc         solid, pulses of light travel toward the definition
 *   2 other-use arc    dashed (types, reads, imports), dimmer, no pulses
 *   3 callee link      faint dotted, outward from the definition
 *   4 every edge       faint and static
 *   5 implementation   solid, in the second ink, a slow pulse running out from the definition
 *   6 dispatch arc     solid, steady and dim: a caller of the interface member it implements,
 *                      which reaches it only when the call lands on this implementation. No
 *                      pulse, since a pulse claims a call the checker never saw.
 *
 * Symbol arcs (1, 2, 5, 6) fade over their last tenth into the definition. A function with 155
 * referencing files otherwise converged in a white blob that swallowed the definition ring.
 * aGain scales a whole lane (test files' arcs are drawn at TEST_GAIN).
 */
export const LANE_VERTEX = /* glsl */ `
uniform float uMorph;
attribute vec3 aTo;
attribute float aT;
attribute float aStyle;
attribute float aWeight;
attribute float aLen;       // lane length in world units, for dash spacing
attribute float aGain;      // whole-lane strength, 1 by default
varying float vT;
varying float vStyle;
varying float vWeight;
varying float vLen;
varying float vGain;
void main() {
  vec3 p = mix(position, aTo, uMorph);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  vT = aT;
  vStyle = aStyle;
  vWeight = aWeight;
  vLen = aLen;
  vGain = aGain;
}
`;

export const LANE_FRAGMENT = /* glsl */ `
uniform float uClock;
uniform float uMotion;
uniform float uOpacity;
uniform vec3 uInk;
uniform vec3 uInk2;
varying float vT;
varying float vStyle;
varying float vWeight;
varying float vLen;
varying float vGain;
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
  } else if (vStyle < 4.5) {
    a = 0.07;
  } else if (vStyle < 5.5) {
    // Implementation: solid and steady, with one slow pulse leaving the definition (t falls).
    float k = max(vLen / 180.0, 1.0);
    float pulse = pow(max(0.0, 1.0 - abs(fract(vT * k + clock * 0.3) - 0.5) * 2.0), 8.0);
    if (uMotion < 0.5) pulse = 0.0;
    a = (0.36 + 0.4 * vWeight) + pulse * 0.6;
  } else {
    // Dispatch: a call arc's line at about half its strength, with nothing travelling on it.
    a = 0.13 + 0.2 * vWeight;
  }
  bool arc = (vStyle > 0.5 && vStyle < 2.5) || vStyle > 4.5;
  if (arc) a *= 1.0 - 0.9 * smoothstep(0.88, 1.0, vT);
  a *= vGain;
  if (a <= 0.001) discard;
  vec3 ink = vStyle > 4.5 && vStyle < 5.5 ? uInk2 : uInk;
  gl_FragColor = vec4(ink * a * uOpacity, 1.0);
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

/**
 * The knockout under a symbol's definition: one point, plate-colored, normally blended between
 * the lanes and the stars. The definition star and its ring then draw over a clean patch of
 * glass however many arcs end there.
 */
export const KNOCKOUT_VERTEX = /* glsl */ `
uniform float uPx;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uPx;
}
`;

export const KNOCKOUT_FRAGMENT = /* glsl */ `
uniform vec3 uPlate;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;
  gl_FragColor = vec4(uPlate, 0.94 * smoothstep(1.0, 0.72, r));
}
`;
