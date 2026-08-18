import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';
import { COLORS, display, body } from '../theme';

export type Focus = { scale: number; x: number; y: number };

export const StepScene: React.FC<{
  step?: string;
  title: string;
  bullets: string[];
  image: string;
  focus?: Focus;
  accent?: string;
}> = ({ step, title, bullets, image, focus, accent = COLORS.accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 200 } });
  const panelX = interpolate(enter, [0, 1], [-60, 0]);
  const imgIn = spring({ frame: frame - 6, fps, config: { damping: 200 } });

  const baseScale = focus?.scale ?? 1;
  const drift = interpolate(frame, [0, 420], [0, 0.06], { extrapolateRight: 'clamp' });
  const scale = (baseScale + drift) * interpolate(imgIn, [0, 1], [0.96, 1]);
  const tx = focus ? -(focus.x - 50) * (baseScale - 1) : 0;
  const ty = focus ? -(focus.y - 50) * (baseScale - 1) : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(1100px 700px at 12% 15%, ${accent}22, transparent 60%), radial-gradient(900px 700px at 95% 90%, #0EA5E918, transparent 65%)`,
        }}
      />
      {/* left panel */}
      <div
        style={{
          position: 'absolute',
          left: 96,
          top: 190,
          width: 520,
          transform: `translateX(${panelX}px)`,
          opacity: enter,
        }}
      >
        {step ? (
          <div
            style={{
              ...body,
              display: 'inline-block',
              color: accent,
              border: `1px solid ${accent}55`,
              background: `${accent}14`,
              padding: '8px 18px',
              borderRadius: 999,
              fontSize: 22,
              letterSpacing: 2,
              fontWeight: 700,
              marginBottom: 28,
            }}
          >
            {step}
          </div>
        ) : null}
        <div style={{ ...display, color: COLORS.text, fontSize: 62, lineHeight: 1.05, fontWeight: 700 }}>
          {title}
        </div>
        <div style={{ height: 6, width: 84, background: accent, borderRadius: 4, margin: '30px 0 34px' }} />
        {bullets.map((b, i) => {
          const bIn = spring({ frame: frame - 14 - i * 8, fps, config: { damping: 200 } });
          return (
            <div
              key={b}
              style={{
                ...body,
                display: 'flex',
                gap: 16,
                color: COLORS.muted,
                fontSize: 27,
                lineHeight: 1.45,
                marginBottom: 18,
                opacity: bIn,
                transform: `translateY(${interpolate(bIn, [0, 1], [16, 0])}px)`,
              }}
            >
              <span style={{ color: accent, fontWeight: 800 }}>•</span>
              <span>{b}</span>
            </div>
          );
        })}
      </div>

      {/* screenshot */}
      <div
        style={{
          position: 'absolute',
          left: 690,
          top: 132,
          width: 1130,
          height: 816,
          borderRadius: 26,
          overflow: 'hidden',
          border: `1px solid ${COLORS.line}`,
          boxShadow: '0 50px 120px rgba(0,0,0,0.55)',
          opacity: imgIn,
          background: '#0F172A',
        }}
      >
        <Img
          src={staticFile(`images/${image}`)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: focus ? `${focus.x}% ${focus.y}%` : 'top center',
            transform: `scale(${scale}) translate(${tx * 0.5}%, ${ty * 0.5}%)`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
