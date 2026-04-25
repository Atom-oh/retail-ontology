"""
Loader for Neptune / OpenSearch / Aurora.

Phase 3 deliverable. This file is a placeholder to anchor the dependency graph
between Phase 1 (data generation, this directory) and Phase 3 (API + ingest).

Planned interfaces:

    def load_to_neptune(graph_endpoint: str, *, dry_run: bool = False) -> LoadStats:
        '''Load brands/manufacturers/concerns/trends/personas/products as nodes,
        and HAS_INGREDIENT/IN_CATEGORY/AVOIDS_INGREDIENT/etc. as edges.'''

    def index_to_opensearch(collection_endpoint: str) -> None:
        '''Index products + reviews + ingredients with Nori analyzer for
        Korean BM25 search; also write Cohere embeddings for hybrid retrieval.'''

    def load_aurora_logs(secret_arn: str) -> None:
        '''Initialize search/chat log tables (empty initially).'''

The actual implementation belongs to Phase 3 (api/services/ingest.py and the
data loading scripts driven by `cdk deploy` post-deploy hooks).
"""
