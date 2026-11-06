"use strict";export const MAX_PANELS=36,modelVertex=`#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUv;
uniform mat4 uProjection, uModel;
uniform vec2 uShift;
uniform vec4 uDeform;      // swirl, twist, breathe, explode
uniform vec2 uDeform2;     // wave, time
out vec3 vNormal;
out vec2 vUv;
out float vDepth;
void main() {
  vec3 p = aPosition, n = aNormal;
  float a = uDeform.x / (length(p.xz) + 0.25) + uDeform.y * p.y;
  mat2 r = mat2(cos(a), sin(a), -sin(a), cos(a));
  p.xz = r * p.xz;
  n.xz = r * n.xz;
  p *= 1.0 + uDeform.z;
  p += normalize(p + 1e-4) * uDeform.w * (0.3 + length(p));
  p += n * uDeform2.x * sin(dot(p, vec3(3.1, 2.3, 1.7)) + uDeform2.y * 2.0);
  vec4 view = uModel * vec4(p, 1.0);
  vNormal = mat3(uModel) * n;
  vUv = aUv;
  vDepth = -view.z;
  gl_Position = uProjection * view;
  gl_Position.xy += uShift * gl_Position.w;
}`,modelFragment=`#version 300 es
precision highp float;
in vec3 vNormal;
in vec2 vUv;
in float vDepth;
uniform sampler2D uAlbedo;
uniform vec4 uColor;
uniform float uCutoff, uDistance, uHasTexture, uGrow;
uniform vec3 uLight;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outGeometry;
void main() {
  // Generated geometry grows in: its uv.x is the time it appears, cut at uGrow.
  if (vUv.x > uGrow) discard;
  vec4 albedo = uColor * (uHasTexture > 0.5 ? texture(uAlbedo, vUv) : vec4(1.0));
  if (uCutoff >= 0.0 && albedo.a < uCutoff) discard;
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  float key = max(dot(n, normalize(uLight)), 0.0);
  float rim = pow(1.0 - max(n.z, 0.0), 3.0);
  vec3 lit = albedo.rgb * (0.22 + 0.78 * key) + rim * 0.18;
  outColor = vec4(lit, 1.0);
  outGeometry = vec4(n * 0.5 + 0.5, clamp((vDepth - uDistance + 1.3) / 2.6, 0.0, 1.0));
}`,quadVertex=`#version 300 es
layout(location = 0) in vec2 aQuad;
layout(location = 1) in float aKind;   // a pattern, or -1
layout(location = 2) in vec4 aCell;    // the whole cell, uv (y up)
out vec2 vUv;
flat out float vKind;
flat out vec4 vCell;
void main() {
  vUv = aQuad;
  vKind = aKind;
  vCell = aCell;
  gl_Position = vec4(aQuad * 2.0 - 1.0, 0.0, 1.0);
}`,screenVertex=`#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;const e=`#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
#define MAX_PANELS 36
uniform vec2 uResolution;
uniform float uTime, uIntro, uGlitch, uDesignAspect, uDpr;
uniform vec2 uFocus;
uniform vec2 uSurface;              // canvas px from the screen to the page, so noise travels with the art
uniform sampler2D uAtlas, uLut;
uniform float uLutRows;
uniform vec4 uGrade;              // light, contrast, saturation, fade
uniform int uPanelCount;
uniform vec4 uPanelRect[MAX_PANELS];   // x, y, w, h in design space, y up
uniform vec4 uPanelA[MAX_PANELS];      // tile, treatment, lut row, lut amount
uniform vec4 uPanelB[MAX_PANELS];      // zoom, offset x, offset y, parameter
uniform vec4 uPanelC[MAX_PANELS];      // colour rgb, seed (stays the same however the list changes)

