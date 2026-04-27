  Neo4j is not necessary as a primary database right now. Postgres is already powerful enough for the current data size and app needs. But a read-only
  Neo4j graph mirror is a good candidate for an agent/query layer prototype.

  I would not replace Postgres. I would test Neo4j as an auxiliary graph/GraphRAG service.

  What I Found In Postgres
  From the Bubble/Supabase migrated database:

  | Metric | Current State |
  |---|---:|
  | Database size | 62 MB |
  | Public tables | 109 |
  | Views | 18 |
  | Foreign keys | 90 |
  | pgvector installed | yes |
  | pg_graphql installed | yes |
  | Core essential oils | 120 |
  | Health concerns | 599 |
  | Recipes | 2,254 |
  | Recipe-oil edges | 6,217 |
  | Oil-health edges | 3,908 |
  | Product-oil edges | 803 |
  | Oil-compound edges | 400 |
  | Oil-therapeutic-property edges | 1,601 |
  | Compound-property edges | 538 |

  This is clearly graph-shaped data, but it is still small enough that Postgres handles it well.

  I tested representative multi-hop joins:

  | Query Shape | Result Paths | Runtime |
  |---|---:|---:|
  | Product -> oil -> compound -> property | 17,222 paths | ~17 ms |
  | Health concern -> action system -> oil -> property | 171,343 paths | ~127 ms |

  That is not slow enough to justify Neo4j for performance today.

  Probabilities
  | Claim | Probability |
  |---|---:|
  | Postgres should remain source of truth | 98% |
  | Neo4j is unnecessary as primary DB right now | 90% |
  | Neo4j would improve raw query performance today | 20% |
  | Neo4j would improve agent ergonomics for arbitrary multi-hop questions | 65% |
  | Neo4j would improve user-facing “why this oil/product?” explanation features | 70% |
  | Neo4j read-only mirror is worth prototyping | 80% |
  | App should query Neo4j instead of Postgres today | 25% |
  | App should query both Postgres and Neo4j later | 55% |
  | Dumping tables into Neo4j without curated graph model will help much | 25% |

  My Recommendation
  Do this:

  1. Keep Postgres as the source of truth.
  2. Build better Postgres views/materialized views first.
  3. Add SQL functions/RPC endpoints for common agent questions.
  4. Prototype a read-only Neo4j mirror only for graph traversal and explanation queries.
  5. Only let the app query Neo4j for specific graph features, not general CRUD.

  Do not do this yet:

  - Do not move writes to Neo4j.
  - Do not make Neo4j mandatory for booking, bio, landing, or normal product pages.
  - Do not duplicate the whole app data layer without a sync plan.

  Where Neo4j Would Help
  Neo4j is strongest for questions like:

  - “Which products connect to oils that share compounds associated with anti-inflammatory properties and are also relevant to digestive concerns?”
  - “Explain the shortest relationship path between a health concern, an oil, a compound, and a therapeutic property.”
  - “Find neighboring oils/products by shared chemical, emotional, safety, and usage relationships.”
  - “Show an interactive graph of why this recommendation was made.”

  Postgres can answer these, but the SQL becomes harder for agents to generate safely. Cypher is more natural for variable-depth graph traversal.

  Where Postgres Is Still Better
  Postgres is better for:

  - transactional source of truth;
  - normalized data integrity;
  - Supabase/PostgREST/GraphQL access;
  - pgvector semantic search;
  - app queries with filters, pagination, auth, and RLS;
  - migrations and reporting.

  You already have vector and pg_graphql installed, so Postgres is not “just relational” here. It can already support RAG-style retrieval and app-facing
  APIs.

  Best Next Step
  Before installing Neo4j permanently, build a small proof of concept:
  - Export 8-10 relationship types from the join tables.
  - Load into Neo4j read-only.
  - Test 20 real agent questions against:
      - hybrid pgvector + SQL;
      - hybrid Neo4j + vector.

  Final Call
  Neo4j is not needed to make the current system work.

  Neo4j is probably worth a controlled prototype as an auxiliary graph/agent query layer because your domain is naturally graph-shaped and explanation-
  heavy.

  Sources:

  - pgvector: https://github.com/pgvector/pgvector
  - PostgreSQL recursive queries: https://www.postgresql.org/docs/17/queries-with.html
  - Neo4j GraphRAG: https://neo4j.com/labs/genai-ecosystem/graphrag/
  - Neo4j vector indexes: https://neo4j.com/docs/cypher-manual/current/indexes/semantic-indexes/vector-indexes/


