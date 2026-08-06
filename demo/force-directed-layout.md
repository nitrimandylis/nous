---
name: force-directed-layout
description: "Pretend the graph is springs and charged particles"
metadata:
  type: algorithm
---

Every [[node]] repels every other, every [[edge]] pulls like a spring, and the picture is wherever it settles. Fruchterman and Reingold published the version everyone copies. Naive implementations are O(n^2) per frame; [[barnes-hut]] is the fix.

See also: [[node]], [[edge]].