const float PI = 3.14159265;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Cover-fit the design rectangle to the screen; the crop centres on uFocus.
vec2 design(vec2 uv) {
  float a = uResolution.x / uResolution.y;
  if (a > uDesignAspect) {
    float f = uDesignAspect / a;
    return vec2(uv.x, clamp(uFocus.y, f * 0.5, 1.0 - f * 0.5) + (uv.y - 0.5) * f);
  }
  float f = a / uDesignAspect;
  return vec2(clamp(uFocus.x, f * 0.5, 1.0 - f * 0.5) + (uv.x - 0.5) * f, uv.y);
}
// Screen pixels per design unit along x and y.
vec2 designToPx() {
  float a = uResolution.x / uResolution.y;
  float perY = a > uDesignAspect ? uResolution.x / uDesignAspect : uResolution.y;
  return vec2(uDesignAspect, 1.0) * perY;
}
vec3 lut(float row, float t) {
  return texture(uLut, vec2(clamp(t, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0, (row + 0.5) / uLutRows)).rgb;
}

// Atlas: 2 x 2 square tiles, each with a padded border so blurred mip levels do not bleed.
// The level follows the photo's size on screen, or small photos shimmer as they move.
vec3 photo(float tile, vec2 uv) {
  float lod = max(0.0, log2(1024.0 * max(length(dFdx(uv)), length(dFdy(uv)))));
  vec2 cell = vec2(mod(tile, 2.0), 1.0 - floor(tile / 2.0)); // the atlas is uploaded flipped
  vec2 inner = clamp(uv, 0.0, 1.0) * (1.0 - 2.0 * 0.03) + 0.03;
  return textureLod(uAtlas, (cell + inner) * 0.5, lod).rgb;
}

// From Dreamcore: lift, contrast, saturation, then fade toward cream.
vec3 grade(vec3 c) {
  c = pow(max(c, 0.001), vec3(1.0 / (1.0 + uGrade.x * 0.8)));
  float l = luma(c);
  c = (c - 0.5) * uGrade.y + 0.5;
  c = mix(vec3(luma(c)), c, uGrade.z);
  return clamp(mix(c, vec3(0.95, 0.94, 0.86), uGrade.w * (1.0 - l * 0.45)), 0.0, 1.0);
}

// Local coordinates in a panel, or a negative value outside it.
vec2 panelLocal(int i, vec2 d) {
  vec4 r = uPanelRect[i];
  if (r.z <= 0.0 || r.w <= 0.0) return vec2(-1.0);
  vec2 l = (d - r.xy) / r.zw;
  if (l.x < 0.0 || l.y < 0.0 || l.x > 1.0 || l.y > 1.0) return vec2(-1.0);
  return l;
}
// Panel coordinates to square-photo coordinates: cover, zoom and offset.
vec2 panelPhotoUv(int i, vec2 l) {
  vec4 r = uPanelRect[i];
  float aspect = r.z * uDesignAspect / r.w;
  vec2 uv = aspect > 1.0 ? vec2(l.x, 0.5 + (l.y - 0.5) / aspect) : vec2(0.5 + (l.x - 0.5) * aspect, l.y);
  return (uv - 0.5) / uPanelB[i].x + 0.5 + uPanelB[i].yz;
}
`;export const plateFragment=e+`
// Rounded-rectangle coverage in device pixels, feathered by 'soft'.
float roundRect(int i, vec2 l, float radius, float soft) {
  vec2 size = uPanelRect[i].zw * designToPx();
  vec2 q = abs((l - 0.5) * size) - size * 0.5 + radius;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  return 1.0 - smoothstep(-soft - 0.5, 0.5, d);
}

// A photograph cut out on a coarse pixel grid: blobs of cells from layered noise, thinning
// toward the panel's edges, with holes and stray horizontal bars, after reference 1.
float cutoutMask(int i, vec2 l, float cellCss) {
  vec2 size = uPanelRect[i].zw * designToPx();
  float cell = cellCss * uDpr;
  // Cells of a fixed size from the panel's corner: as the panel changes shape, they stay put.
  vec2 id = floor(l * size / cell);
  vec2 q = clamp((id + 0.5) * cell / size, 0.0, 1.0);
  float seed = uPanelC[i].w * 7.31;
  float n = noise(id * 0.21 + seed) * 0.6 + noise(id * 0.07 + seed * 3.0) * 0.4;
  float edge = min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y));
  float keep = step(0.47, n * (0.45 + 0.55 * smoothstep(0.0, 0.22, edge)));
  float h = hash(vec2(id.y, seed));
  float from = hash(vec2(id.y, seed + 1.0)) * 0.7;
  float bar = step(0.9, h) * step(from, q.x) * step(q.x, from + 0.15 + 0.3 * hash(vec2(id.y, seed + 2.0)));
  return max(keep, bar);
}

