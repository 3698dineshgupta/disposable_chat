'use client';

import Image from 'next/image';

interface AvatarProps {
  src?: string | null;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  isOnline?: boolean;
  hasStatus?: boolean;
  className?: string;
}

const PX: Record<string, number> = { xs: 28, sm: 36, md: 44, lg: 56, xl: 80 };

const DOT: Record<string, number> = { xs: 8, sm: 10, md: 12, lg: 14, xl: 16 };

const BG_COLORS = [
  '#d4a5a5', '#d4b5a5', '#c9b99a', '#a5c4a5',
  '#a5bdc4', '#a5a5c4', '#b5a5c4', '#c4a5b5',
  '#c4a5a5', '#a8c4a8', '#a5b8c4', '#c4b8a5',
];

function colorFromName(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return BG_COLORS[Math.abs(h) % BG_COLORS.length];
}

function PersonSVG({ size }: { size: number }) {
  const headR  = size * 0.22;
  const headCy = size * 0.36;
  const cx     = size / 2;
  const bodyR  = size * 0.32;
  const bodyCy = size * 0.90;
  return (
    <svg
      width={size} height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none" aria-hidden
      style={{ display: 'block', flexShrink: 0 }}
    >
      <circle cx={cx} cy={headCy} r={headR} fill="rgba(255,255,255,0.92)" />
      <circle cx={cx} cy={bodyCy} r={bodyR} fill="rgba(255,255,255,0.92)" />
    </svg>
  );
}

export default function Avatar({
  src, name = '', size = 'md', isOnline, hasStatus, className,
}: AvatarProps) {
  const px  = PX[size] ?? 44;
  const dot = DOT[size] ?? 12;
  const bg  = colorFromName(name || '?');

  const circleStyle: React.CSSProperties = {
    width: px, height: px,
    borderRadius: '50%',
    overflow: 'hidden',
    flexShrink: 0,
    position: 'relative',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    background: src ? undefined : bg,
  };

  return (
    <div style={{ position: 'relative', flexShrink: 0, display: 'inline-flex' }} className={className}>
      <div style={circleStyle}>
        {src ? (
          <Image
            src={src}
            alt={name || 'avatar'}
            width={px}
            height={px}
            style={{
              width: px,
              height: px,
              objectFit: 'cover',
              display: 'block',
              flexShrink: 0,
            }}
            unoptimized
          />
        ) : (
          <PersonSVG size={px} />
        )}
      </div>

      {/* Status ring (stories) */}
      {hasStatus && (
        <div style={{
          position: 'absolute',
          inset: -2,
          borderRadius: '50%',
          border: '2px solid transparent',
          background: 'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888) border-box',
          WebkitMask: 'linear-gradient(#fff 0 0) padding-box,linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          opacity: 0.85,
          pointerEvents: 'none',
        }} />
      )}

      {/* Online dot */}
      {isOnline !== undefined && (
        <div style={{
          position: 'absolute',
          bottom: 0, right: 0,
          width: dot, height: dot,
          borderRadius: '50%',
          border: '2px solid white',
          background: isOnline ? '#22c55e' : '#9ca3af',
          flexShrink: 0,
        }} />
      )}
    </div>
  );
}
