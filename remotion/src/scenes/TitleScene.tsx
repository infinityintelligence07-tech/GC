import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, Img, staticFile } from 'remotion';
import { COLORS, display, body } from '../theme';

export const TitleScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame, fps, config: { damping: 200 } });
  const b2 = spring({ frame: frame - 12, fps, config: { damping: 200 } });
  const c = spring({ frame: frame - 24, fps, config: { damping: 18, stiffness: 120 } });

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <AbsoluteFill style={{ opacity: 0.14, filter: 'blur(2px)' }}>
        <Img
          src={staticFile('images/01_alunos.png')}
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${1.05 + frame * 0.0002})` }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `radial-gradient(1200px 800px at 20% 30%, ${COLORS.accent}33, transparent 60%), linear-gradient(120deg, #080D18 30%, #0B1426 100%)`,
          opacity: 0.94,
        }}
      />
      <div style={{ position: 'absolute', left: 130, top: 330, width: 1300 }}>
        <div
          style={{
            ...body,
            color: COLORS.warn,
            fontSize: 24,
            letterSpacing: 6,
            fontWeight: 700,
            opacity: a,
            transform: `translateY(${interpolate(a, [0, 1], [20, 0])}px)`,
          }}
        >
          IAM · GESTÃO DE CONTAS
        </div>
        <div
          style={{
            ...display,
            color: COLORS.text,
            fontSize: 104,
            fontWeight: 700,
            lineHeight: 1.02,
            marginTop: 26,
            opacity: b2,
            transform: `translateY(${interpolate(b2, [0, 1], [34, 0])}px)`,
          }}
        >
          Como subir um aluno
          <br />
          para cancelamento
        </div>
        <div
          style={{
            height: 6,
            width: interpolate(c, [0, 1], [0, 260]),
            background: COLORS.accent,
            borderRadius: 4,
            marginTop: 34,
          }}
        />
        <div
          style={{
            ...body,
            color: COLORS.muted,
            fontSize: 30,
            marginTop: 30,
            opacity: c,
          }}
        >
          Passo a passo para o Assessor de Conta — da carteira até a coluna Entrada
        </div>
      </div>
    </AbsoluteFill>
  );
};