vec3 treatPanel(int i, vec2 l, vec3 base) {
  vec4 A = uPanelA[i], B = uPanelB[i], C = uPanelC[i];
  float treat = A.y;
  // Slab: flat colour; 'param' rounds its corners (CSS px).
  if (treat > 1.5 && treat < 2.5) return mix(base, C.rgb, roundRect(i, l, B.w * uDpr, 0.0));
  // Soft: flat colour at 'amount', its edges feathered by 'param' (CSS px).
  if (treat > 5.5 && treat < 6.5) return mix(base, C.rgb, roundRect(i, l, B.w * uDpr, B.w * uDpr) * A.w);
  if (treat > 2.5 && treat < 4.5) return base;
  vec3 raw = photo(A.x, panelPhotoUv(i, l));
  // Map the ungraded photograph so the grade does not flatten the gradient.
  vec3 c = treat < 0.5 ? grade(raw) : mix(grade(raw), lut(A.z, luma(raw)), A.w);
  if (treat > 4.5) return mix(base, c, cutoutMask(i, l, B.w));
  return c;
}

flat in float vKind;
flat in vec4 vCell;
// Patterns for the art between the hero and the close: ink on the ground, in CSS px fixed to the
// page, varying across the cell so a cell that changes shape changes its pattern with it.
float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int b[16] = int[](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(b[q.x + q.y * 4]) + 0.5) / 16.0;
}
float pattern(float kind, vec2 q) {
  vec2 p = (gl_FragCoord.xy + uSurface) / uDpr;
  float aa = 0.75 / uDpr;
  if (kind < 0.5) {            // dot grid
    vec2 f = mod(p, 8.0) - 4.0;
    return (1.0 - smoothstep(1.0 - aa, 1.0 + aa, length(f))) * 0.55;
  }
  if (kind < 1.5) {            // hatching
    float h = mod(p.x + p.y, 7.0);
    return step(h, 1.0) * 0.32;
  }
  if (kind < 2.5) {            // halftone, growing down the cell
    vec2 f = mod(p, 7.0) - 3.5;
    float r = mix(0.4, 3.0, q.y);
    return (1.0 - smoothstep(r - aa, r + aa, length(f))) * 0.45;
  }
  if (kind < 3.5) {            // ordered-dither ramp across the cell
    return step(bayer4(floor(p)), q.x * 0.7) * 0.4;
  }
  if (kind < 4.5) {            // crosses
    vec2 f = abs(mod(p, 16.0) - 8.0);
    return step(min(f.x, f.y), 0.5) * step(max(f.x, f.y), 3.0) * 0.6;
  }
  return step(mod(p.y, 4.0), 1.0) * 0.28;   // rules
}

void main() {
  vec2 d = design(vUv);
  vec3 c = vec3(0.94);
  if (vKind > -0.5) {
    vec2 q = clamp((vUv - vCell.xy) / max(vCell.zw - vCell.xy, vec2(1e-5)), 0.0, 1.0);
    q.y = 1.0 - q.y;
    vec3 ground = uPanelC[0].rgb, ink = vec3(1.0) - ground;
    fragColor = vec4(mix(ground, ink, pattern(vKind, q)), 1.0);
    return;
  }
  for (int i = 0; i < MAX_PANELS; i++) {
    if (i >= uPanelCount) break;
    vec2 l = panelLocal(i, d);
    if (l.x < 0.0) continue;
    c = treatPanel(i, l, c);
  }
  fragColor = vec4(c, 1.0);
}`,finalFragment=e+`
uniform sampler2D uPlate, uModelColor, uLineColor, uLineGeometry, uFieldSmall, uFieldLarge;
uniform float uSlices;     // row slip amount
uniform vec2 uTexel;       // one model-target pixel
uniform vec4 uLines;       // line model's amount, body fill, find-edges blur level, unused
uniform vec4 uEdge;        // colour gain, geometry ink, saturation, whiten
uniform vec3 uInk;
uniform vec4 uFlare;       // amount, x, y (design, y up), size
uniform vec2 uFlareGhost;  // ghost centre (design, y up)
uniform float uFlarePanel; // clip the flare to this panel, or -1
uniform int uPlant[12];      // the panels that read the plant, in order
uniform int uPlantCount;

// Rows slip sideways while the models resolve and during a glitch.
vec2 sliceUv(vec2 uv) {
  if (uSlices <= 0.0) return uv;
  float band = floor(uv.y * 64.0);
  float tick = floor(uTime * 12.0);
  float resolve = 1.0 - smoothstep(0.32, 0.72, uIntro);
  float amp = uSlices * (resolve * 0.35 + uGlitch);
  float h = hash(vec2(band, tick));
  return uv + vec2(step(0.62, h) * (hash(vec2(band, tick + 9.0)) - 0.5) * amp, 0.0);
}

