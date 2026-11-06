"use strict";export const FILTERS={findEdges:{params:{strength:[1.5,0,6],mono:[.6,0,1],whiten:[.2,0,.9]},glsl:`
vec3 apply(vec2 uv, vec3 c) {
  vec3 gx = vec3(0.0), gy = vec3(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 s = src(uv + vec2(x, y) * uTexel);
    float wx = float(x) * (y == 0 ? 2.0 : 1.0), wy = float(y) * (x == 0 ? 2.0 : 1.0);
    gx += s * wx; gy += s * wy;
  }
  vec3 e = 1.0 - clamp(sqrt(gx * gx + gy * gy) * uA.x * 0.5, 0.0, 1.0);
  e = mix(e, vec3(luma(e)), uA.y);
  return clamp(e / (1.0 - uA.z), 0.0, 1.0);
}`},gradientMap:{params:{lut:"nightbloom",blend:[0,0,3]},glsl:`
vec3 apply(vec2 uv, vec3 c) {
  vec3 m = lut(uLutRow, luma(c));
  float b = floor(uA.x + 0.5);
  if (b < 0.5) return m;
  if (b < 1.5) return c * m;
  if (b < 2.5) return 1.0 - (1.0 - c) * (1.0 - m);
  return mix(2.0 * c * m + c * c * (1.0 - 2.0 * m), sqrt(c) * (2.0 * m - 1.0) + 2.0 * c * (1.0 - m), step(0.5, m));
}`},halftone:{params:{cell:[6,2,24],angle:[.785,0,1.57],contrast:[1.2,.5,2.5]},glsl:`
vec3 apply(vec2 uv, vec3 c) {
  float cell = uA.x * uDpr;
  mat2 r = mat2(cos(uA.y), sin(uA.y), -sin(uA.y), cos(uA.y));
  vec2 p = r * (uv * uResolution) / cell;
  // Each dot takes the colour at its own centre (rotated back into screen pixels).
  vec3 s = src(transpose(r) * ((floor(p) + 0.5) * cell) / uResolution);
  float v = clamp((luma(s) - 0.5) * uA.z + 0.5, 0.0, 1.0);
  float rad = sqrt(1.0 - v) * 0.62;
  float d = length(fract(p) - 0.5);
  float aa = 1.2 / cell;
  return mix(vec3(0.97), s, 1.0 - smoothstep(rad - aa, rad + aa, d));
}`},pixelate:{params:{cell:[8,2,48]},glsl:`
vec3 apply(vec2 uv, vec3 c) {
  vec2 cell = vec2(uA.x * uDpr) / uResolution;
  return src((floor(uv / cell) + 0.5) * cell);
}`},dither:{params:{levels:[3,2,8],scale:[1,1,4]},glsl:`
vec3 apply(vec2 uv, vec3 c) {
  // The pattern travels with the art; fixed to the screen, moving art crawls through it.
  ivec2 q = ivec2(mod(floor((gl_FragCoord.xy + uSurface) / (uA.y * uDpr)), 4.0));
  int i = q.x + q.y * 4;
  int b[16] = int[](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  float t = (float(b[i]) + 0.5) / 16.0 - 0.5;
  float n = uA.x - 1.0;
  return floor(clamp(c, 0.0, 1.0) * n + 0.5 + t) / n;
}`},posterize:{params:{levels:[5,2,16]},glsl:`
vec3 apply(vec2 uv, vec3 c) { return floor(clamp(c, 0.0, 1.0) * uA.x) / max(uA.x - 1.0, 1.0); }`},threshold:{params:{level:[.5,0,1],softness:[.02,0,.3]},glsl:`
vec3 apply(vec2 uv, vec3 c) { return vec3(smoothstep(uA.x - uA.y, uA.x + uA.y, luma(c))); }`},invert:{params:{},glsl:`
vec3 apply(vec2 uv, vec3 c) { return 1.0 - clamp(c, 0.0, 1.0); }`},rgbShift:{params:{distance:[3,0,24],angle:[0,0,6.28]},glsl:`
vec3 apply(vec2 uv, vec3 c) {
  vec2 o = vec2(cos(uA.y), sin(uA.y)) * uA.x * uDpr / uResolution;
  return vec3(src(uv + o).r, c.g, src(uv - o).b);
}`},blur:{params:{radius:[2,0,6]},mips:!0,glsl:`
vec3 apply(vec2 uv, vec3 c) { return textureLod(uSrc, uv, uA.x).rgb; }`},sharpen:{params:{strength:[.8,0,3]},glsl:`
vec3 apply(vec2 uv, vec3 c) {
  vec3 n = src(uv + vec2(uTexel.x, 0.0)) + src(uv - vec2(uTexel.x, 0.0)) + src(uv + vec2(0.0, uTexel.y)) + src(uv - vec2(0.0, uTexel.y));
  return c + (c * 4.0 - n) * uA.x;
}`},adjust:{params:{brightness:[0,-.5,.5],contrast:[1,0,2.5],saturation:[1,0,2.5],gamma:[1,.3,3]},glsl:`
vec3 apply(vec2 uv, vec3 c) {
  c = pow(max(c, 0.0), vec3(1.0 / uA.w));
  c = (c - 0.5) * uA.y + 0.5 + uA.x;
  return mix(vec3(luma(c)), c, uA.z);
}`},scanlines:{params:{spacing:[3,2,16],darkness:[.35,0,1],drift:[.2,0,4]},glsl:`
vec3 apply(vec2 uv, vec3 c) {
  float y = gl_FragCoord.y / uDpr + uTime * uA.z * 10.0;
  return c * (1.0 - uA.y * step(0.5, fract(y / uA.x)));
}`}};export function filterSource(e){return`#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc, uLut;
uniform vec2 uResolution, uTexel, uSurface;
uniform float uTime, uDpr, uAmount, uLutRows, uLutRow;
uniform vec4 uA, uB;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 src(vec2 uv) { return texture(uSrc, uv).rgb; }
vec3 lut(float row, float t) {
  return texture(uLut, vec2(clamp(t, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0, (row + 0.5) / uLutRows)).rgb;
}
${FILTERS[e].glsl}
void main() {
  vec3 c = src(vUv);
  fragColor = vec4(mix(c, apply(vUv, c), uAmount), 1.0);
}`}export function newFilter(e){const c={type:e,on:!0,amount:1};for(const[r,u]of Object.entries(FILTERS[e].params))c[r]=Array.isArray(u)?u[0]:u;return c}export function filterUniforms(e){const c=Object.entries(FILTERS[e.type].params).filter(([,r])=>Array.isArray(r)).map(([r,u])=>e[r]??u[0]);for(;c.length<8;)c.push(0);return[c.slice(0,4),c.slice(4,8)]}
