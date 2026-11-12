/**
 * The relation graph around a model: a node per model, an edge per relation.
 *
 * Built from the summaries a session gives for its models, so it is the same
 * on every target. Only what is asked for is drawn; the rest is added as the
 * reader opens nodes.
 */

interface Described { t: string, [key: string]: unknown }

export interface ModelSummary {
  name: string
  table?: string
  relations: Array<{ kind: string, model: string, name?: string }>
}

export interface RelationNode { id: string, label: string, kind: string, detail?: string, expandable: boolean }
export interface RelationEdge { source: string, target: string, label: string }

/** The models a result is made of: its own, or the ones in a list. */
export function modelsIn(value: Described | null | undefined): string[] {
  if (!value)
    return []
  if (value.t === 'model')
    return [String(value.model)]
  if (value.t !== 'array' && value.t !== 'set')
    return []
  const names = new Set<string>()
  for (const item of value.items as Described[]) {
    if (item.t === 'model')
      names.add(String(item.model))
  }
  return [...names]
}

function nodeFor(summary: ModelSummary | undefined, name: string): RelationNode {
  return {
    id: name,
    label: name,
    kind: 'model',
    ...(summary?.table ? { detail: summary.table } : {}),
    // A model the session did not list has nothing to open.
    expandable: Boolean(summary?.relations.length),
  }
}

/** The named models and everything one relation away from them. */
export function neighbourhood(models: ModelSummary[], names: string[]): { nodes: RelationNode[], edges: RelationEdge[] } {
  const byName = new Map(models.map(model => [model.name, model]))
  const nodes = new Map<string, RelationNode>()
  const edges: RelationEdge[] = []
  for (const name of names) {
    const summary = byName.get(name)
    nodes.set(name, { ...nodeFor(summary, name), expandable: false })
    for (const relation of summary?.relations ?? []) {
      if (!nodes.has(relation.model))
        nodes.set(relation.model, nodeFor(byName.get(relation.model), relation.model))
      edges.push({ source: name, target: relation.model, label: relation.kind })
    }
  }
  return { nodes: [...nodes.values()], edges }
}
