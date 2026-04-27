eu uso supabase para o banco de dados
eu uso clerk para autenticação
eu nao irei focar em pregnancy and safety specific screen right not, it will be in essential oils
eu vou querer um painel especiico para a parte quimica pq é mto importante
eu vou querer um painel especifico para produtos e blends
eu vou querer um painel para receitas, completeness, review status (this also can have a kanban)
vou querer um painel para health concerns, action systems, and how to use, therapeutic properties


Those are the admin areas screens I want in my dashboard, and the frontend for user facing to use, digest will be on a second run.

Oh and on the essential oils panel, I want a section for safety, to set if the oil is safe for pregnancy, lactation, children, etc., diluttions, phototoxicity, application methods etc. (as I can see on the database it will create the relations to the oils)

• Li o que nao entra.md:1. Sim: isso muda bem a prioridade. O core não é “um dashboard genérico”; é um backoffice editorial/científico para alimentar e revisar a base de
  aromaterapia.

  Concordo com sua direção: primeiro frontend validável, depois API/mutations. Para esse tipo de ferramenta, se a gente ligar mutations cedo demais, vamos cristalizar fluxos
  errados. O primeiro objetivo deve ser validar telas, navegação, densidade de informação e fluxo mental do aromaterapeuta/especialista.

  Escopo Core
  As áreas admin que o documento define:

  1. Essential Oils
      - painel principal de cada óleo
      - inclui safety dentro do óleo, não como tela separada agora
      - safety: pregnancy, lactation, children, pets, dilution, phototoxicity, application methods
      - relações do óleo: concerns, properties, action systems, compounds, reports, products/blends
  2. Chemistry
      - painel próprio, porque é domínio crítico
      - compounds, ranges, source type, functional groups, carbon structures, therapeutic properties derived from compounds
  3. Products & Blends
      - produtos
      - blends
      - component oils
      - product types
      - color labels
      - resolved oils
  4. Recipes
      - completeness
      - review status
      - kanban faz sentido aqui
      - oils, drops, instructions, methods, health concern
  5. Health Knowledge
      - health concerns
      - action systems
      - how-to-use
      - therapeutic properties
  6. User-facing frontend
      - explicitamente segunda etapa
      - não deve entrar agora

  Como eu estruturaria o primeiro frontend
  Usando o starter next-shadcn-dashboard-starter, eu faria primeiro um frontend com dados mockados/fixtures derivados dos nomes reais das views/tabelas, sem mutation real:

  - Sidebar com essas 5 áreas principais.
  - Tabelas densas com filtros e search.
  - Detail pages/read models para validar layout.
  - Forms visuais em estado local, sem salvar.
  - Badges/status/review/completeness reais conceitualmente, mas ainda não persistidos.
  - “Save” pode abrir toast/modal fake: API not wired yet.

  Primeira sequência de telas
  Eu começaria por:

  1. Overview editorial
  2. Essential oils list + oil detail
  3. Chemistry list/detail
  4. Recipes list + kanban/review board
  5. Products/blends list/detail
  6. Health knowledge explorer

  Depois disso, quando o fluxo estiver aprovado, a gente desenha a API/mutation layer com segurança.

  Minha recomendação
  Sim, o starter serve. Mas o uso correto é: usar como shell visual e sistema de componentes, não como arquitetura final de dados ainda. Para agora, ele deve virar um protótipo
  operacional navegável para validar o backoffice. Depois ligamos Supabase/API com schemas, audit log e permissões.