// Lens flare after reference 5: a hot core, a soft halo, six spikes, a thin anamorphic
// streak, and a blue ghost ring.
vec3 flare(vec2 d) {
  vec2 v = (d - uFlare.yz) * vec2(uDesignAspect, 1.0);
  float s = uFlare.w;
  float rr = length(v);
  float core = exp(-dot(v, v) / (s * s * 0.012)) * 2.6;
  float halo = exp(-rr / (s * 0.45)) * 0.4;
  float spikes = pow(abs(cos(3.0 * atan(v.y, v.x) + 0.3)), 60.0) * exp(-rr / (s * 0.3)) * 0.6;
  float taper = 0.65 + 0.35 * noise(vec2(v.x * 60.0, 1.0));
  float streak = exp(-abs(v.y) / (s * 0.01)) * exp(-abs(v.x) / (s * 1.2)) * 0.7 * taper;
  vec2 g = (d - uFlareGhost) * vec2(uDesignAspect, 1.0);
  float ring = exp(-pow((length(g) - s * 0.45) / (s * 0.06), 2.0)) * 0.35
    + exp(-dot(g, g) / (s * s * 0.06)) * 0.25;
  return vec3(1.0, 0.98, 0.94) * (core + halo + spikes) + vec3(0.75, 0.88, 1.0) * streak + vec3(0.12, 0.3, 1.0) * ring;
}

// Photoshop's Find Edges: per-channel Sobel on the lit line model (on white), inverted.
vec3 findEdges(vec2 uv) {
  vec3 gx = vec3(0.0), gy = vec3(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec4 s = textureLod(uLineColor, uv + vec2(x, y) * uTexel * exp2(uLines.z), uLines.z);
    vec3 c = mix(vec3(1.0), s.rgb, s.a);
    float wx = float(x) * (y == 0 ? 2.0 : 1.0), wy = float(y) * (x == 0 ? 2.0 : 1.0);
    gx += c * wx; gy += c * wy;
  }
  return 1.0 - clamp(sqrt(gx * gx + gy * gy) * uEdge.x * 0.5, 0.0, 1.0);
}
// Creases and silhouettes from normals and depth.
float geometryEdges(vec2 uv) {
  vec4 gx = vec4(0.0), gy = vec4(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = uv + vec2(x, y) * uTexel;
    vec4 s = mix(vec4(0.5, 0.5, 1.0, 1.0), texture(uLineGeometry, o), texture(uLineColor, o).a);
    float wx = float(x) * (y == 0 ? 2.0 : 1.0), wy = float(y) * (x == 0 ? 2.0 : 1.0);
    gx += s * wx; gy += s * wy;
  }
  vec4 g = sqrt(gx * gx + gy * gy);
  return clamp(length(g.rgb) * 0.5 + g.a * 3.0 - 0.3, 0.0, 1.0);
}
// The PSD's line art: Find Edges plus geometry lines, desaturated and whitened (1 = paper).
vec3 edgeLayer(vec2 uv) {
  vec3 fe = findEdges(uv);
  if (uEdge.y > 0.0) fe *= 1.0 - geometryEdges(uv) * uEdge.y;
  fe = mix(vec3(luma(fe)), fe, uEdge.z);
  return clamp(fe / (1.0 - uEdge.w), 0.0, 1.0);
}

