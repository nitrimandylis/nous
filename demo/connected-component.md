---
name: connected-component
description: "A piece of the graph with no bridge to the rest"
metadata:
  type: concept
---

A maximal set of nodes that can all reach each other. Run [[breadth-first-search]] from any node and you have found its component. A graph in one piece has exactly one.

See also: [[strongly-connected-components]], [[community-detection]].
