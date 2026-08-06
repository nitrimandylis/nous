---
name: barnes-hut
description: "Treat a distant clump as one lump"
metadata:
  type: algorithm
---

An approximation that drops [[force-directed-layout]] from O(n^2) to O(n log n) by grouping far-away nodes in a [[quadtree]] and treating each group as a single point. Written for galaxies in 1986.

See also: [[node]].
