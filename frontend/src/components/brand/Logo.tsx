import { useId } from 'react'

/** GridRescue AI mark — a navy shield, gold lightning bolt and a live "pulse" line, ringed by sun / wind / water arcs. */
export function Logo({ size = 44, animated = true }: { size?: number; animated?: boolean }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ overflow: 'visible', display: 'block' }} aria-label="GridRescue AI">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F0CB72" /><stop offset="1" stopColor="#D4A056" />
        </linearGradient>
        <filter id={`${id}-glow`} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.2" /></filter>
      </defs>
      {/* resource arcs: sun (gold), wind (cyan), water (blue) */}
      <g fill="none" strokeWidth="2.4" strokeLinecap="round" opacity="0.9">
        <path d="M14 10 A28 28 0 0 1 50 10" stroke="#F0CB72">{animated && <animate attributeName="opacity" values="0.5;1;0.5" dur="3.2s" repeatCount="indefinite" />}</path>
        <path d="M6 30 A28 28 0 0 1 12 14" stroke="#22B7E8">{animated && <animate attributeName="opacity" values="1;0.5;1" dur="2.6s" repeatCount="indefinite" />}</path>
        <path d="M58 30 A28 28 0 0 0 52 14" stroke="#3A86E6">{animated && <animate attributeName="opacity" values="0.6;1;0.6" dur="2.9s" repeatCount="indefinite" />}</path>
      </g>
      <path d="M32 6 L52 13 V30 C52 43 43 52 32 58 C21 52 12 43 12 30 V13 Z" fill="#0B1A2E" stroke={`url(#${id}-g)`} strokeWidth="2.6" />
      <path d="M35 16 L23 34 H31.5 L28.5 50 L42 29 H33.5 Z" fill={`url(#${id}-g)`} filter={animated ? `url(#${id}-glow)` : undefined} opacity="0.55" />
      <path d="M35 16 L23 34 H31.5 L28.5 50 L42 29 H33.5 Z" fill={`url(#${id}-g)`} />
      <path d="M14 38 H21 L24 33 L28 43 L32 38 H50" fill="none" stroke="#4ADE80" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="60" strokeDashoffset="0">
        {animated && <animate attributeName="stroke-dashoffset" values="60;0;0;-60" keyTimes="0;0.4;0.7;1" dur="2.8s" repeatCount="indefinite" />}
      </path>
    </svg>
  )
}

export function Wordmark({ sub = 'ENERGY RESILIENCE ADVISOR' }: { sub?: string }) {
  return (
    <div className="gr-brand">
      <div className="gr-brand-line"><span style={{ color: '#fff' }}>Grid</span><span style={{ color: '#F0CB72' }}>Rescue</span><span style={{ color: '#4ADE80', fontWeight: 500 }}> AI</span></div>
      <div className="gr-brand-sub">{sub}</div>
    </div>
  )
}
