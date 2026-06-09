# Sistema de leitura e correção de gabaritos escaneados

Este projeto lê gabaritos de prova em lote a partir de PDF, imagens ou uma pasta com arquivos, identifica as bolhas marcadas e corrige a prova usando um gabarito cadastrado em JSON.

## Ideia do algoritmo

O modelo analisado tem quatro quadrados pretos nos cantos da folha, QR code, blocos de alternativas A-E e guias pretos laterais/inferiores nos blocos de respostas. O sistema usa esses elementos para:

1. Renderizar PDF em imagem.
2. Detectar os quadrados pretos dos cantos.
3. Corrigir rotação, perspectiva e leve distorção com homografia.
4. Detectar os blocos de respostas pelos quadradinhos-guia impressos.
5. Medir o preenchimento no centro de cada bolha.
6. Comparar com o gabarito e gerar CSV/Excel.

Esse método evita depender de OCR para as respostas e é mais estável quando o scan está levemente torto, rotacionado, com sombras ou pequenas deformações.

## Instalação

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/Mac
source .venv/bin/activate

pip install -r requirements.txt
```

## Uso pela linha de comando

```bash
python omr_corrector.py "HUMANAS 2º MA PROVA A.pdf" --config config.example.json --out resultados --debug
```

Saídas geradas:

- `resumo_notas.csv`: nota total e por matéria.
- `leituras_questoes.csv`: alternativa lida, status e confiança por questão.
- `resultado_gabaritos.xlsx`: Excel com as duas abas.
- `debug/*.jpg`: imagem com marcações sobre as bolhas, útil para conferência.

## Uso com interface simples

```bash
streamlit run app_streamlit.py
```

Na interface é possível colar o gabarito em sequência, por exemplo:

```text
ABCDEABCDEABCDE...
```

ou no formato:

```text
1:A,2:B,3:C,4:D,5:E
```

## Cadastro de matérias

No JSON, cadastre intervalos assim:

```json
"subjects": [
  {"name": "História", "start": 1, "end": 20},
  {"name": "Geografia", "start": 21, "end": 40},
  {"name": "Filosofia/Sociologia", "start": 41, "end": 60}
]
```

## Ajustes importantes

No arquivo `config.example.json`, os parâmetros principais são:

```json
"reading": {
  "min_fill": 0.42,
  "min_margin": 0.10,
  "allow_multiple": false
}
```

- Aumente `min_fill` se o sistema estiver considerando bolhas vazias como marcadas.
- Diminua `min_fill` se ele estiver deixando de reconhecer marcações fracas.
- Aumente `min_margin` se quiser ser mais rigoroso quando duas bolhas parecem marcadas.

## Limitações

- O nome do aluno não é lido por OCR nesta versão. O identificador usado é o QR code, quando ele for decodificado; se não for, usa `nome_do_arquivo_página`.
- Caso o modelo do gabarito mude muito, o método de detecção de layout deve ser recalibrado.
- Questões rasuradas, duas marcações ou marcações muito fracas aparecem com status `multiple`, `blank` ou `low_confidence` para revisão.
