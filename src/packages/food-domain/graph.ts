/**
 * Food Intelligence Graph — graph storage abstraction.
 *
 * Models relationships between every entity (Customer, Household, Cook,
 * Kitchen, Ingredient, Recipe, etc.). Supports graph traversal (BFS),
 * shortest-path, neighborhood analysis, temporal relationships, and graph
 * events. The abstraction allows future migration to Neo4j/ArangoDB without
 * changing domain logic.
 */
import { db } from "@/lib/db";
import { uuid } from "@eks/common";

export interface GraphNode {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly data: Record<string, unknown>;
  readonly organizationId: string | null;
}

export interface GraphEdge {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly type: string;
  readonly metadata: Record<string, unknown>;
  readonly validFrom: Date;
  readonly validTo: Date | null;
  readonly weight: number;
}

export interface TraversalResult {
  readonly visited: readonly string[];
  readonly path: readonly string[];
  readonly depth: number;
}

export interface PathResult {
  readonly found: boolean;
  readonly path: readonly string[];
  readonly hops: number;
  readonly totalWeight: number;
}

export class GraphEngine {
  /** Ensure a node exists for an entity (upsert). */
  async ensureNode(entityType: string, entityId: string, data: Record<string, unknown> = {}, organizationId?: string): Promise<string> {
    const existing = await db.graphNode.findUnique({ where: { entityType_entityId: { entityType, entityId } } });
    if (existing) {
      await db.graphNode.update({ where: { id: existing.id }, data: { data: JSON.stringify(data) } });
      return existing.id;
    }
    const node = await db.graphNode.create({
      data: { entityType, entityId, data: JSON.stringify(data), organizationId: organizationId ?? null },
    });
    return node.id;
  }

  /** Create a directed edge between two nodes. */
  async createEdge(fromEntityType: string, fromEntityId: string, toEntityType: string, toEntityId: string, type: string, metadata: Record<string, unknown> = {}, weight = 1): Promise<string> {
    const fromNodeId = await this.ensureNode(fromEntityType, fromEntityId);
    const toNodeId = await this.ensureNode(toEntityType, toEntityId);
    const existing = await db.graphEdge.findUnique({ where: { fromNodeId_toNodeId_type: { fromNodeId, toNodeId, type } } });
    if (existing) return existing.id;
    const edge = await db.graphEdge.create({
      data: { fromNodeId, toNodeId, type, metadata: JSON.stringify(metadata), weight },
    });
    return edge.id;
  }

  /** Remove an edge (end a temporal relationship). */
  async endEdge(edgeId: string): Promise<void> {
    await db.graphEdge.update({ where: { id: edgeId }, data: { validTo: new Date() } });
  }

  /** Get all neighbors of a node (1-hop). */
  async neighbors(entityType: string, entityId: string, edgeType?: string): Promise<readonly GraphNode[]> {
    const node = await db.graphNode.findUnique({ where: { entityType_entityId: { entityType, entityId } } });
    if (!node) return [];
    const where = { fromNodeId: node.id, validTo: null, ...(edgeType ? { type: edgeType } : {}) };
    const edges = await db.graphEdge.findMany({ where, include: { toNode: true } });
    return edges.map((e) => this.toGraphNode(e.toNode));
  }

  /** BFS traversal from a node, up to maxDepth hops. */
  async traverse(entityType: string, entityId: string, maxDepth = 3, edgeType?: string): Promise<TraversalResult> {
    const startNode = await db.graphNode.findUnique({ where: { entityType_entityId: { entityType, entityId } } });
    if (!startNode) return { visited: [], path: [], depth: 0 };

    const visited = new Set<string>([startNode.id]);
    const path: string[] = [startNode.id];
    let frontier: string[] = [startNode.id];
    let depth = 0;

    while (depth < maxDepth && frontier.length > 0) {
      const nextFrontier: string[] = [];
      for (const nodeId of frontier) {
        const where = { fromNodeId: nodeId, validTo: null, ...(edgeType ? { type: edgeType } : {}) };
        const edges = await db.graphEdge.findMany({ where, include: { toNode: true } });
        for (const edge of edges) {
          if (!visited.has(edge.toNodeId)) {
            visited.add(edge.toNodeId);
            path.push(edge.toNodeId);
            nextFrontier.push(edge.toNodeId);
          }
        }
      }
      frontier = nextFrontier;
      depth += 1;
    }
    return { visited: Array.from(visited), path, depth };
  }

  /** Shortest path between two nodes (BFS, minimum hops). */
  async shortestPath(fromEntityType: string, fromEntityId: string, toEntityType: string, toEntityId: string): Promise<PathResult> {
    const startNode = await db.graphNode.findUnique({ where: { entityType_entityId: { entityType: fromEntityType, entityId: fromEntityId } } });
    const endNode = await db.graphNode.findUnique({ where: { entityType_entityId: { entityType: toEntityType, entityId: toEntityId } } });
    if (!startNode || !endNode) return { found: false, path: [], hops: 0, totalWeight: 0 };
    if (startNode.id === endNode.id) return { found: true, path: [startNode.id], hops: 0, totalWeight: 0 };

    // BFS with path tracking.
    const queue: { nodeId: string; path: string[]; weight: number }[] = [{ nodeId: startNode.id, path: [startNode.id], weight: 0 }];
    const visited = new Set<string>([startNode.id]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.nodeId === endNode.id) {
        return { found: true, path: current.path, hops: current.path.length - 1, totalWeight: current.weight };
      }
      const edges = await db.graphEdge.findMany({ where: { fromNodeId: current.nodeId, validTo: null }, include: { toNode: true } });
      for (const edge of edges) {
        if (!visited.has(edge.toNodeId)) {
          visited.add(edge.toNodeId);
          queue.push({ nodeId: edge.toNodeId, path: [...current.path, edge.toNodeId], weight: current.weight + edge.weight });
        }
      }
    }
    return { found: false, path: [], hops: 0, totalWeight: 0 };
  }

  /** Check if a path exists between two nodes. */
  async hasPath(fromEntityType: string, fromEntityId: string, toEntityType: string, toEntityId: string): Promise<boolean> {
    const result = await this.shortestPath(fromEntityType, fromEntityId, toEntityType, toEntityId);
    return result.found;
  }

  /** Get graph metrics (node count, edge count by type). */
  async metrics(organizationId?: string): Promise<{ nodes: number; edges: number; edgeTypes: Record<string, number> }> {
    const nodeWhere = organizationId ? { organizationId } : {};
    const nodes = await db.graphNode.count({ where: nodeWhere });
    const edges = await db.graphEdge.count({ where: { validTo: null } });
    const edgeTypeGroups = await db.graphEdge.groupBy({
      by: ["type"],
      where: { validTo: null },
      _count: { type: true },
    });
    const edgeTypes: Record<string, number> = {};
    for (const g of edgeTypeGroups) edgeTypes[g.type] = g._count.type;
    return { nodes, edges, edgeTypes };
  }

  private toGraphNode(n: { id: string; entityType: string; entityId: string; data: string; organizationId: string | null }): GraphNode {
    return { id: n.id, entityType: n.entityType, entityId: n.entityId, data: JSON.parse(n.data), organizationId: n.organizationId };
  }
}

export { uuid };
