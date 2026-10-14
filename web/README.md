# Gabarito Web — V1

Nova versão web/mobile do corretor OMR do repositório `gabarito_omr_system`.

## O que já funciona nesta V1

- cadastro local de provas de 1 a 60 questões, A–D ou A–E;
- gabarito correto e nota máxima configuráveis;
- dois modos: cartão geral ou cartão individual por aluno/turma;
- cadastro rápido de turma por lista de nomes;
- geração de cartões PDF com quatro fiduciais e QR de identificação;
- captura por câmera do celular ou upload de imagem;
- OMR no navegador: marcadores → homografia → leitura das bolhas;
- compensação local para pequena distorção residual de lente;
- estados: marcada, em branco, dupla marcação e revisão;
- rasuras/leituras ambíguas exigem confirmação humana;
- overlay visual de conferência;
- fluxo de turma: salvar e abrir câmera para o próximo;
- tabela de resultados e exportação CSV;
- modo local via `localStorage`, sem backend obrigatório para validar o produto.

## Validação sintética

`validation/synthetic_omr.py` cria cartões com respostas conhecidas e aplica:

- rotação de até ~4,5°;
- perspectiva;
- distorção radial de lente;
- blur, ruído e gradiente de iluminação;
- respostas normais, em branco, duplas e rasuras;
- distrator semelhante a QR próximo ao marcador superior direito.

Bateria inicial: **50 imagens / 2.000 questões**.

- localização dos quatro fiduciais: **100%**;
- marcações normais corrigidas automaticamente: **~99,1%**;
- acurácia do estado global (inclui blank/double/rasura): **97,35%**;
- casos limítrofes são intencionalmente enviados para revisão.

Execute:

```bash
python -m pip install -r validation/requirements.txt
OMR_CASES=50 python validation/synthetic_omr.py
```

## Desenvolvimento

Requer Node.js >= 20.9.

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000`.

## Arquitetura

- Next.js 16 / React 19 / TypeScript;
- processamento OMR no cliente (Canvas), evitando round-trip por foto;
- PDF no cliente com `pdf-lib`;
- QR com `qrcode` e leitura com ZXing;
- `supabase/schema.sql` contém o blueprint do banco com RLS para a próxima etapa.

### Por que o OMR roda no navegador?

No fluxo `foto → corrigir → próximo`, latência importa mais do que processamento pesado de servidor. O navegador já possui a imagem; usar Canvas evita upload obrigatório e reduz custo/tempo. O backend ficará responsável por persistência, autenticação e sincronização.

## Próxima etapa

1. conectar Supabase/Auth/Storage e substituir o repositório local pela camada remota;
2. rodar testes com fotos reais em celulares diferentes;
3. calibrar as zonas de revisão usando os falsos positivos reais;
4. criar preview no Vercel e testar PWA/câmera em Android/iOS;
5. após validação, abrir PR da branch web para `main`.

> Observação de segurança (14/10/2026): antes do primeiro deploy público, revisar o patch de segurança do Next.js anunciado para esta data e atualizar a versão fixada assim que a versão corrigida for publicada.
