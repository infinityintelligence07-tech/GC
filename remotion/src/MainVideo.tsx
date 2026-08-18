import React from 'react';
import { AbsoluteFill, Audio, staticFile, Sequence } from 'remotion';
import { TitleScene } from './scenes/TitleScene';
import { StepScene } from './scenes/StepScene';
import { COLORS, body } from './theme';

const F = (s: number) => Math.round(s * 30);

// Narration cue points (seconds)
const CUES = [0, 7.66, 19.42, 31.69, 49.36, 65.61, 78.07, 90.29, 111.3];
export const TOTAL_FRAMES = F(CUES[8]);

const seg = (i: number) => ({ from: F(CUES[i]), durationInFrames: F(CUES[i + 1]) - F(CUES[i]) });

export const MainVideo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <Audio src={staticFile('audio/narracao.mp3')} />

      <Sequence {...seg(0)}>
        <TitleScene />
      </Sequence>

      <Sequence {...seg(1)}>
        <StepScene
          step="PASSO 1"
          title="Abra a aba Alunos"
          bullets={[
            'No menu lateral, clique em “Alunos”.',
            'Use a busca ou os filtros de assessor, status e tags.',
            'Localize o aluno da sua carteira.',
          ]}
          image="01_alunos.png"
        />
      </Sequence>

      <Sequence {...seg(2)}>
        <StepScene
          step="PASSO 2"
          title="Solicitar Cancelamento"
          bullets={[
            'Na coluna “Ações”, clique no ícone vermelho de X.',
            'O sistema pergunta o que você deseja fazer.',
            'Escolha “Solicitar Cancelamento”.',
          ]}
          image="02_escolha.png"
          accent={COLORS.warn}
        />
      </Sequence>

      <Sequence {...seg(3)}>
        <StepScene
          step="PASSO 3"
          title="Preencha o formulário"
          bullets={[
            'Motivo do cancelamento (e descrição, se houver).',
            'Total pago até o momento (Kamino).',
            'Quantidade de inscrições do contrato.',
            'Data da 1ª solicitação do aluno no chat.',
          ]}
          image="04_form_preenchido.png"
          focus={{ scale: 1.25, x: 50, y: 30 }}
          accent={COLORS.warn}
        />
      </Sequence>

      <Sequence {...seg(4)}>
        <StepScene
          title="Atenção à divergência"
          bullets={[
            'O total pago deve bater com Entrada + parcelas pagas.',
            'Se divergir, o sistema abre o ajuste do contrato.',
            'O caso segue com tag para double-check da Conciliação.',
          ]}
          image="04_form_preenchido.png"
          focus={{ scale: 1.7, x: 50, y: 40 }}
          accent="#F43F5E"
        />
      </Sequence>

      <Sequence {...seg(5)}>
        <StepScene
          step="PASSO 4"
          title="Perguntas legais e multa"
          bullets={[
            'Está dentro dos 7 dias de contrato? (CDC art. 49)',
            'Pediu com mais de 30 dias de antecedência?',
            'A multa é calculada automaticamente.',
          ]}
          image="04_form_preenchido.png"
          focus={{ scale: 1.5, x: 50, y: 82 }}
          accent={COLORS.ok}
        />
      </Sequence>

      <Sequence {...seg(6)}>
        <StepScene
          step="PASSO 5"
          title="Confirmar e ajustar parcelas"
          bullets={[
            'Clique em “Confirmar e Ajustar Parcelas”.',
            'O aluno permanece na sua carteira.',
            'O status “Solicitação Cancelamento” sobrepõe os demais.',
          ]}
          image="05_form_multa.png"
          accent={COLORS.accent}
        />
      </Sequence>

      <Sequence {...seg(7)}>
        <StepScene
          title="O caso chega em Entrada"
          bullets={[
            'Aba Cancelamentos → coluna “Entrada”.',
            'Card com aluno, AC responsável e data solicitada.',
            'O time de cancelamentos assume a tratativa.',
            'Pode ser revertido a qualquer momento.',
          ]}
          image="07_kanban_scroll1.png"
          focus={{ scale: 1.15, x: 20, y: 45 }}
          accent={COLORS.ok}
        />
      </Sequence>

      {/* rodapé fixo */}
      <div
        style={{
          ...body,
          position: 'absolute',
          left: 96,
          bottom: 54,
          color: '#64748B',
          fontSize: 20,
          letterSpacing: 3,
        }}
      >
        SISTEMA IAM · TREINAMENTO INTERNO
      </div>
    </AbsoluteFill>
  );
};
