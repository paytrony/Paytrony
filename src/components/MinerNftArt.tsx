type Tier = 10 | 50 | 100;

const CONF: Record<Tier, {
  from: string; via: string; to: string; ring: string; accent: string; label: string;
}> = {
  10: { from: "#0b3b2e", via: "#0e5a44", to: "#052018", ring: "#34d399", accent: "#a7f3d0", label: "PICKAXE" },
  50: { from: "#1e293b", via: "#334155", to: "#0b1220", ring: "#60a5fa", accent: "#c7d2fe", label: "RIG" },
  100: { from: "#3b1d5a", via: "#6d28d9", to: "#1a0b2e", ring: "#f5d0fe", accent: "#fde68a", label: "ASIC" },
};

export function MinerNftArt({ tier, size = 128 }: { tier: Tier; size?: number }) {
  const c = CONF[tier];
  const id = `mn-${tier}`;
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className="block" role="img" aria-label={`Miner NFT tier ${tier}`}>
      <defs>
        <radialGradient id={`${id}-bg`} cx="50%" cy="35%" r="80%">
          <stop offset="0%" stopColor={c.via} />
          <stop offset="60%" stopColor={c.from} />
          <stop offset="100%" stopColor={c.to} />
        </radialGradient>
        <linearGradient id={`${id}-metal`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={c.accent} stopOpacity="0.95" />
          <stop offset="100%" stopColor={c.ring} stopOpacity="0.75" />
        </linearGradient>
        <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      {/* frame */}
      <rect x="4" y="4" width="192" height="192" rx="22" fill={`url(#${id}-bg)`} />
      <rect x="4" y="4" width="192" height="192" rx="22" fill="none" stroke={c.ring} strokeOpacity="0.55" strokeWidth="1.5" />

      {/* subtle grid */}
      <g stroke={c.ring} strokeOpacity="0.08">
        {[40, 80, 120, 160].map((v) => (
          <g key={v}>
            <line x1={v} y1="10" x2={v} y2="190" />
            <line x1="10" y1={v} x2="190" y2={v} />
          </g>
        ))}
      </g>

      {/* corner tier chip */}
      <g>
        <rect x="14" y="14" width="52" height="18" rx="9" fill="#000" fillOpacity="0.35" stroke={c.ring} strokeOpacity="0.5" />
        <text x="40" y="27" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="10" fill={c.accent} letterSpacing="1.5">
          T{tier}
        </text>
      </g>
      <text x="186" y="27" textAnchor="end" fontFamily="ui-monospace, monospace" fontSize="9" fill={c.accent} opacity="0.7" letterSpacing="2">
        {c.label}
      </text>

      {/* halo */}
      <circle cx="100" cy="108" r="52" fill={c.ring} opacity="0.18" filter={`url(#${id}-glow)`} />

      {tier === 10 && <Pickaxe metal={`url(#${id}-metal)`} ring={c.ring} accent={c.accent} />}
      {tier === 50 && <Rig metal={`url(#${id}-metal)`} ring={c.ring} accent={c.accent} />}
      {tier === 100 && <Asic metal={`url(#${id}-metal)`} ring={c.ring} accent={c.accent} />}

      {/* footer bar */}
      <rect x="20" y="170" width="160" height="14" rx="7" fill="#000" fillOpacity="0.35" />
      <rect x="24" y="174" width={tier === 10 ? 40 : tier === 50 ? 96 : 152} height="6" rx="3" fill={c.ring} />
      <text x="100" y="164" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="8" fill={c.accent} opacity="0.75" letterSpacing="2">
        HASHRATE
      </text>
    </svg>
  );
}

function Pickaxe({ metal, ring, accent }: { metal: string; ring: string; accent: string }) {
  return (
    <g>
      {/* handle */}
      <rect x="94" y="70" width="12" height="82" rx="4" fill="#3b2412" stroke={accent} strokeOpacity="0.4" />
      {/* pick head */}
      <path d="M40 76 Q100 40 160 76 L150 92 Q100 62 50 92 Z" fill={metal} stroke={ring} strokeWidth="1.2" />
      {/* gem */}
      <g transform="translate(100 138)">
        <polygon points="0,-16 14,0 0,18 -14,0" fill={accent} stroke={ring} strokeWidth="1.2" />
        <polygon points="0,-16 14,0 0,0" fill="#fff" fillOpacity="0.25" />
      </g>
      {/* sparks */}
      <circle cx="60" cy="60" r="1.8" fill={accent} />
      <circle cx="140" cy="58" r="1.4" fill={accent} />
      <circle cx="150" cy="140" r="1.6" fill={accent} />
    </g>
  );
}

function Rig({ metal, ring, accent }: { metal: string; ring: string; accent: string }) {
  return (
    <g>
      {/* chassis */}
      <rect x="46" y="72" width="108" height="70" rx="6" fill="#0a0f1a" stroke={ring} strokeWidth="1.4" />
      {/* GPUs */}
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${54 + i * 32} 82)`}>
          <rect width="26" height="50" rx="3" fill={metal} stroke={ring} strokeOpacity="0.7" />
          <circle cx="13" cy="17" r="7" fill="#0a0f1a" stroke={accent} strokeOpacity="0.7" />
          <circle cx="13" cy="17" r="3" fill={accent} />
          <rect x="4" y="34" width="18" height="3" rx="1.5" fill={accent} opacity="0.7" />
          <rect x="4" y="40" width="12" height="2" rx="1" fill={accent} opacity="0.5" />
        </g>
      ))}
      {/* rack feet */}
      <rect x="50" y="146" width="14" height="8" rx="2" fill={metal} />
      <rect x="136" y="146" width="14" height="8" rx="2" fill={metal} />
      {/* activity LEDs */}
      <circle cx="150" cy="80" r="2" fill={accent} />
      <circle cx="150" cy="88" r="2" fill={ring} />
    </g>
  );
}

function Asic({ metal, ring, accent }: { metal: string; ring: string; accent: string }) {
  return (
    <g>
      {/* crown */}
      <path d="M60 66 L74 44 L88 62 L100 40 L112 62 L126 44 L140 66 Z" fill={metal} stroke={ring} strokeWidth="1.4" />
      <circle cx="74" cy="44" r="3" fill={accent} />
      <circle cx="100" cy="40" r="3.5" fill={accent} />
      <circle cx="126" cy="44" r="3" fill={accent} />
      {/* ASIC body */}
      <rect x="52" y="70" width="96" height="78" rx="8" fill="#0a0715" stroke={ring} strokeWidth="1.4" />
      {/* twin fans */}
      {[72, 128].map((cx) => (
        <g key={cx} transform={`translate(${cx} 112)`}>
          <circle r="22" fill="#0a0715" stroke={accent} strokeOpacity="0.6" />
          <g stroke={accent} strokeWidth="2" strokeLinecap="round" opacity="0.9">
            <path d="M0 -16 Q8 -6 0 0 Q-8 6 0 16" />
            <path d="M-16 0 Q-6 -8 0 0 Q6 8 16 0" />
          </g>
          <circle r="3.5" fill={ring} />
        </g>
      ))}
      {/* core glow */}
      <rect x="90" y="94" width="20" height="36" rx="3" fill={ring} opacity="0.35" />
      <rect x="94" y="98" width="12" height="28" rx="2" fill={accent} />
    </g>
  );
}
