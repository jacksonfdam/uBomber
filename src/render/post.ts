/**
 * Post-processing: bloom on the blasts, a per-map colour grade, vignette,
 * film grain and a whisper of chromatic aberration.
 *
 * Every stage is switchable and the whole composer can be bypassed, which is
 * how the 60 fps floor on integrated graphics is held: the quality toggle
 * drops straight back to a plain forward render.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { MapTheme } from './theme';

/**
 * Chromatic aberration strength in UV units. Kept low deliberately: the split
 * grows with the square of the distance from centre, so anything higher smears
 * visible colour bars down the outer edge of a wide viewport.
 */
const ABERRATION = 0.00045;

const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uSaturation: { value: 1 },
    uVignette: { value: 0.3 },
    uGrain: { value: 0.022 },
    uAberration: { value: ABERRATION },
    uFlash: { value: 0 },
    uTime: { value: 0 },
    uEnabled: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform vec3 uGain;
    uniform vec3 uLift;
    uniform float uSaturation;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uFlash;
    uniform float uTime;
    uniform float uEnabled;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      if (uEnabled < 0.5) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }
      vec2 fromCenter = vUv - 0.5;
      float r2 = dot(fromCenter, fromCenter);

      // Chromatic aberration, growing toward the edges. Samples are clamped so
      // the outermost pixels cannot pull colour in from outside the frame.
      vec2 ab = fromCenter * uAberration * (1.0 + r2 * 2.0) * 2.0;
      vec3 col;
      col.r = texture2D(tDiffuse, clamp(vUv + ab, 0.0, 1.0)).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, clamp(vUv - ab, 0.0, 1.0)).b;

      col = col * uGain + uLift;

      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);

      // Detonation flash: a brief global lift, strongest at the centre.
      col += uFlash * (1.0 - r2 * 0.8) * vec3(1.0, 0.86, 0.62);

      col *= 1.0 - uVignette * smoothstep(0.12, 0.62, r2);

      float g = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 61.7) - 0.5;
      col += g * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export interface PostSettings {
  enabled: boolean;
  bloom: boolean;
  grain: boolean;
  aberration: boolean;
}

export const DEFAULT_POST: PostSettings = {
  enabled: true,
  bloom: true,
  grain: true,
  aberration: true,
};

export class PostStack {
  readonly composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private gradePass: ShaderPass;
  private settings: PostSettings = { ...DEFAULT_POST };

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    theme: MapTheme,
    width: number,
    height: number
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      theme.bloom,
      0.55,
      0.8
    );
    this.composer.addPass(this.bloomPass);
    this.gradePass = new ShaderPass(GRADE_SHADER);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());
    this.applyTheme(theme);
    this.apply(this.settings);
  }

  applyTheme(theme: MapTheme): void {
    const u = this.gradePass.uniforms;
    u.uGain.value.set(...theme.grading.gain);
    u.uLift.value.set(...theme.grading.lift);
    u.uSaturation.value = theme.grading.saturation;
    u.uVignette.value = theme.grading.vignette;
    this.bloomPass.strength = theme.bloom;
  }

  apply(settings: PostSettings): void {
    this.settings = settings;
    this.bloomPass.enabled = settings.enabled && settings.bloom;
    const u = this.gradePass.uniforms;
    u.uEnabled.value = settings.enabled ? 1 : 0;
    u.uGrain.value = settings.enabled && settings.grain ? 0.022 : 0;
    u.uAberration.value = settings.enabled && settings.aberration ? ABERRATION : 0;
  }

  /** 0..1 white-out driven by the match, decayed by the caller. */
  setFlash(amount: number): void {
    this.gradePass.uniforms.uFlash.value = amount;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  render(timeSec: number): void {
    this.gradePass.uniforms.uTime.value = timeSec;
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
