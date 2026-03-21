# Reuniao de PMs: Funcionalidades Aprovadas para Clui CC

## Metodologia
5 agentes PM com perspetivas diferentes debateram independentemente:
- PM1: Produtividade & Velocidade
- PM2: Qualidade & Confianca
- PM3: Workflow do Developer
- PM4: UX & Delight
- PM5: Power User & Escala

## Consenso: As features mencionadas por 3+ PMs sao as vencedoras

---

## TIER S — Consenso Unanime (todos os PMs concordam)

### 1. Smart Context Pruning / Token Optimizer
> "Minimizar tokens sem baixar qualidade"

**O que faz:** Sistema inteligente que analisa a conversa e remove/comprime conteudo morto antes de enviar o proximo prompt:
- File reads que foram seguidos de writes (o read e redundante — evictar)
- Loops de correcao (user diz nao, Claude corrige) comprimidos ao resultado final
- Sub-tasks completas resumidas numa linha em vez da troca inteira
- Tool outputs antigos que ja nao sao relevantes
- Quando um ficheiro e re-lido, enviar apenas o diff desde a ultima leitura

**Problema real:** Numa sessao de 200 mensagens, 60-70% do contexto e "peso morto" — reads antigos, tentativas falhadas, planning ultrapassado. Claude processa tudo igualmente, diluindo a atencao. As sessoes longas degradam nao porque Claude piorou, mas porque o sinal se perdeu no ruido.

**Impacto:** Sessoes 2-3x mais longas com a mesma qualidade. Cada prompt e mais preciso.

**Complexidade:** Media-Alta | **Ficheiros:** `event-normalizer.ts`, `sessionStore.impl.ts`, `run-manager.ts`, novo `context-pruner.ts`

---

### 2. Context Bar / Token Budget Visualizer
> Barra visual segmentada mostrando consumo do context window

**O que faz:** Barra persistente acima do input com segmentos coloridos: system prompt, turns anteriores, tool outputs, headroom restante. Hover mostra tokens por categoria. Acima de 70%, pulsa e aparece "Summarize history" com um clique. Mostra exatamente ONDE os tokens estao a ser gastos.

**Problema real:** No CLI voas as cegas ate Claude comecar a degradar. So descobres que tinhas problema de contexto DEPOIS da qualidade cair.

**Impacto:** Consciencia imediata do estado da sessao. Decisoes informadas sobre quando resumir/comprimir.

**Complexidade:** Pequena | **Ficheiros:** `StatusBar.tsx`, `sessionStore.impl.ts`

---

## TIER A — Forte Consenso (3-4 PMs concordam)

### 3. Prompt Sharpener / Pre-Send Linting
> Analise local do prompt antes de enviar

**O que faz:** Heuristicas locais que detetam:
- Scope ambiguo ("fix this" sem referencia a ficheiro)
- Multiplas tasks num so prompt ("fix X and also Y and update Z")
- Pronomes vagos ("it", "this" — referindo-se a que?)
- Scope demasiado largo (diretorio inteiro quando so precisas de 4 ficheiros)
- Contradicoes com factos conhecidos do projeto

Mostra warnings inline suaves, nao bloqueantes. Podes ignorar e enviar na mesma.

**Problema real:** Prompts vagos -> Claude pede clarificacoes -> 3-4 round trips desperdicados -> 2 min mortos x 12 vezes/dia = 24 min/dia perdidos.

**Impacto:** Reduz round trips de clarificacao em 50%+. Cada prompt acerta a primeira.

**Complexidade:** Pequena-Media | **Ficheiros:** `InputBar.tsx`, novo `promptLinter.ts`

---

### 4. Session Resume Brief / "Where You Left Off"
> Resumo automatico ao reabrir sessao

**O que faz:** Quando retomas uma sessao (ou voltas a um tab apos 10+ min), mostra um cartao compacto:
- Ultima task em que Claude estava a trabalhar
- Ficheiros tocados (via git diff)
- Estado: completo / abandonado / meio
- Botao "Catch me up" que injeta prompt de re-orientacao automaticamente

**Problema real:** Voltas de almoco, tens 4 tabs, nao sabes onde estavas. Scrollas 5 minutos por mensagens ou re-explicas tudo a Claude gastando 200-500 tokens.

**Impacto:** Re-orientacao em 3 segundos em vez de 3 minutos.

**Complexidade:** Media | **Ficheiros:** `sessionStore.impl.ts`, `ConversationView.tsx`, `git-context.ts`

---

### 5. Session Fault Memory / "Never Ask Twice"
> Memoria persistente de correcoes por projeto

**O que faz:** Quando corriges Claude (editas output, rejeitas, dizes "nao, usa X em vez de Y"), a correcao e guardada como facto tipado no SQLite, scoped ao projeto. Em sessoes futuras, esses factos sao injetados como preamble compacto.

Exemplos de factos guardados:
- "Este projeto usa pnpm, nao npm"
- "Imports relativos, nao aliases"
- "Vitest, nao Jest"
- "Sempre usar async/await, nunca .then()"

