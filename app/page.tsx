import Studio from "@/components/Studio";

export default function Page() {
  return (
    <div className="relative min-h-screen text-white">
      <Backdrop />
      <Header />
      <Studio />
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="relative px-8 pt-7 pb-4 flex items-center">
      <div className="flex items-center gap-3.5">
        <Sigil />
        <div className="leading-tight">
          <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-white">
            Cortex
          </h1>
          <p className="text-[10.5px] tracking-[0.32em] uppercase text-white/35 mt-0.5">
            reaction diffusion on the cortical surface
          </p>
        </div>
      </div>
    </header>
  );
}

function Sigil() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <defs>
        <radialGradient id="sig-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#7adcff" />
          <stop offset="100%" stopColor="#7adcff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sig-pink" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ff7adb" />
          <stop offset="100%" stopColor="#ff7adb" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0.5" y="0.5" width="33" height="33" rx="8" stroke="rgba(255,255,255,0.15)" fill="rgba(255,255,255,0.02)" />
      <circle cx="17" cy="17" r="11" fill="url(#sig-glow)" />
      <path
        d="M 9 17 Q 13 11 17 17 T 25 17"
        stroke="#7adcff"
        strokeWidth="1.4"
        fill="none"
        opacity="0.85"
      />
      <path
        d="M 9 21 Q 13 15 17 21 T 25 21"
        stroke="#ff7adb"
        strokeWidth="1.4"
        fill="none"
        opacity="0.85"
      />
      <circle cx="13" cy="17" r="1.4" fill="#ffffff" />
      <circle cx="21" cy="17" r="1.4" fill="#ffffff" />
      <circle cx="13" cy="17" r="3" fill="url(#sig-pink)" opacity="0.5" />
    </svg>
  );
}

function Backdrop() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 -z-10"
      style={{
        background:
          "radial-gradient(1200px 600px at 15% -10%, rgba(86,224,255,0.10), transparent 60%)," +
          "radial-gradient(900px 500px at 110% 10%, rgba(255,122,219,0.10), transparent 60%)," +
          "radial-gradient(1400px 800px at 50% 110%, rgba(102,79,255,0.08), transparent 70%)," +
          "linear-gradient(180deg,#04050b 0%, #06081a 50%, #04050b 100%)",
      }}
    />
  );
}

function Footer() {
  return (
    <footer className="relative px-8 pb-6 pt-1 text-[10px] tracking-[0.32em] uppercase text-white/25 text-center">
      fsaverage5 pial surface  ·  fitzhugh nagumo  ·  cotangent laplacian
    </footer>
  );
}