// Panels that read the plant: a dot matrix, or a glow field.
vec3 plantPanel(int i, vec2 l, vec2 screenUv) {
  vec4 A = uPanelA[i], B = uPanelB[i], C = uPanelC[i];
  // Panels show a zoomed, shifted view of the plant: uv = (screen - 0.5) / zoom + 0.5 - offset.
  vec2 uv = (screenUv - 0.5) / B.x + 0.5 - B.yz;
  if (A.y < 3.5) {
    // Dot matrix on a grid anchored to the panel's corner. Each cell averages the plant
    // under it (a mip level the size of the cell). Lit interior cells fill, shaded cells
    // and contours ring, the fringe gets small dots, and empty cells keep a sparse
    // scatter of grey specks, as in the specimen reference.
    vec2 local = l * uPanelRect[i].zw * designToPx();
    float cell = B.w * uDpr;
    vec2 id = floor(local / cell);
    vec2 centre = screenUv + ((id + 0.5) * cell - local) / uResolution;
    vec2 suv = (centre - 0.5) / B.x + 0.5 - B.yz;
    float lod = max(log2(cell / B.x) - 2.0, 0.0);  // the plant renders at half size
    vec4 s = textureLod(uModelColor, suv, lod);
    float cover = s.a;
    float bright = luma(s.rgb) / max(s.a, 1e-3);
    vec4 whole = textureLod(uModelColor, vec2(0.5), 14.0);
    float mean = luma(whole.rgb) / max(whole.a, 1e-4);
    vec2 st = vec2(cell) / uResolution / B.x;
    float dx = abs(textureLod(uModelColor, suv - vec2(st.x, 0.0), lod).a - textureLod(uModelColor, suv + vec2(st.x, 0.0), lod).a);
    float dy = abs(textureLod(uModelColor, suv - vec2(0.0, st.y), lod).a - textureLod(uModelColor, suv + vec2(0.0, st.y), lod).a);
    float contour = step(0.45, max(dx, dy));
    float isFilled = step(0.6, cover) * step(mean * 0.8, bright) * (1.0 - contour);
    float isRing = step(0.3, cover) * (1.0 - isFilled);
    float isSmall = step(0.06, cover) * step(cover, 0.3);
    float rel = clamp(bright / max(mean * 1.6, 1e-3), 0.0, 1.0);
    float r = length(local - (id + 0.5) * cell);
    float aa = 0.8;
    float filled = (1.0 - smoothstep(cell * 0.34 - aa, cell * 0.34 + aa, r)) * isFilled;
    float ring = (1.0 - smoothstep(cell * 0.09 * 0.5 - aa * 0.5, cell * 0.09 * 0.5 + aa, abs(r - cell * 0.27))) * isRing;
    float small = (1.0 - smoothstep(cell * 0.12 - aa, cell * 0.12 + aa, r)) * isSmall;
    float h = hash(id + 41.0 + C.w * 97.0);
    float specR = cell * (0.04 + 0.1 * hash(id + 7.0));
    float speck = (1.0 - smoothstep(specR - aa, specR + aa, r)) * step(cover, 0.06) * step(h, 0.16);
    vec3 c = C.rgb;
    c = mix(c, vec3(luma(lut(A.z, 0.5))) * 1.4, speck * 0.6);
    c = mix(c, lut(A.z, 0.66), small);
    c = mix(c, lut(A.z, 0.74), ring);
    return mix(c, lut(A.z, 0.62 + 0.3 * rel), filled);
  }
  // Glow field: the coverage blurred at two radii (separable Gaussians at quarter
  // resolution), eased so it never clips, with a warm core where the small blur is
  // dense, over the panel's own gradient, carrying its own grain.
  float a = texture(uFieldSmall, uv).r;
  float b = texture(uFieldLarge, uv).r;
  float t = 1.0 - exp(-(a * 0.7 + b * 0.9) * 1.5 * A.w);
  float ground = 0.04 + (1.0 - l.y) * 0.08;
  vec3 c = lut(A.z, mix(ground, 0.84, t));
  c = mix(c, lut(A.z, 0.97), smoothstep(0.55, 0.95, a) * 0.6);
  // Its grain holds still: redrawn each frame it would flip the dither below, and shimmer.
  vec2 at = floor(gl_FragCoord.xy + uSurface);
  c += (hash(at) + hash(at * 1.3) - 1.0) * 0.07 * (0.35 + t);
  return c;
}

