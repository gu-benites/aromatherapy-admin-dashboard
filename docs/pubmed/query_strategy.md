• The app’s data model already has the right graph for this: oil to health concern, oil to direct therapeutic property, oil to compounds, and compound
  to therapeutic property. The PubMed query builder should use that graph to generate several evidence lenses instead of one “best” query.

• The legacy n8n flow has the right core idea: PubMed search should be generated from entity groups, not from a raw user sentence.

  The rule to keep is:

  OR inside the same category
  AND between different categories

  So the app should treat searches as combinations of:

  oil terms
  health concern terms
  therapeutic property terms
  chemical compound terms

  Core Model
  For each screen, build a query from the selected entity plus its graph neighbors.

  Example entity groups:

  oilGroup =
  ("Rosa damascena"[Title/Abstract] OR "rose essential oil"[Title/Abstract] OR "rose oil"[Title/Abstract])

  concernGroup =
  (anxiety[Title/Abstract] OR stress[Title/Abstract] OR "emotional balance"[Title/Abstract])

  compoundGroup =
  (citronellol[Title/Abstract] OR geraniol[Title/Abstract] OR nerol[Title/Abstract])

  propertyGroup =
  (anxiolytic[Title/Abstract] OR calming[Title/Abstract] OR sedative[Title/Abstract])

  Then generate multiple query lenses, not one query.

  For Essential Oil Pages
  Use the oil as the anchor.

  Best query types:

  oil + health concern
  oil + therapeutic property
  oil + dominant compounds
  oil + safety/toxicity
  oil + chemical composition

  Example:

  (oilGroup) AND (concernGroup)
  (oilGroup) AND (propertyGroup)
  (oilGroup) AND (compoundGroup)
  (oilGroup) AND (toxicity[Title/Abstract] OR safety[Title/Abstract])

  This gives the oil page sections like “clinical relevance”, “therapeutic activity”, “chemical evidence”, and “safety evidence”.

  For Health Concern Pages
  Use the concern as the anchor, then look for oils, compounds, and properties connected to it.

  (concernGroup) AND (oilGroup)
  (concernGroup) AND (compoundGroup)
  (concernGroup) AND (propertyGroup)

  This is useful for “which oils may have evidence for anxiety/cough/inflammation?” The strongest papers are concern + oil. Compound/property matches
  are weaker, but valuable as mechanism evidence.

  For Therapeutic Property Pages
  These are mechanism-oriented, so the best searches are:

  (propertyGroup) AND (compoundGroup)
  (propertyGroup) AND (oilGroup)
  (propertyGroup) AND (concernGroup)

  Example: anti-inflammatory → compounds like thymol, carvacrol, linalool → oils containing them → concerns where inflammation matters.

  For Chemical Compound Pages
  The compound page should separate direct compound research from oil-context research.

  (compoundGroup) AND (propertyGroup)
  (compoundGroup) AND (concernGroup)
  (compoundGroup) AND (oilGroup)
  (compoundGroup) AND ("essential oil"[Title/Abstract])

  This lets you say: “this compound has evidence for X”, and separately “this compound appears in these essential oil studies.”

  Most Important Product Decision
  Do not present every paper as the same kind of evidence. Classify the result by evidence distance:

  Direct evidence:
  oil + health concern

  Strong profile evidence:
  oil + therapeutic property

  Mechanistic evidence:
  compound + health concern
  compound + therapeutic property

  Chemistry support:
  oil + compound
  oil + chemical composition

  Broad contextual evidence:
  health concern + therapeutic property

  That distinction matters because compound evidence does not automatically prove the whole oil works clinically.

  Recommended Query Cascade
  For any selected combination, run queries from strict to broad:

  1. oil AND concern AND compound/property
  2. oil AND concern
  3. oil AND property
  4. compound AND concern
  5. compound AND property
  6. oil AND compound

  If strict queries return nothing, broad queries still find useful support.

  Implementation Shape
  The future query builder should return a structured plan like:

  {
    target: 'essential_oil',
    entityId: oil.id,
    queries: [
      {
        label: 'Direct oil-health evidence',
        evidenceType: 'direct',
        query: '(Lavandula angustifolia[Title/Abstract] OR lavender oil[Title/Abstract]) AND (anxiety[Title/Abstract])'
      },
      {
        label: 'Mechanistic compound evidence',
        evidenceType: 'mechanistic',
        query: '(linalool[Title/Abstract] OR linalyl acetate[Title/Abstract]) AND (anxiety[Title/Abstract] OR anxiolytic[Title/Abstract])'
      }
    ]
  }

  The legacy n8n prompt hid the query from the end user. For this admin/research app, I’d do the opposite: store and show the query, evidence type, and
  reason it was generated. For consumer-facing AromaCHAT, hide the query and show only the interpreted evidence.

  • Yes. You’re right. The legacy flow explicitly supports 3-category queries, and that matters a lot.

  The strongest pattern is:

  (oil terms)
  AND
  (
    (compound terms)
    OR
    (health concern terms)
    OR
    (therapeutic property terms)
  )

  And also stricter forms:

  (oil terms)
  AND
  (health concern terms)
  AND
  (compound terms)

  or:

  (oil terms)
  AND
  (therapeutic property terms)
  AND
  (compound terms)

  So the query builder should not be limited to pairwise searches. A better strategy is:

  ANCHOR ENTITY
  AND
  (SUPPORTING EVIDENCE GROUP A OR SUPPORTING EVIDENCE GROUP B OR SUPPORTING EVIDENCE GROUP C)

  For an oil page:

  ("Lavandula angustifolia"[Title/Abstract] OR "lavender oil"[Title/Abstract])
  AND
  (
    (linalool[Title/Abstract] OR "linalyl acetate"[Title/Abstract])
    OR
    (anxiety[Title/Abstract] OR stress[Title/Abstract])
    OR
    (anxiolytic[Title/Abstract] OR sedative[Title/Abstract])
  )

  Then, for precision, also generate stricter 3-way queries:

  ("Lavandula angustifolia"[Title/Abstract] OR "lavender oil"[Title/Abstract])
  AND
  (anxiety[Title/Abstract] OR stress[Title/Abstract])
  AND
  (linalool[Title/Abstract] OR "linalyl acetate"[Title/Abstract])

  The difference:

  oil AND (compound OR concern OR property)

  is broad discovery.

  oil AND concern AND compound

  is high-precision mechanistic evidence.

  The strategy should be a cascade:

  1. oil AND concern AND compound
  2. oil AND concern AND property
  3. oil AND (concern OR compound OR property)
  4. concern AND (oil OR compound OR property)
  5. compound AND (oil OR concern OR property)

  So yes: the query builder should support multi-category Boolean composition, with an anchor group plus nested supporting groups. My earlier framing underweighted
  that.

  • I picked Ginger / Gengibre / Zingiber officinale from your Postgres data because it is a good stress test:

  - 6 linked compounds: Alpha-zingiberene, Sesquiphellandrene, Bisabolene, Camphene, Farnesene, Gamma-curcumene
  - 111 linked health concerns
  - 31 direct therapeutic properties
  - 22 compound-derived therapeutic properties
  - Strong recipe signals around diabetes, cough, sore throat, GERD, obesity, constipation, vertigo, depression

  I validated several PubMed advanced-search shapes. The main finding: three categories are useful, but not always as strict AND AND AND. The most reusable pattern is:

  oilGroup
  AND
  (
    concernGroup
    OR propertyGroup
    OR compoundGroup
  )

  For Ginger, this worked well:

  ("Zingiber officinale"[Title/Abstract] OR "ginger essential oil"[Title/Abstract] OR "ginger oil"[Title/Abstract])
  AND
  (
    (nausea[Title/Abstract] OR vomiting[Title/Abstract] OR dyspepsia[Title/Abstract] OR constipation[Title/Abstract] OR cough[Title/Abstract] OR "type 2
  diabetes"[Title/Abstract] OR obesity[Title/Abstract])
    OR
    ("anti-inflammatory"[Title/Abstract] OR antioxidant[Title/Abstract] OR analgesic[Title/Abstract] OR antiemetic[Title/Abstract] OR carminative[Title/Abstract] OR
  expectorant[Title/Abstract])
    OR
    (zingiberene[Title/Abstract] OR sesquiphellandrene[Title/Abstract] OR bisabolene[Title/Abstract] OR camphene[Title/Abstract])
  )

  That returned a broad but relevant set: ginger inflammatory disease reviews, bioactive compound reviews, aromatherapy nausea studies, antioxidant/anti-inflammatory
  activity papers. Example PubMed hits included PMID 36364048, 38903613, 31151279, and 34283916.

  Important Pattern
  For 90% of app screens, I would use this cascade:

  1. oil AND (concern OR property OR compound)
  2. oil AND concern AND property
  3. oil AND concern
  4. oil AND ("essential oil" OR "volatile oil") AND (compound OR property OR "chemical composition")
  5. compound AND property

  I would not default to:

  oil AND concern AND compound

  That was often too narrow. For Ginger digestive concerns, the strict oil AND nausea/dyspepsia AND zingiberene/sesquiphellandrene/... query returned only 1 result and
  it was not actually a digestive clinical paper. So compound should usually be in the nested evidence group, not mandatory, unless the screen is specifically
  validating a compound relationship.

  Admin Rule
  Use this by screen:

  Oil page:
  oil AND (top concerns OR top properties OR top compounds)

  Health concern page:
  concern AND (linked oils OR relevant properties OR linked compounds)

  Therapeutic property page:
  property AND (linked oils OR linked compounds OR related concerns)

  Compound page:
  compound AND (linked properties OR linked oils OR "essential oil")

  For Ginger specifically, the best admin default is:

  oil = Zingiber officinale / ginger essential oil
  concerns = top recipe-linked concerns, grouped by domain
  properties = direct + compound-derived properties
  compounds = top 3-6 normalized compounds

  The key implementation detail: do not throw all 111 health concerns into one query. Bucket them first: digestive, metabolic, respiratory, pain/inflammation,
  emotional/neurologic. Then generate one query per bucket. That is what will make this pattern reliable instead of noisy.

  #######
  and what is the strucrture to save them so ai agents can access and give a instant analysis based on the saved studies?
  postgress with pgvector
  neo4j
  lightRAG?

  then this will help to create many more postgres relations that are hard database values because many studies show that OIL X has 3 studies that is good for propert
  Y and it is a great fit for health concern Z

  Then we could add that propery and that health concertn to the relation of the essential oil in the postgres database.

  Did you understood my objective?
  #######

  • Yes, I understand the objective.

  You want a system that turns PubMed papers into durable evidence, so agents can instantly answer:

  > “Why is Oil X related to Property Y or Health Concern Z?”

  And then, when enough evidence exists, the system can create or propose new hard Postgres relations like:

  essential_oil -> therapeutic_property
  essential_oil -> health_concern
  compound -> therapeutic_property
  oil + compound + property -> health concern support

  Recommendation
  Use Postgres + pgvector as the source of truth.

  Do not start with Neo4j or LightRAG as the primary database.

  Why:

  - Your app’s canonical entities already live in Postgres: oils, compounds, health concerns, therapeutic properties.
  - You need hard relations that admins can approve and the product can rely on.
  - pgvector lets you store embeddings next to structured relational data, with normal SQL joins, transactions, and filtering. pgvector’s official docs describe it as
    vector similarity search inside Postgres, keeping vectors with normal Postgres data and joins: https://github.com/pgvector/pgvector
  - Neo4j is good for graph traversal and graph-native reasoning, but it adds another source of truth. Neo4j itself positions graph + vector as useful for explicit and
    implicit relationships: https://neo4j.com/developer/genai-ecosystem/vector-search/
  - LightRAG is useful as an indexing/retrieval idea because it combines graph structures with text retrieval, but I would treat it as a sidecar pattern, not the cano
    nical product database: https://lightrag.github.io/

  Core Structure
  Keep your existing tables, then add an evidence layer:

  research_papers
  research_paper_chunks
  research_queries
  research_query_results
  research_entities
  research_claims
  research_claim_studies
  research_relation_candidates
  research_relation_decisions

  The important table is research_claims.

  Example:

  claim:
    subject_type: essential_oil
    subject_id: Ginger
    predicate: supports_therapeutic_property
    object_type: therapeutic_property
    object_id: Anti-inflammatory
    evidence_direction: supports
    confidence_score: 0.84
    evidence_level: review | clinical_trial | in_vitro | animal | chemistry | computational
    summary: Ginger/Zingiber officinale studies report anti-inflammatory activity...

  Then research_claim_studies links that claim to papers:

  claim_id
  paper_id
  pmid
  study_type
  species
  sample_size
  outcome
  quoted_evidence
  relevance_score

  Then candidate hard relations:

  research_relation_candidates:
    essential_oil_id
    therapeutic_property_id
    health_concern_id nullable
    compound_id nullable
    support_count
    best_evidence_level
    status: proposed | accepted | rejected
    generated_reason

  Once accepted, you insert into your existing hard relation tables:

  essential_oil_therapeutic_properties
  essential_oil_health_concern
  chemical_compound_therapeutic_properties

  Critical Rule
  Do not let the AI directly create hard product relations without review.

  Let it create:

  candidate relations
  evidence summaries
  confidence scores
  citations

  Then an admin accepts/rejects. Later, high-confidence rules can auto-approve.

  Instant Agent Analysis
  For instant answers, don’t make the agent read raw papers every time. Precompute:

  evidence_summary_by_oil
  evidence_summary_by_oil_property
  evidence_summary_by_oil_health_concern
  evidence_summary_by_compound_property

  Then the agent flow is:

  1. User asks about oil/property/concern
  2. SQL fetches accepted claims + summaries
  3. pgvector retrieves supporting chunks only if needed
  4. Agent answers with citations and evidence strength

  Evidence Distance
  This is the most important product concept:

  Direct evidence:
  Oil X studied for Health Concern Z

  Strong property evidence:
  Oil X studied for Property Y

  Mechanistic evidence:
  Compound C in Oil X studied for Property Y or Concern Z

  Chemistry-only evidence:
  Oil X contains Compound C, and C has known activity

  Weak inferred evidence:
  Oil X is related to Concern Z only through broad property overlap

  This prevents bad claims. For example:

  Ginger -> contains zingiberene
  zingiberene -> anti-inflammatory evidence
  anti-inflammatory -> relevant to arthritis

  That is useful, but weaker than:

  Ginger directly studied in arthritis patients

  So yes: the system should create many more Postgres relations, but each relation should know why it exists, which studies support it, and how strong the evidence is.
