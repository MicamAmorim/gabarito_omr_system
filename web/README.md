# Gabarito Web — V1

Versão web/mobile, simples e local-first, do corretor OMR do repositório `gabarito_omr_system`.

## Princípio do app

O app **não exige conta, login, banco de dados ou backend**. Provas, turmas e resultados ficam armazenados no próprio navegador/dispositivo do professor.

Isso mantém o uso simples, gratuito e acessível: o Vercel (ou qualquer hospedagem estática) serve apenas os arquivos do aplicativo; a correção e o armazenamento acontecem no dispositivo.

> Importante: os dados pertencem àquele navegador/dispositivo. Limpar os dados do site ou desinstalar o navegador pode apagar provas, turmas e resultados. Uma função de backup/importação pode ser adicionada depois sem criar contas de usuário.

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
- persistência local em `localStorage`;
- nenhuma imagem ou resultado precisa ser enviado a um servidor.

## Arquitetura

- Next.js 16 / React 19 / TypeScript;
- `output: "export"`: build 100% estática, sem Server Functions ou API routes;
- processamento OMR no cliente usando Canvas;
- PDF gerado no cliente com `pdf-lib`;
- QR gerado com `qrcode` e lido com ZXing;
- dados locais no navegador (`localStorage`).

### Por que o OMR roda no navegador?

No fluxo `foto → corrigir → próximo`, a imagem já está no celular. Processá-la localmente evita upload, reduz latência e custo e permite que o app funcione sem cadastro de usuário ou infraestrutura de banco.

## Desenvolvimento

Requer Node.js >= 20.9.

```bash
npm install
npm run build
npm run dev
```

Acesse `http://localhost:3000`.

A build gera arquivos estáticos em `out/`.

## Deploy no Vercel

Configure o projeto apontando para:

- repositório: `MicamAmorim/gabarito_omr_system`;
- branch de teste: `web-app-v1`;
- **Root Directory:** `web`;
- framework: Next.js;
- variáveis de ambiente: **nenhuma**.

O comando de build é `npm run build`. Como a configuração usa `output: "export"`, não há backend da aplicação em produção.

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

## Próximos testes

1. validar a build no Vercel;
2. imprimir cartões reais;
3. fotografar em celulares diferentes, com inclinação e iluminação variadas;
4. calibrar os limiares com falsos positivos/falsos negativos reais;
5. depois, adicionar backup/restauração local se necessário.
