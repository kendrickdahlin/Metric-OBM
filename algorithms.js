(function () {
  function distance(x, y) {
    return Math.abs(x - y);
  }

  function seededRng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (1664525 * s + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function offlineOptimumCardinality(instance) {
    const { offline, online, radius } = instance;
    const nL = online.length;
    const nR = offline.length;

    // Only one node per distinct offline position counts toward OPT.
    const repSorted = Array.from({ length: nR }, (_, i) => i)
      .sort((a, b) => offline[a] - offline[b]);
    const isRep = new Uint8Array(nR);
    let lastRepPos = -Infinity;
    for (const j of repSorted) {
      if (Math.abs(offline[j] - lastRepPos) > 1e-12) { isRep[j] = 1; lastRepPos = offline[j]; }
    }

    const adj = online.map((x) =>
      offline
        .map((y, j) => ({ j, ok: isRep[j] === 1 && distance(x, y) <= radius }))
        .filter((v) => v.ok)
        .map((v) => v.j)
    );

    const matchR = Array(nR).fill(-1);

    function dfs(u, seen) {
      for (const v of adj[u]) {
        if (seen[v]) {
          continue;
        }
        seen[v] = true;
        if (matchR[v] === -1 || dfs(matchR[v], seen)) {
          matchR[v] = u;
          return true;
        }
      }
      return false;
    }

    let size = 0;
    for (let u = 0; u < nL; u++) {
      const seen = Array(nR).fill(false);
      if (dfs(u, seen)) {
        size += 1;
      }
    }
    return size;
  }

  // Generates all permutations of [0, 1, ..., n-1] via Heap's algorithm.
  function allPermutations(n) {
    const arr = Array.from({ length: n }, (_, i) => i);
    const perms = [];

    function heap(k) {
      if (k === 1) {
        perms.push([...arr]);
        return;
      }
      heap(k - 1);
      for (let i = 0; i < k - 1; i++) {
        if (k % 2 === 0) {
          [arr[i], arr[k - 1]] = [arr[k - 1], arr[i]];
        } else {
          [arr[0], arr[k - 1]] = [arr[k - 1], arr[0]];
        }
        heap(k - 1);
      }
    }

    if (n === 0) return [[]];
    heap(n);
    return perms;
  }

  // Runs random-linear-rank with a given rank array (rank[j] = priority of offline node j).
  // Lower rank = matched first.  baseCap (optional) is the starting capacity array;
  // non-representative nodes should already have baseCap[j] = 0 so they are skipped.
  // Returns { onlineAssigned, matchWeights, remainingCap }.
  function runLinearRank(instance, rank, baseCap = null) {
    const remainingCap = baseCap ? [...baseCap] : Array(instance.offline.length).fill(1.0);
    const onlineAssigned = Array(instance.online.length).fill(0.0);
    const matchWeights = new Map();

    for (let i = 0; i < instance.online.length; i++) {
      const x = instance.online[i];
      const candidates = instance.offline
        .map((y, j) => ({ j, ok: distance(x, y) <= instance.radius && remainingCap[j] > 1e-12 }))
        .filter((v) => v.ok)
        .map((v) => v.j);

      if (candidates.length === 0) {
        continue;
      }

      const j = candidates.reduce((best, cur) => (rank[cur] < rank[best] ? cur : best));
      const w = Math.min(1.0, remainingCap[j]);
      if (w > 1e-12) {
        remainingCap[j] -= w;
        onlineAssigned[i] += w;
        const key = `${i},${j}`;
        matchWeights.set(key, (matchWeights.get(key) || 0) + w);
      }
    }

    return { onlineAssigned, matchWeights, remainingCap };
  }

  const ALGORITHMS = [
    { key: "left-or-rightmost",           label: "Left or rightmost",                                    mode: "integral"   },
    { key: "random-linear-rank",          label: "Random linear rank",                                   mode: "integral"   },
    { key: "random-linear-rank-all-perms",label: "Random linear rank (all start/direction combinations)",mode: "fractional" },
    { key: "ranking",                     label: "Ranking",                                              mode: "integral"   },
    { key: "ranking-all-perms",           label: "Ranking (all permutations)",                           mode: "fractional" },
    { key: "outermost-match",             label: "Outermost Match",                                      mode: "fractional" },
    { key: "middle-match",               label: "Middle Match",                                         mode: "fractional" },
  ];

  function runAlgorithm(instance, algorithm, seedValue) {
    const meta = ALGORITHMS.find((a) => a.key === algorithm);
    if (!meta) {
      throw new Error(`Unknown algorithm: ${algorithm}`);
    }

    const rng = Number.isFinite(seedValue) ? seededRng(seedValue) : Math.random;
    const remainingCap = Array(instance.offline.length).fill(1.0);
    const onlineAssigned = Array(instance.online.length).fill(0.0);
    const matches = [];

    // ── Representative filter ────────────────────────────────────────────────
    // Among offline nodes that share the same position, only the one with the
    // lowest original index is a "representative" and can receive weight.
    // Non-representatives start with remainingCap = 0 and are therefore
    // invisible to every downstream capacity check (remainingCap[j] > 1e-12).
    // This enforces the invariant: no more than 1 unit of water flows into any
    // distinct offline position across the entire run.
    {
      const repOrder = Array.from({ length: instance.offline.length }, (_, i) => i)
        .sort((a, b) => instance.offline[a] - instance.offline[b]);
      let lastPos = -Infinity;
      for (const j of repOrder) {
        if (Math.abs(instance.offline[j] - lastPos) > 1e-12) { lastPos = instance.offline[j]; }
        else { remainingCap[j] = 0; }
      }
    }
    const baseCap = [...remainingCap]; // snapshot for runLinearRank calls

    if (algorithm === "left-or-rightmost") {
      const n = instance.offline.length;
      // Pick direction ONCE for the whole run (not per arrival).
      // Right: rank l_1, l_2, …, l_n  (match leftmost available neighbour)
      // Left:  rank l_n, l_{n-1}, …, l_1  (match rightmost available neighbour)
      const goRight = rng() < 0.5;
      const sortedIdx = Array.from({ length: n }, (_, i) => i)
        .sort((a, b) => instance.offline[a] - instance.offline[b]);
      if (!goRight) sortedIdx.reverse();

      // rank[original_j] = priority (0 = matched first).
      const rank = Array(n);
      sortedIdx.forEach((origJ, k) => { rank[origJ] = k; });

      for (let i = 0; i < instance.online.length; i++) {
        const x = instance.online[i];
        const candidates = instance.offline
          .map((y, j) => ({ j, ok: distance(x, y) <= instance.radius && remainingCap[j] > 1e-12 }))
          .filter((v) => v.ok)
          .map((v) => v.j);

        if (candidates.length === 0) continue;

        const j = candidates.reduce((best, cur) => rank[cur] < rank[best] ? cur : best);
        const w = Math.min(1.0, remainingCap[j]);
        if (w > 1e-12) {
          remainingCap[j] -= w;
          onlineAssigned[i] += w;
          matches.push({ i, j, w, d: distance(x, instance.offline[j]) });
        }
      }
    } else if (algorithm === "random-linear-rank") {
      const n = instance.offline.length;
      // Sort offline indices by position on the real line (l_1 ≤ l_2 ≤ … ≤ l_n).
      const sortedIdx = Array.from({ length: n }, (_, i) => i)
        .sort((a, b) => instance.offline[a] - instance.offline[b]);

      // Pick starting position and direction uniformly at random.
      const startPos = Math.floor(rng() * n);
      const goRight  = rng() < 0.5;

      // Build rank array: rank[original_j] = priority (0 = matched first).
      //   Right: l_s, l_{s+1}, …, l_n, l_1, …, l_{s-1}  (cyclically increasing)
      //   Left:  l_s, l_{s-1}, …, l_1, l_n, …, l_{s+1}  (cyclically decreasing)
      const rank = Array(n);
      for (let k = 0; k < n; k++) {
        const pos = goRight ? (startPos + k) % n : (startPos - k + n) % n;
        rank[sortedIdx[pos]] = k;
      }

      const { onlineAssigned: oa, matchWeights, remainingCap: rc } = runLinearRank(instance, rank, baseCap);
      oa.forEach((w, i) => { onlineAssigned[i] = w; });
      rc.forEach((c, j) => { remainingCap[j]   = c; });
      for (const [key, w] of matchWeights) {
        const [i, j] = key.split(",").map(Number);
        matches.push({ i, j, w, d: distance(instance.online[i], instance.offline[j]) });
      }
    } else if (algorithm === "random-linear-rank-all-perms") {
      const n = instance.offline.length;
      // Sort offline indices by position on the real line (l_1 ≤ l_2 ≤ … ≤ l_n).
      const sortedIdx = Array.from({ length: n }, (_, i) => i)
        .sort((a, b) => instance.offline[a] - instance.offline[b]);

      // Enumerate all 2n combinations: n starting positions × {right, left}.
      const totalCombinations = 2 * n;
      const aggOnlineAssigned = Array(instance.online.length).fill(0.0);
      const aggMatchWeights   = new Map();

      for (let startPos = 0; startPos < n; startPos++) {
        for (const goRight of [true, false]) {
          const rank = Array(n);
          for (let k = 0; k < n; k++) {
            const pos = goRight ? (startPos + k) % n : (startPos - k + n) % n;
            rank[sortedIdx[pos]] = k;
          }

          const { onlineAssigned: oa, matchWeights } = runLinearRank(instance, rank, baseCap);
          oa.forEach((w, i) => { aggOnlineAssigned[i] += w; });
          for (const [key, w] of matchWeights) {
            aggMatchWeights.set(key, (aggMatchWeights.get(key) || 0) + w);
          }
        }
      }

      // Average over all 2n combinations.
      aggOnlineAssigned.forEach((sum, i) => { onlineAssigned[i] = sum / totalCombinations; });

      // Derive average remaining capacity from aggregated match weights.
      const offlineWeightSum = Array(n).fill(0.0);
      for (const [key, sumW] of aggMatchWeights) {
        const [, j] = key.split(",").map(Number);
        offlineWeightSum[j] += sumW;
      }
      offlineWeightSum.forEach((sum, j) => {
        remainingCap[j] = baseCap[j] < 1e-12 ? 0 : 1.0 - sum / totalCombinations;
      });

      for (const [key, sumW] of aggMatchWeights) {
        const [i, j] = key.split(",").map(Number);
        const w = sumW / totalCombinations;
        matches.push({ i, j, w, d: distance(instance.online[i], instance.offline[j]) });
      }
    } else if (algorithm === "ranking") {
      const n = instance.offline.length;
      // Assign each offline node a uniformly random priority via Fisher-Yates shuffle.
      const rank = Array.from({ length: n }, (_, i) => i);
      for (let k = n - 1; k > 0; k--) {
        const swap = Math.floor(rng() * (k + 1));
        [rank[k], rank[swap]] = [rank[swap], rank[k]];
      }

      const { onlineAssigned: oa, matchWeights, remainingCap: rc } = runLinearRank(instance, rank, baseCap);
      oa.forEach((w, i) => { onlineAssigned[i] = w; });
      rc.forEach((c, j) => { remainingCap[j]   = c; });
      for (const [key, w] of matchWeights) {
        const [i, j] = key.split(",").map(Number);
        matches.push({ i, j, w, d: distance(instance.online[i], instance.offline[j]) });
      }
    } else if (algorithm === "ranking-all-perms") {
      const n = instance.offline.length;
      const perms      = allPermutations(n);
      const totalPerms = perms.length;

      const aggOnlineAssigned = Array(instance.online.length).fill(0.0);
      const aggMatchWeights   = new Map();

      for (const perm of perms) {
        // perm[k] = original index of the offline node assigned rank k.
        const rank = Array(n);
        perm.forEach((origJ, k) => { rank[origJ] = k; });

        const { onlineAssigned: oa, matchWeights } = runLinearRank(instance, rank, baseCap);
        oa.forEach((w, i) => { aggOnlineAssigned[i] += w; });
        for (const [key, w] of matchWeights) {
          aggMatchWeights.set(key, (aggMatchWeights.get(key) || 0) + w);
        }
      }

      // Average over all n! permutations.
      aggOnlineAssigned.forEach((sum, i) => { onlineAssigned[i] = sum / totalPerms; });

      const offlineWeightSum = Array(n).fill(0.0);
      for (const [key, sumW] of aggMatchWeights) {
        const [, j] = key.split(",").map(Number);
        offlineWeightSum[j] += sumW;
      }
      offlineWeightSum.forEach((sum, j) => {
        remainingCap[j] = baseCap[j] < 1e-12 ? 0 : 1.0 - sum / totalPerms;
      });

      for (const [key, sumW] of aggMatchWeights) {
        const [i, j] = key.split(",").map(Number);
        const w = sumW / totalPerms;
        matches.push({ i, j, w, d: distance(instance.online[i], instance.offline[j]) });
      }
    } else if (algorithm === "outermost-match") {
      for (let i = 0; i < instance.online.length; i++) {
        const x = instance.online[i];
        const candidates = instance.offline
          .map((y, j) => ({ j, ok: distance(x, y) <= instance.radius && remainingCap[j] > 1e-12 }))
          .filter((v) => v.ok)
          .map((v) => v.j);

        if (candidates.length === 0) continue;

        // Sort by position to identify leftmost (la) and rightmost (lb).
        const sorted = [...candidates].sort((a, b) => instance.offline[a] - instance.offline[b]);
        const la = sorted[0];
        const lb = sorted[sorted.length - 1];

        if (la === lb) {
          // Single available neighbour — assign the full unit.
          const w = Math.min(1.0, remainingCap[la]);
          if (w > 1e-12) {
            remainingCap[la] -= w;
            onlineAssigned[i] += w;
            matches.push({ i, j: la, w, d: distance(x, instance.offline[la]) });
          }
        } else {
          // Two distinct extremes — split 1/2 unit to each.
          const wa = Math.min(0.5, remainingCap[la]);
          const wb = Math.min(0.5, remainingCap[lb]);
          if (wa > 1e-12) {
            remainingCap[la] -= wa;
            onlineAssigned[i] += wa;
            matches.push({ i, j: la, w: wa, d: distance(x, instance.offline[la]) });
          }
          if (wb > 1e-12) {
            remainingCap[lb] -= wb;
            onlineAssigned[i] += wb;
            matches.push({ i, j: lb, w: wb, d: distance(x, instance.offline[lb]) });
          }
        }
      }
    } else if (algorithm === "middle-match") {
      // Non-representative nodes already have remainingCap[j] = 0 (set by the
      // global representative filter above), so the standard capacity check
      // automatically excludes them — no need for a separate isRep pass here.
      for (let i = 0; i < instance.online.length; i++) {
        const x = instance.online[i];
        // Available neighbours: within radius and still have capacity.
        const candidates = instance.offline
          .map((y, j) => ({ j, ok: distance(x, y) <= instance.radius && remainingCap[j] > 1e-12 }))
          .filter((v) => v.ok)
          .map((v) => v.j);

        if (candidates.length === 0) continue;

        // Sort by position to locate the median(s).
        const sorted = [...candidates].sort((a, b) => instance.offline[a] - instance.offline[b]);
        const k = sorted.length;

        if (k % 2 === 1) {
          // Odd — single median gets the full unit.
          const lm = sorted[(k - 1) / 2];
          const w  = Math.min(1.0, remainingCap[lm]);
          if (w > 1e-12) {
            remainingCap[lm] -= w;
            onlineAssigned[i] += w;
            matches.push({ i, j: lm, w, d: distance(x, instance.offline[lm]) });
          }
        } else {
          // Even — two median positions each get 1/2 unit.
          const lm = sorted[k / 2 - 1];
          const ln = sorted[k / 2];
          const wm = Math.min(0.5, remainingCap[lm]);
          const wn = Math.min(0.5, remainingCap[ln]);
          if (wm > 1e-12) {
            remainingCap[lm] -= wm;
            onlineAssigned[i] += wm;
            matches.push({ i, j: lm, w: wm, d: distance(x, instance.offline[lm]) });
          }
          if (wn > 1e-12) {
            remainingCap[ln] -= wn;
            onlineAssigned[i] += wn;
            matches.push({ i, j: ln, w: wn, d: distance(x, instance.offline[ln]) });
          }
        }
      }
    }

    const totalAssignedWeight = onlineAssigned.reduce((a, b) => a + b, 0);
    const unmatchedOnline = onlineAssigned
      .map((val, i) => ({ i, rem: Math.max(0, 1 - val) }))
      .filter((x) => x.rem > 1e-12)
      .map((x) => x.i);
    const unmatchedOffline = remainingCap
      .map((cap, j) => ({ j, cap }))
      .filter((x) => x.cap > 1e-12)
      .map((x) => x.j);

    const opt = offlineOptimumCardinality(instance);
    return {
      algorithm,
      mode: meta.mode,
      matches,
      onlineAssigned,
      remainingCap,
      totalAssignedWeight,
      unmatchedOnline,
      unmatchedOffline,
      offlineOptimumCardinality: opt,
      competitiveRatio: opt === 0 ? 1 : totalAssignedWeight / opt,
    };
  }

  window.OnlineMatchingAlgorithms = {
    ALGORITHMS,
    runAlgorithm,
    offlineOptimumCardinality,
    distance,
  };
})();