void main() {
  vec2 d = design(vUv);
  vec3 c = texture(uPlate, vUv).rgb;

  // Additive, so the core can exceed 1 and only it feeds the bloom.
  if (uFlare.x > 0.0 && (uFlarePanel < 0.0 || panelLocal(int(uFlarePanel), d).x >= 0.0)) c += flare(d) * uFlare.x;

  vec2 suv = sliceUv(vUv);
  for (int k = 0; k < uPlantCount; k++) {
    int i = uPlant[k];
    vec2 l = panelLocal(i, d);
    if (l.x >= 0.0) c = plantPanel(i, l, suv);
  }

  // The line model over everything: its body filled with the ground colour (panel 0) so it
  // hides what lies behind, then Find Edges lines in the ink colour.
  if (uLines.x > 0.0) {
    c = mix(c, uPanelC[0].rgb, texture(uLineColor, suv).a * uLines.y);
    c = mix(c, uInk, clamp(1.0 - luma(edgeLayer(suv)), 0.0, 1.0) * uLines.x);
  }

  fragColor = vec4(clamp(c, 0.0, 16.0), 1.0);
}`,blurFragment=`#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSource;
uniform vec2 uStep;
uniform float uFromAlpha, uLod;
float value(vec2 uv) {
  vec4 s = textureLod(uSource, uv, uLod);
  return uFromAlpha > 0.5 ? s.a : s.r;
}
void main() {
  const float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  float v = value(vUv) * w[0];
  for (int i = 1; i < 5; i++) {
    v += (value(vUv + uStep * float(i)) + value(vUv - uStep * float(i))) * w[i];
  }
  fragColor = vec4(v, v, v, 1.0);
}`;const o="0.5";export const postFragment=`#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uComp, uBloomMips;
uniform vec2 uResolution;
uniform float uTime;
uniform vec4 uBloom;   // amount, threshold, first blur level, warmth
uniform vec4 uLens;    // vignette, aberration, grain, grain size (px)
uniform vec4 uPaper;   // paper amount, chroma grain, colour amount, unused
uniform int uBandCount;
uniform vec4 uBand[8];     // bottom, top (uv), kind: 0 quieter, 1 tinted; dark ground 1 / light ground 0
uniform vec3 uBandBase[8], uBandOn[8];
uniform vec3 uGround;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec2 uv = vUv;
  vec2 dc = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float edge = dot(dc, dc);
  vec2 shift = (uv - 0.5) * uLens.y * 0.006 * edge;
  vec3 c = vec3(texture(uComp, uv + shift).r, texture(uComp, uv).g, texture(uComp, uv - shift).b);

  vec3 bloom = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec3 s = textureLod(uBloomMips, uv, max(uBloom.z - 2.0, 0.0) + float(i) * 1.25).rgb;  // the copy starts at level 2
    float l = max(s.r, max(s.g, s.b));
    float knee = 0.25;
    float soft = clamp(l - uBloom.y + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    bloom += s * max(soft, l - uBloom.y) / max(l, 1e-4);
  }
  bloom *= 0.25 * mix(vec3(1.0), vec3(1.0, 0.86, 0.78), uBloom.w);
  c += bloom * uBloom.x;
  // Values above 1 (the flare core) spill into neighbouring channels before clipping,
  // so hot spots go white instead of a saturated hue. Values at or below 1 are unchanged.
  float over = max(max(c.r, max(c.g, c.b)) - 1.0, 0.0);
  c += over * 0.5;

  c *= 1.0 - uLens.x * smoothstep(0.15, 0.95, edge * 1.4);
  c = mix(vec3(luma(c)), c, uPaper.z);

  // Art outside the hero and the close: quieter on the page, its section's own colour on a colour section.
  for (int i = 0; i < uBandCount; i++) {
    vec4 b = uBand[i];
    if (uv.y < b.x || uv.y >= b.y) continue;
    if (b.z > 0.5) {
      // The art's ground lands on the section's colour, its structure on the section's ink.
      float t = clamp(abs(luma(c) - uGround.g), 0.0, 1.0);
      c = mix(uBandBase[i], uBandOn[i], ${o} * smoothstep(0.02, 0.95, t));
    } else {
      c = vec3(luma(c));
    }
    break;
  }

  // Film grain: two hashes approximate a bell curve, re-seeded at 24 fps, strongest in
  // the midtones, with a little independent colour noise.
  vec2 g = floor(gl_FragCoord.xy / max(uLens.w, 1.0));
  float seed = floor(uTime * 24.0);
  float n = hash(g + seed * 13.1) + hash(g * 1.37 + seed * 7.7) - 1.0;
  vec3 chroma = vec3(hash(g + seed + 3.0), hash(g + seed + 5.0), hash(g + seed + 9.0)) - 0.5;
  float l = luma(c);
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  float body = 0.35 + 2.6 * l * (1.0 - l) + sat * 0.6;
  c += (n + chroma * uPaper.y) * uLens.z * 0.085 * body;
  if (uPaper.x > 0.0) {
    float fibre = noise(gl_FragCoord.xy * vec2(0.9, 0.12)) * 0.6 + noise(gl_FragCoord.xy * 1.7) * 0.4;
    c += (fibre - 0.5) * uPaper.x * 0.05;
  }
  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
