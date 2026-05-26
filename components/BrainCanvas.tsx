"use client";

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { SliceAxis } from "@/lib/sliceContour";

const VERTEX_SHADER = /* glsl */ `
attribute float voltage;
varying float vVoltage;
varying vec3 vNormal;
varying vec3 vPosition;

void main() {
  vVoltage = voltage;
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vPosition = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
varying float vVoltage;
varying vec3 vNormal;
varying vec3 vPosition;

uniform vec3 lightDir;

vec3 colormap(float u) {
  // Map voltage to a darkness-first ramp: resting is near black, any
  // depolarization above the firing threshold pops in cyan and then
  // pink-hot. The breakpoints are tuned to the FHN nullcline crossings.
  float t = clamp((u + 1.3) / 3.1, 0.0, 1.0);
  vec3 dark   = vec3(0.012, 0.022, 0.055);
  vec3 navy   = vec3(0.055, 0.110, 0.260);
  vec3 cyan   = vec3(0.150, 0.580, 0.950);
  vec3 white  = vec3(0.880, 0.960, 1.000);
  vec3 pink   = vec3(1.000, 0.420, 0.900);
  vec3 hot    = vec3(1.000, 0.880, 1.000);
  vec3 c;
  if (t < 0.15)      c = mix(dark, navy,  t / 0.15);
  else if (t < 0.40) c = mix(navy, cyan,  (t - 0.15) / 0.25);
  else if (t < 0.60) c = mix(cyan, white, (t - 0.40) / 0.20);
  else if (t < 0.80) c = mix(white, pink, (t - 0.60) / 0.20);
  else               c = mix(pink, hot,   (t - 0.80) / 0.20);
  return c;
}

void main() {
  vec3 base = colormap(vVoltage);
  vec3 N = normalize(vNormal);
  // Camera-relative shading on N (already in view space) plus a tilted
  // key light gives both depth cues and a symmetric appearance across
  // the rotating brain.
  float facing = max(0.0, N.z);
  float key = max(0.0, dot(N, normalize(lightDir)));
  float lam = 0.55 * facing + 0.45 * key;
  vec3 lit = base * (0.28 + 0.70 * lam);
  float exc = smoothstep(-0.5, 0.8, vVoltage);
  lit += base * exc * 1.8;
  gl_FragColor = vec4(lit, 1.0);
}
`;

type Props = {
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  voltageRef: React.MutableRefObject<Float32Array | null>;
  sliceAxis: SliceAxis;
  slicerOffset: number;
  onPick: (vertexIndex: number) => void;
};

function CortexMesh({ positions, indices, normals, voltageRef, sliceAxis, slicerOffset, onPick }: Props) {
  const voltage = voltageRef.current ?? new Float32Array(positions.length / 3);
  const meshRef = useRef<THREE.Mesh>(null);
  const geometryRef = useRef<THREE.BufferGeometry>(null);
  const voltageAttribRef = useRef<THREE.BufferAttribute | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    const voltageAttrib = new THREE.BufferAttribute(new Float32Array(voltage), 1);
    voltageAttrib.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("voltage", voltageAttrib);
    voltageAttribRef.current = voltageAttrib;
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1.2);
    return g;
    // We deliberately do not include voltage in the deps: the buffer is
    // mutated in place each frame, not re-attached.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, indices, normals]);

  const clipPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), []);

  // Orient the clip plane to match the chosen slice axis. The plane
  // normal points in the negative axis direction so that the visible
  // half-space is the one with smaller axis value than the offset.
  useEffect(() => {
    const n =
      sliceAxis === "x"
        ? new THREE.Vector3(-1, 0, 0)
        : sliceAxis === "y"
        ? new THREE.Vector3(0, -1, 0)
        : new THREE.Vector3(0, 0, -1);
    clipPlane.normal.copy(n);
  }, [sliceAxis, clipPlane]);

  const material = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        lightDir: { value: new THREE.Vector3(0.35, 0.7, 0.55).normalize() },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: false,
      side: THREE.DoubleSide,
      clippingPlanes: [clipPlane],
      clipShadows: true,
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(() => {
    const live = voltageRef.current;
    if (!live) return;
    const fresh = new THREE.BufferAttribute(new Float32Array(live), 1);
    fresh.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("voltage", fresh);
    voltageAttribRef.current = fresh;
    clipPlane.constant = slicerOffset;
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!e.face) return;
    const candidates = [e.face.a, e.face.b, e.face.c];
    let best = candidates[0];
    let bestD2 = Infinity;
    const p = e.point;
    for (const ci of candidates) {
      const dx = positions[ci * 3] - p.x;
      const dy = positions[ci * 3 + 1] - p.y;
      const dz = positions[ci * 3 + 2] - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = ci;
      }
    }
    onPick(best);
  };

  void geometryRef;
  void materialRef;
  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      onClick={handleClick}
    />
  );
}

function Backdrop() {
  const points = useMemo(() => {
    const arr = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      const r = 6 + Math.random() * 12;
      const t = Math.random() * Math.PI * 2;
      const p = (Math.random() - 0.5) * Math.PI;
      arr[i * 3] = r * Math.cos(p) * Math.cos(t);
      arr[i * 3 + 1] = r * Math.sin(p);
      arr[i * 3 + 2] = r * Math.cos(p) * Math.sin(t) - 4;
    }
    return arr;
  }, []);
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[points, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.018}
        color="#8a9ed0"
        transparent
        opacity={0.55}
        sizeAttenuation
        toneMapped={false}
      />
    </points>
  );
}

function EnableClipping() {
  const { gl } = useThree();
  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);
  return null;
}

export default function BrainCanvas(props: Props) {
  return (
    <div className="w-full h-full">
      <Canvas
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
        camera={{ position: [0, 0.4, 3.1], fov: 36 }}
        style={{ background: "linear-gradient(180deg,#04060f 0%,#070b22 100%)" }}
      >
        <EnableClipping />
        <ambientLight intensity={0.3} />
        <pointLight position={[3, 4, 3]} intensity={0.6} color="#9ad4ff" />
        <pointLight position={[-3, -2, -1]} intensity={0.4} color="#ff7adb" />
        <Backdrop />
        <CortexMesh {...props} />
        <OrbitControls
          enablePan={false}
          minDistance={1.7}
          maxDistance={4.5}
          autoRotate
          autoRotateSpeed={0.15}
        />
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.55} luminanceThreshold={0.78} luminanceSmoothing={0.55} mipmapBlur />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