**Problema real:** Sessao 1: "usamos vitest nao jest". Sessao 47: mesmo erro. Tu es a camada de correcao de erros que nao devia existir.

**Impacto:** Claude parece "aprender" as tuas preferencias. Elimina correcoes repetitivas.

**Complexidade:** Media | **Ficheiros:** `database-service.ts`, `control-plane.ts`, novo componente de gestao

---

### 6. File Change Interceptor / Diff Preview + Rollback
> Ver exatamente o que Claude vai mudar ANTES de aprovar

**O que faz:**
- Pre-execucao: Quando Claude propoe editar um ficheiro, mostra diff inline na conversa ANTES de aprovar a permissao (red/green hunks, line numbers)
- Pos-execucao: Snapshot dos ficheiros antes de cada run. Apos o run, pill compacto "4 files changed" com restore individual por ficheiro

**Problema real:** No CLI aprovas permissoes as cegas. "Write to auth.ts" — OK, mas o que e que vai escrever? So descobres depois. E se nao gostas, `git checkout` reverte TUDO.

**Impacto:** Confianca total nas alteracoes. Undo cirurgico por ficheiro.

**Complexidade:** Media | **Ficheiros:** `PermissionCard.tsx`, `diff.ts`, `DiffViewer.tsx`, `permission-server.ts`

---

### 7. Smart Prompt Templates com Slots
> Snippets com `[SLOT]` + Tab para avancar + `@file` picker

**O que faz:** Upgrade dos snippets existentes:
- `/fix [FILE] — [DESCRIPTION]` com cursor no primeiro slot, Tab avanca
- `@file` abre picker de ficheiros do repo (via git context)
- Variaveis de sistema: `{{git.branch}}`, `{{git.diff}}`, `{{clipboard}}`
- Formulario antes de enviar para slots complexos

**Problema real:** Escreves a mesma estrutura de prompt 20x/dia: "fix the bug in X, the issue is Y". Com templates, sao 3 keystrokes.

**Impacto:** Habit-forming. Cria muscle memory para prompts estruturados.

**Complexidade:** Pequena-Media | **Ficheiros:** `snippetStore.ts`, `InputBar.tsx`, `SlashCommandMenu.tsx`

---

## TIER B — Boas Adições (2 PMs concordam)

### 8. Smart Session Handoff / Checkpoint & Continue
> Quando contexto atinge 80%, gera handoff document e abre sessao nova

**O que faz:** Deteta proximidade do limite de contexto. Gera documento estruturado (goal, completed steps, open decisions, file states) de ~800-1500 tokens. Abre nova tab pre-loaded com esse contexto comprimido.

**Impacto:** Sessoes infinitas sem degradacao. Substitui 50k tokens por 1.5k tokens de contexto focado.

**Complexidade:** Media

---

### 9. Cross-Tab Deduplication / Radar
> Aviso quando outro tab ja trabalhou no mesmo tema

**O que faz:** Indice local de keywords por tab. Quando começas a escrever, mostra match suave: "Tab 1 trabalhou em auth middleware ha 23 min — ver resultado?"

**Impacto:** Elimina trabalho duplicado entre tabs.

**Complexidade:** Media

---

### 10. Tool Call Timeline
> Strip visual compacto de icones mostrando o que Claude fez

**O que faz:** Em vez de JSON colapsavel, strip horizontal de pills com icones Phosphor (FileText, Terminal, GitBranch) + duracao. Clique expande detalhes.

**Impacto:** Scan visual de 0.5s para perceber se Claude esta a fazer trabalho util ou a andar em circulos.

**Complexidade:** Pequena

---

### 11. Session Continuity Dot
> Ponto colorido no tab indicando frescura da sessao

**O que faz:** Verde = sessao ativa com contexto completo. Amarelo = >2h (contexto possivelmente stale). Vermelho = sessao nova sem contexto. Tooltip com tokens em contexto.

**Impacto:** Elimina o "porque e que o Claude esta a responder mal?" — era contexto stale.

**Complexidade:** Muito Pequena

---

## Roadmap Recomendado

**Sprint 1 — Foundation (Quick Wins):**
1. Context Bar / Token Visualizer (#2) — pequeno, alto impacto visual
2. Session Continuity Dot (#11) — muito pequeno, informacao critica
3. Tool Call Timeline (#10) — pequeno, melhora scan visual

**Sprint 2 — Daily Productivity:**
4. Prompt Sharpener (#3) — reduz round trips imediatamente
5. Smart Prompt Templates (#7) — habit-forming, extends existing snippets
6. Session Resume Brief (#4) — elimina re-orientacao

**Sprint 3 — Game Changers:**
7. Smart Context Pruning (#1) — THE feature. Sessoes mais longas e melhores
8. Session Fault Memory (#5) — Claude "aprende" as tuas preferencias
9. File Change Interceptor (#6) — confianca total

**Sprint 4 — Power User:**
10. Smart Session Handoff (#8) — sessoes infinitas
11. Cross-Tab Radar (#9) — elimina duplicacao
