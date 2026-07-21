type Tier = 10 | 50 | 100;

type Palette = {
  bg0: string; bg1: string; bg2: string;
  ring: string; accent: string; glow: string;
  metalHi: string; metalMid: string; metalLo: string;
  label: string;
};

const CONF: Record<Tier, Palette> = {
  10: {
    bg0: "#062018", bg1: "#0b3b2e", bg2: "#031510",
    ring: "#34d399", accent: "#a7f3d0", glow: "#10b981",
    metalHi: "#d1fae5", metalMid: "#34d399", metalLo: "#065f46",
    label: "PICKAXE",
  },
  50: {
    bg0: "#0b1220", bg1: "#1e293b", bg2: "#050914",
    ring: "#60a5fa", accent: "#dbeafe", glow: "#3b82f6",
    metalHi: "#e0e7ff", metalMid: "#818cf8", metalLo: "#312e81",
    label: "RIG",
  },
  100: {
    bg0: "#1a0b2e", bg1: "#4c1d95", bg2: "#0a0418",
    ring: "#e879f9", accent: "#fde68a", glow: "#a855f7",
    metalHi: "#fef3c7", metalMid: "#f0abfc", metalLo: "#581c87",
    label: "ASIC",
  },
};

export function MinerNftArt({ tier, size = 128 }: { tier: Tier; size?: number }) {
  const c = CONF[tier];
  const id = `mn-${tier}`;
  return (
    <svg
      viewBox="0 0 240 240"
      width={size}
      height={size}
      className="block"
      role="img"
      aria-label={`Miner NFT tier ${tier}`}
    >
      <defs>
        {/* card background */}
        <radialGradient id={`${id}-bg`} cx="50%" cy="30%" r="85%">
          <stop offset="0%" stopColor={c.bg1} />
          <stop offset="55%" stopColor={c.bg0} />
          <stop offset="100%" stopColor={c.bg2} />
        </radialGradient>
        {/* metal shading */}
        <linearGradient id={`${id}-metal`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={c.metalHi} />
          <stop offset="45%" stopColor={c.metalMid} />
          <stop offset="100%" stopColor={c.metalLo} />
        </linearGradient>
        <linearGradient id={`${id}-metal-side`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor={c.metalMid} />
          <stop offset="100%" stopColor={c.metalLo} />
        </linearGradient>
        <linearGradient id={`${id}-metal-top`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor={c.metalHi} />
          <stop offset="100%" stopColor={c.metalMid} />
        </linearGradient>
        {/* screen glow */}
        <radialGradient id={`${id}-screen`} cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor={c.accent} stopOpacity="0.95" />
          <stop offset="100%" stopColor={c.glow} stopOpacity="0.4" />
        </radialGradient>
        {/* soft glow */}
        <filter id={`${id}-glow`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id={`${id}-blur`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
        {/* holo sweep */}
        <linearGradient id={`${id}-holo`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0" />
          <stop offset="50%" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* frame */}
      <rect x="4" y="4" width="232" height="232" rx="26" fill={`url(#${id}-bg)`} />
      {/* subtle isometric floor grid */}
      <g stroke={c.ring} strokeOpacity="0.09" strokeWidth="1">
        {Array.from({ length: 9 }).map((_, i) => {
          const y = 60 + i * 20;
          return <line key={`h${i}`} x1="10" y1={y} x2="230" y2={y} />;
        })}
        {Array.from({ length: 9 }).map((_, i) => {
          const x = 20 + i * 25;
          return <line key={`v${i}`} x1={x} y1="10" x2={x} y2="230" />;
        })}
      </g>
      {/* vignette border */}
      <rect x="4" y="4" width="232" height="232" rx="26" fill="none" stroke={c.ring} strokeOpacity="0.55" strokeWidth="1.5" />
      <rect x="8" y="8" width="224" height="224" rx="22" fill="none" stroke="#fff" strokeOpacity="0.05" />

      {/* chip label */}
      <g>
        <rect x="16" y="16" width="58" height="20" rx="10" fill="#000" fillOpacity="0.45" stroke={c.ring} strokeOpacity="0.55" />
        <circle cx="26" cy="26" r="3" fill={c.glow}>
          <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
        </circle>
        <text x="46" y="30" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="10" fill={c.accent} letterSpacing="1.5">
          T{tier}
        </text>
      </g>
      <text x="224" y="30" textAnchor="end" fontFamily="ui-monospace, monospace" fontSize="9" fill={c.accent} opacity="0.75" letterSpacing="2.5">
        {c.label}
      </text>

      {/* pedestal shadow */}
      <ellipse cx="120" cy="196" rx="72" ry="10" fill="#000" opacity="0.45" />
      {/* halo */}
      <circle cx="120" cy="120" r="64" fill={c.glow} opacity="0.28" filter={`url(#${id}-glow)`} />

      {tier === 10 && <Pickaxe id={id} c={c} />}
      {tier === 50 && <Rig id={id} c={c} />}
      {tier === 100 && <Asic id={id} c={c} />}

      {/* holographic sweep */}
      <rect x="4" y="4" width="232" height="232" rx="26" fill={`url(#${id}-holo)`} opacity="0.5" />

      {/* footer bar */}
      <rect x="26" y="208" width="188" height="14" rx="7" fill="#000" fillOpacity="0.5" stroke={c.ring} strokeOpacity="0.4" />
      <rect
        x="30"
        y="212"
        width={tier === 10 ? 50 : tier === 50 ? 118 : 180}
        height="6"
        rx="3"
        fill={`url(#${id}-metal)`}
      />
      <text x="120" y="204" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="8" fill={c.accent} opacity="0.8" letterSpacing="2.5">
        HASHRATE
      </text>
    </svg>
  );
}

/* ============================================================
   TIER 10 — Isometric Pickaxe on stone block
   ============================================================ */
function Pickaxe({ id, c }: { id: string; c: Palette }) {
  return (
    <g>
      {/* stone pedestal (isometric block) */}
      <g>
        {/* top */}
        <polygon points="80,168 120,150 160,168 120,186" fill="#1f2937" stroke={c.ring} strokeOpacity="0.4" />
        {/* left face */}
        <polygon points="80,168 120,186 120,204 80,186" fill="#0f172a" stroke={c.ring} strokeOpacity="0.3" />
        {/* right face */}
        <polygon points="160,168 120,186 120,204 160,186" fill="#111827" stroke={c.ring} strokeOpacity="0.3" />
        {/* embedded gem in stone */}
        <polygon points="120,172 128,178 120,184 112,178" fill={c.accent} opacity="0.6" />
      </g>

      {/* handle with wood grain */}
      <g transform="rotate(-18 120 120)">
        <rect x="114" y="60" width="14" height="110" rx="5" fill="#5b3a1e" stroke="#2b1a0d" strokeWidth="1" />
        <rect x="116" y="62" width="3" height="106" rx="1" fill="#8b5a2b" opacity="0.7" />
        <rect x="122" y="64" width="2" height="102" rx="1" fill="#3d260f" opacity="0.6" />
        {/* grip wrap */}
        <g fill="#1f2937" opacity="0.85">
          <rect x="112" y="140" width="18" height="4" rx="2" />
          <rect x="112" y="148" width="18" height="4" rx="2" />
          <rect x="112" y="156" width="18" height="4" rx="2" />
        </g>
      </g>

      {/* pick head — beveled metal */}
      <g transform="rotate(-18 120 120)">
        {/* back plane */}
        <path
          d="M50 62 Q120 26 190 62 L182 76 Q120 46 58 76 Z"
          fill={c.metalLo}
        />
        {/* front bevel */}
        <path
          d="M56 60 Q120 30 184 60 L176 72 Q120 44 64 72 Z"
          fill={`url(#${id}-metal)`}
          stroke={c.ring}
          strokeWidth="1.2"
        />
        {/* specular highlight */}
        <path d="M70 54 Q120 36 170 54 L166 60 Q120 42 74 60 Z" fill="#fff" opacity="0.35" />
        {/* rivet */}
        <circle cx="120" cy="60" r="4" fill={c.metalLo} stroke={c.metalHi} strokeWidth="1" />
        <circle cx="120" cy="60" r="1.5" fill={c.accent} />
      </g>

      {/* floating gem crystal */}
      <g transform="translate(174 92)">
        <polygon points="0,-14 12,-4 8,12 -8,12 -12,-4" fill={c.metalLo} />
        <polygon points="0,-14 12,-4 8,12 -8,12 -12,-4" fill={`url(#${id}-metal)`} opacity="0.9" />
        <polygon points="0,-14 -12,-4 -8,12" fill="#000" opacity="0.25" />
        <polygon points="0,-14 12,-4 0,-4" fill="#fff" opacity="0.5" />
        <circle r="18" fill={c.glow} opacity="0.35" filter={`url(#${id}-glow)`} />
      </g>

      {/* particles */}
      {[
        [60, 60, 1.8],
        [200, 70, 1.3],
        [50, 130, 1.5],
        [190, 150, 1.2],
        [90, 40, 1],
      ].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill={c.accent}>
          <animate attributeName="opacity" values="0.3;1;0.3" dur={`${2 + i * 0.4}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </g>
  );
}

/* ============================================================
   TIER 50 — Isometric GPU Mining Rig
   ============================================================ */
function Rig({ id, c }: { id: string; c: Palette }) {
  return (
    <g>
      {/* isometric platform */}
      <g>
        <polygon points="60,170 120,142 180,170 120,198" fill="#0b1220" stroke={c.ring} strokeOpacity="0.5" />
        <polygon points="60,170 120,198 120,206 60,178" fill="#050914" stroke={c.ring} strokeOpacity="0.3" />
        <polygon points="180,170 120,198 120,206 180,178" fill="#0a0f1f" stroke={c.ring} strokeOpacity="0.3" />
      </g>

      {/* rack frame — 3D box */}
      {/* right side face */}
      <polygon points="168,80 168,158 138,174 138,96" fill={c.metalLo} stroke={c.ring} strokeWidth="1" />
      {/* top face */}
      <polygon points="72,80 168,80 138,96 42,96" fill={`url(#${id}-metal-top)`} stroke={c.ring} strokeWidth="1" />
      {/* front face */}
      <polygon points="42,96 138,96 138,174 42,158" fill="#0a0f1a" stroke={c.ring} strokeWidth="1.4" />

      {/* GPU cards stacked (front face) */}
      {[0, 1, 2].map((i) => {
        const y = 104 + i * 22;
        return (
          <g key={i}>
            {/* card body */}
            <polygon
              points={`50,${y} 130,${y} 130,${y + 16} 50,${y + 16}`}
              fill={`url(#${id}-metal)`}
              stroke={c.ring}
              strokeOpacity="0.7"
            />
            {/* fan */}
            <circle cx={64} cy={y + 8} r="5.5" fill="#050914" stroke={c.accent} strokeOpacity="0.7" />
            <g stroke={c.accent} strokeWidth="1" opacity="0.9" transform={`translate(64 ${y + 8})`}>
              <path d="M0 -4 Q3 -1 0 0 Q-3 1 0 4" />
              <path d="M-4 0 Q-1 -3 0 0 Q1 3 4 0" />
            </g>
            <circle cx={64} cy={y + 8} r="1.5" fill={c.ring} />
            {/* second fan */}
            <circle cx={84} cy={y + 8} r="5.5" fill="#050914" stroke={c.accent} strokeOpacity="0.7" />
            <g stroke={c.accent} strokeWidth="1" opacity="0.9" transform={`translate(84 ${y + 8})`}>
              <path d="M0 -4 Q3 -1 0 0 Q-3 1 0 4" />
              <path d="M-4 0 Q-1 -3 0 0 Q1 3 4 0" />
            </g>
            <circle cx={84} cy={y + 8} r="1.5" fill={c.ring} />
            {/* LED strip */}
            <rect x="102" y={y + 4} width="22" height="2" rx="1" fill={c.accent}>
              <animate attributeName="opacity" values="0.4;1;0.4" dur={`${1.5 + i * 0.3}s`} repeatCount="indefinite" />
            </rect>
            <rect x="102" y={y + 9} width="16" height="2" rx="1" fill={c.ring} opacity="0.7" />
          </g>
        );
      })}

      {/* status LEDs on side */}
      <circle cx="150" cy="108" r="2" fill={c.accent}>
        <animate attributeName="opacity" values="1;0.2;1" dur="1.3s" repeatCount="indefinite" />
      </circle>
      <circle cx="150" cy="118" r="2" fill={c.ring} />
      <circle cx="150" cy="128" r="2" fill={c.glow} opacity="0.7" />

      {/* cable */}
      <path d="M42 158 Q30 176 46 190" fill="none" stroke={c.ring} strokeOpacity="0.6" strokeWidth="1.5" />

      {/* ambient particles */}
      {[[54, 74], [186, 90], [200, 160]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.5" fill={c.accent}>
          <animate attributeName="opacity" values="0.2;1;0.2" dur={`${2 + i * 0.5}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </g>
  );
}

/* ============================================================
   TIER 100 — Isometric ASIC with crown
   ============================================================ */
function Asic({ id, c }: { id: string; c: Palette }) {
  return (
    <g>
      {/* iso platform */}
      <g>
        <polygon points="52,178 120,146 188,178 120,210" fill="#150826" stroke={c.ring} strokeOpacity="0.5" />
        <polygon points="52,178 120,210 120,218 52,186" fill="#0a0418" stroke={c.ring} strokeOpacity="0.3" />
        <polygon points="188,178 120,210 120,218 188,186" fill="#100620" stroke={c.ring} strokeOpacity="0.3" />
      </g>

      {/* crown floating above */}
      <g transform="translate(0 -4)">
        <path
          d="M68 66 L84 42 L100 62 L120 36 L140 62 L156 42 L172 66 L172 76 L68 76 Z"
          fill={`url(#${id}-metal)`}
          stroke={c.ring}
          strokeWidth="1.4"
        />
        <path d="M68 66 L172 66 L172 76 L68 76 Z" fill="#000" opacity="0.15" />
        <circle cx="84" cy="42" r="3.5" fill={c.accent} />
        <circle cx="120" cy="36" r="4" fill={c.accent}>
          <animate attributeName="r" values="4;5;4" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="156" cy="42" r="3.5" fill={c.accent} />
        {/* gems in band */}
        <circle cx="94" cy="72" r="2" fill={c.glow} />
        <circle cx="120" cy="72" r="2.5" fill={c.accent} />
        <circle cx="146" cy="72" r="2" fill={c.glow} />
      </g>

      {/* ASIC body — 3D box */}
      {/* top face */}
      <polygon points="60,90 180,90 156,102 84,102" fill={`url(#${id}-metal-top)`} stroke={c.ring} strokeWidth="1" />
      {/* right face */}
      <polygon points="180,90 180,170 156,182 156,102" fill={`url(#${id}-metal-side)`} stroke={c.ring} strokeWidth="1" />
      {/* front face */}
      <polygon points="60,90 156,102 156,182 60,170" fill="#0a0715" stroke={c.ring} strokeWidth="1.4" />

      {/* twin fans */}
      {[
        { cx: 82, cy: 130 },
        { cx: 130, cy: 136 },
      ].map((f, idx) => (
        <g key={idx} transform={`translate(${f.cx} ${f.cy})`}>
          {/* fan housing */}
          <circle r="22" fill="#050206" stroke={c.ring} strokeOpacity="0.7" strokeWidth="1.2" />
          <circle r="22" fill={c.glow} opacity="0.12" />
          {/* fan blades */}
          <g stroke={c.accent} strokeWidth="2" strokeLinecap="round" opacity="0.95">
            <g>
              <path d="M0 -18 Q10 -8 0 0 Q-10 8 0 18" />
              <path d="M-18 0 Q-8 -10 0 0 Q8 10 18 0" />
              <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur={`${3 + idx}s`} repeatCount="indefinite" />
            </g>
          </g>
          {/* hub */}
          <circle r="4" fill={c.ring} />
          <circle r="1.5" fill={c.accent} />
        </g>
      ))}

      {/* core chip glow */}
      <g transform="translate(120 158)">
        <rect x="-14" y="-16" width="28" height="32" rx="4" fill={`url(#${id}-screen)`} opacity="0.5" filter={`url(#${id}-blur)`} />
        <rect x="-10" y="-12" width="20" height="24" rx="3" fill={c.ring} opacity="0.5" />
        <rect x="-7" y="-9" width="14" height="18" rx="2" fill={c.accent}>
          <animate attributeName="opacity" values="0.6;1;0.6" dur="1.8s" repeatCount="indefinite" />
        </rect>
        {/* chip pins */}
        <g stroke={c.metalHi} strokeWidth="1" opacity="0.7">
          <line x1="-14" y1="-8" x2="-18" y2="-8" />
          <line x1="-14" y1="0" x2="-18" y2="0" />
          <line x1="-14" y1="8" x2="-18" y2="8" />
          <line x1="14" y1="-8" x2="18" y2="-8" />
          <line x1="14" y1="0" x2="18" y2="0" />
          <line x1="14" y1="8" x2="18" y2="8" />
        </g>
      </g>

      {/* status LEDs */}
      <circle cx="70" cy="100" r="1.8" fill={c.accent}>
        <animate attributeName="opacity" values="1;0.2;1" dur="1s" repeatCount="indefinite" />
      </circle>
      <circle cx="146" cy="108" r="1.8" fill={c.glow}>
        <animate attributeName="opacity" values="0.3;1;0.3" dur="1.4s" repeatCount="indefinite" />
      </circle>

      {/* ambient sparks */}
      {[[50, 60], [190, 80], [200, 170], [40, 190]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.4" fill={c.accent}>
          <animate attributeName="opacity" values="0.2;1;0.2" dur={`${2 + i * 0.4}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </g>
  );
}
