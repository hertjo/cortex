"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

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
  // u resting is about -1.27, depolarized peaks around +1.5. We compress
  // the active range so transitions are visually punchy.
  float t = clamp((u + 1.4) / 2.6, 0.0, 1.0);
  vec3 navy   = vec3(0.020, 0.035, 0.075);
  vec3 cyan   = vec3(0.080, 0.380, 0.780);
  vec3 white  = vec3(0.760, 0.940, 0.980);
  vec3 pink   = vec3(0.980, 0.420, 0.880);
  vec3 hot    = vec3(1.000, 0.880, 1.000);
  vec3 c;
  if (t < 0.20)      c = mix(navy, cyan,  t / 0.20);
  else if (t < 0.45) c = mix(cyan, white, (t - 0.20) / 0.25);
  else if (t < 0.75) c = mix(white, pink, (t - 0.45) / 0.30);
  else               c = mix(pink, hot,   (t - 0.75) / 0.25);
  return c;
}

void main() {
  vec3 base = colormap(vVoltage);
  float lam = max(dot(normalize(vNormal), normalize(lightDir)), 0.0);
  // The resting cortex stays dim and structured by the Lambertian term;
  // depolarized regions blow past unity and bloom.
  float exc = smoothstep(-1.0, 0.4, vVoltage);
  vec3 lit = base * (0.20 + 0.35 * lam);
  lit += base * exc * 1.8;
  gl_FragColor = vec4(lit, 1.0);
}
`;

type Props = {
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  voltage: Float32Array;
  slicerOffset: number;
  onPick: (vertexIndex: number) => void;
};

function CortexMesh({ positions, indices, normals, voltage, slicerOffset, onPick }: Props) {
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

  // Push voltage updates each frame.
  useFrame(() => {
    const attr = voltageAttribRef.current;
    if (!attr) return;
    const dst = attr.array as Float32Array;
    if (dst.length !== voltage.length) return;
    dst.set(voltage);
    attr.needsUpdate = true;
    clipPlane.constant = slicerOffset;
  });

  // Raycast on click to find the nearest vertex.
  const { camera, raycaster, gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const onClick = (e: MouseEvent) => {
      if (!meshRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      raycaster.params.Mesh = { threshold: 0 };
      const hits = raycaster.intersectObject(meshRef.current, false);
      if (hits.length === 0) return;
      const hit = hits[0];
      // Pick the closest of the triangle's three vertices.
      if (hit.face) {
        const candidates = [hit.face.a, hit.face.b, hit.face.c];
        let best = candidates[0];
        let bestD2 = Infinity;
        const p = hit.point;
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
      }
    };
    canvas.addEventListener("click", onClick);
    return () => canvas.removeEventListener("click", onClick);
  }, [camera, raycaster, gl, positions, onPick]);

  void geometryRef;
  void materialRef;
  return <mesh ref={meshRef} geometry={geometry} material={material} />;
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
          autoRotateSpeed={0.45}
        />
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.55} luminanceThreshold={0.78} luminanceSmoothing={0.55} mipmapBlur />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
