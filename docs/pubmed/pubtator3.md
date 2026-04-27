• Best candidate: PubTator 3.0

  Use NCBI/NLM PubTator 3.0 as the non-Entrez PubMed interaction. It is not the classic eutils.ncbi.nlm.nih.gov/entrez/eutils/* flow. It is built around
  AI-friendly literature retrieval: entity lookup, relation search, annotation export, and evidence-bearing PubMed/PMC results.

  Key sources:

  - NCBI still describes E-utilities as the public Entrez/PubMed API, so this is the baseline you want to avoid:
    https://www.ncbi.nlm.nih.gov/home/develop/api/
  - PubTator 3.0 paper says its API supports keyword, entity, and relation search plus BioC JSON/XML export:
    https://academic.oup.com/nar/article/52/W1/W540/7640526
  - The paper explicitly describes a GPT-4/function-calling integration using PubTator APIs for entity IDs, related entities, and evidence export.
  - BioC PubMed JSON API is another official non-Entrez endpoint for retrieving PubMed articles in text-mining-friendly JSON:
    https://www.ncbi.nlm.nih.gov/research/bionlp/APIs/BioC-PubMed/

  Useful endpoints

  Relation search:

  GET https://www.ncbi.nlm.nih.gov/research/pubtator3-api/relations?e1=@GENE_JAK1&type=negative_correlate&e2=Chemical

  This returns structured JSON relation rows like source entity, target entity, relation type, and publication count.

  PubMed article as BioC JSON:

  GET https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pubmed.cgi/BioC_json/{PMID}/unicode

  PubTator annotation export pattern:

  GET https://www.ncbi.nlm.nih.gov/research/pubtator3-api/publications/export/biocjson?pmids={PMID_LIST}

  Recommendation

  For an AI-agent workflow, model this as tools:

  1. find_entity(query, type?)
  2. find_related_entities(entityId, relationType?, targetType?)
  3. get_article_annotations(pmids[])
  4. get_article_bioc_json(pmid)

  Use PubTator 3.0 for semantic/entity/relation discovery, then fall back to E-utilities only when you need canonical PubMed search behavior or PubMed-
  specific metadata not exposed by PubTator. Third-party options like Valyu and PubMed.ai are more “agent productized,” but PubTator 3.0 is the better
  official NCBI/NLM direction.