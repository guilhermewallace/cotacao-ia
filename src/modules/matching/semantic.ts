/**
 * Ponto de extensão para busca semântica (embeddings + pgvector).
 *
 * Nesta versão a busca semântica está DESLIGADA: o Matching Engine usa SKU, código de
 * fabricante, busca textual (FTS) e trigramas. A interface abaixo já é consultada pelo
 * motor; para habilitar, basta fornecer uma implementação — o ranking e a validação de
 * atributos técnicos permanecem os mesmos. Veja docs/arquitetura.md ("Busca semântica").
 */

export interface SemanticHit {
  productId: string;
  /** Similaridade de cosseno normalizada para 0..1. */
  similarity: number;
}

export interface SemanticRetriever {
  readonly enabled: boolean;
  search(organizationId: string, text: string, limit: number): Promise<SemanticHit[]>;
}

export const disabledSemanticRetriever: SemanticRetriever = {
  enabled: false,
  async search() {
    return [];
  },
};