› and what about a literag?


• Vou assumir que você quis dizer LightRAG/LiteRAG como alternativa mais leve a Neo4j GraphRAG. Vou verificar o estado atual da ferramenta e comparar
  contra Postgres/Neo4j para este banco.

• Searching the web

• Searched LightRAG graph RAG GitHub HKUDS LightRAG

• Searching the web

• Searched https://github.com/HKUDS/LightRAG/blob/main/CLAUDE.md

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

• If you mean LightRAG from HKUDS: it is probably a better first experiment than installing Neo4j.

  But important distinction:

  - Neo4j = graph database.
  - LightRAG = RAG framework that builds/uses graph + vector retrieval.
  - Postgres = still source of truth.

  For your case, LightRAG makes more sense as an agent knowledge/query layer, not as an app database.

  Fit For Your Data
  Your EO/Supabase data is already structured:

  - oils
  - products
  - compounds
  - health concerns
  - recipes
  - therapeutic properties
  - action systems
  - safety metadata
  - embeddings in Postgres via vector

  LightRAG is strongest when it has to extract entities/relationships from text documents. Your best data is already relational. So we should not
  blindly dump rows into LightRAG and let it re-infer relationships. That would be lossy.

  Better pattern:

  Postgres source of truth
    -> curated SQL views / materialized views
    -> generated evidence documents per oil/product/concern
    -> LightRAG index for agent retrieval
    -> agent uses LightRAG to find relevant context
    -> agent uses Postgres SQL for final verified facts

  Probabilities
  | Claim | Probability |
  |---|---:|
  | LightRAG is useful for an agent Q&A layer over this domain | 85% |
  | LightRAG is a better first prototype than Neo4j | 70% |
  | LightRAG should replace Postgres for app queries | 5% |
  | LightRAG should replace Neo4j as graph DB | 60% for prototype, 25% long-term |
  | Best architecture is Postgres + LightRAG, no Neo4j initially | 75% |
  | Later adding Neo4j behind LightRAG improves multi-hop graph explainability | 45% |
  | Letting LightRAG auto-extract all graph facts from relational rows will introduce errors | 65% |
  | App should query LightRAG directly for deterministic UI data | 10% |
  | Agent should query LightRAG first, then verify with Postgres | 90% |

  Recommended Use
  Use LightRAG for:

  - “Explain why this oil is recommended for this concern.”
  - “Find products that connect to oils with compounds related to inflammation.”
  - “Compare lavender vs copaiba across chemistry, emotional use, and safety.”
  - “What recipes involve oils connected to respiratory action systems?”
  - “Summarize the evidence around pregnancy safety for this oil.”

  Do not use LightRAG for:

  - checkout;
  - booking;
  - user records;
  - exact CRUD;
  - deterministic product pages;
  - canonical safety rules without Postgres verification.

  Best Architecture

  Agent question
    -> LightRAG retrieves relevant entities/relationships/docs
    -> Agent generates/chooses SQL query
    -> Postgres returns verified rows
    -> Agent answers with citations/IDs

  This avoids the main risk of RAG: plausible but wrong answers.

  Why LightRAG Is Attractive Here
  LightRAG supports graph-based retrieval plus vector retrieval, with modes like local/global/hybrid/mix. It also supports multiple storage backends,
  including PostgreSQL and Neo4j. That means we can test it without committing to Neo4j immediately.

  My Call
  Start with Postgres + LightRAG.

  Prototype Plan

  1. Generate evidence docs from Postgres views:
      - one doc per essential oil;
      - one doc per product/blend;
      - one doc per health concern;
      - one doc per compound/property cluster.
  2. Index those docs in LightRAG.
  3. Build 30 benchmark questions.
  4. Compare:
      - Postgres-only SQL;
      - pgvector search;
      - LightRAG;
      - LightRAG + Postgres verification.
  5. Only then decide on Neo4j.

  Sources:

  - LightRAG repo/docs: https://github.com/HKUDS/LightRAG
  - LightRAG paper: https://arxiv.org/abs/2410.05779
  - Neo4j GraphRAG: https://neo4j.com/labs/genai-ecosystem/graphrag/
  - pgvector: https://github.com/pgvector/pgvector