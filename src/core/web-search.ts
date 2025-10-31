export async function webSearch(query: string, limit = 5) {
  // pour l'instant on renvoie des faux résultats stables
  // (pour éviter des appels API réels dans la CI)
  const seed = query.replace(/\W+/g, "_").slice(0, 20);
  return Array.from({ length: limit }, (_, i) => ({
    title: `[Mock ${seed}] Result ${i + 1}`,
    url: `https://example.com/${seed}/${i + 1}`,
    snippet: `Simulated search result for "${query}" (${i + 1})`
  }));
}
