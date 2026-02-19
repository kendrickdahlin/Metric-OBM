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
    const adj = online.map((x) =>
      offline
        .map((y, j) => ({ j, ok: distance(x, y) <= radius }))
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

  function sortByPosition(instance, candidates) {
    return [...candidates].sort((a, b) => {
      const da = instance.offline[a];
      const db = instance.offline[b];
      return da - db || a - b;
    });
  }

  function uniqueByDistanceDescending(instance, i, candidates) {
    const x = instance.online[i];
    const eps = 1e-12;
    const vals = [...new Set(candidates.map((j) => distance(x, instance.offline[j])))]
      .sort((a, b) => b - a);

    const groups = [];
    for (const d of vals) {
      const group = candidates
        .filter((j) => Math.abs(distance(x, instance.offline[j]) - d) <= eps)
        .sort((a, b) => a - b);
      if (group.length > 0) {
        groups.push(group);
      }
    }
    return groups;
  }

  function buildOutermostLayers(instance, candidates) {
    const sorted = sortByPosition(instance, candidates);
    const groups = [];
    let l = 0;
    let r = sorted.length - 1;

    while (l <= r) {
      if (l === r) {
        groups.push([sorted[l]]);
      } else {
        groups.push([sorted[l], sorted[r]]);
      }
      l += 1;
      r -= 1;
    }

    return groups;
  }

  function distributeAcrossGroup(group, demandLeft, remainingCap, assignments) {
    let active = group.filter((j) => remainingCap[j] > 1e-12);
    let demand = demandLeft;

    while (demand > 1e-12 && active.length > 0) {
      const minCap = Math.min(...active.map((j) => remainingCap[j]));
      const equalChunk = Math.min(minCap, demand / active.length);

      for (const j of active) {
        remainingCap[j] -= equalChunk;
        assignments[j] = (assignments[j] || 0) + equalChunk;
      }

      demand -= equalChunk * active.length;
      active = active.filter((j) => remainingCap[j] > 1e-12);
    }

    return demand;
  }

  function integralSingleChoice(instance, i, candidates, algorithm, rng) {
    if (algorithm === "greedy-nearest") {
      const x = instance.online[i];
      return candidates.reduce((best, cur) => {
        const db = distance(x, instance.offline[best]);
        const dc = distance(x, instance.offline[cur]);
        if (dc < db || (dc === db && cur < best)) {
          return cur;
        }
        return best;
      });
    }

    if (algorithm === "greedy-first") {
      return Math.min(...candidates);
    }

    if (algorithm === "random") {
      return candidates[Math.floor(rng() * candidates.length)];
    }

    throw new Error(`Unsupported integral algorithm: ${algorithm}`);
  }

  function fractionalAssignmentsForArrival(instance, i, candidates, algorithm, remainingCap) {
    let groups = [];

    if (algorithm === "alg1-outermost-balanced") {
      // Outermost pair is the only active priority level for this arrival.
      const sorted = sortByPosition(instance, candidates);
      const left = sorted[0];
      const right = sorted[sorted.length - 1];
      groups = left === right ? [[left]] : [[left, right]];
    } else if (algorithm === "alg2-priority-outer") {
      // Outside-in priority queue by geometric position.
      groups = buildOutermostLayers(instance, candidates);
    } else if (algorithm === "alg2-priority-distance") {
      // Furthest-distance-first priority queue.
      groups = uniqueByDistanceDescending(instance, i, candidates);
    } else {
      throw new Error(`Unsupported fractional algorithm: ${algorithm}`);
    }

    const assignments = {};
    let demandLeft = 1.0;

    for (const group of groups) {
      if (demandLeft <= 1e-12) {
        break;
      }
      demandLeft = distributeAcrossGroup(group, demandLeft, remainingCap, assignments);
    }

    return { assignments, demandLeft };
  }

  const ALGORITHMS = [
    { key: "greedy-nearest", label: "Greedy nearest (integral)", mode: "integral" },
    { key: "greedy-first", label: "Greedy first (integral)", mode: "integral" },
    { key: "random", label: "Random (integral)", mode: "integral" },
    { key: "alg1-outermost-balanced", label: "Alg 1 (fractional): Outermost equal-rate", mode: "fractional" },
    { key: "alg2-priority-outer", label: "Alg 2 Opt 1 (fractional): Outer-layer queue", mode: "fractional" },
    { key: "alg2-priority-distance", label: "Alg 2 Opt 2 (fractional): Distance-priority queue", mode: "fractional" },
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

    for (let i = 0; i < instance.online.length; i++) {
      const x = instance.online[i];
      const candidates = instance.offline
        .map((y, j) => ({ j, ok: distance(x, y) <= instance.radius && remainingCap[j] > 1e-12 }))
        .filter((v) => v.ok)
        .map((v) => v.j);

      if (candidates.length === 0) {
        continue;
      }

      if (meta.mode === "integral") {
        const j = integralSingleChoice(instance, i, candidates, algorithm, rng);
        const w = Math.min(1.0, remainingCap[j]);
        if (w > 1e-12) {
          remainingCap[j] -= w;
          onlineAssigned[i] += w;
          matches.push({ i, j, w, d: distance(x, instance.offline[j]) });
        }
        continue;
      }

      const { assignments } = fractionalAssignmentsForArrival(
        instance,
        i,
        candidates,
        algorithm,
        remainingCap
      );

      for (const key of Object.keys(assignments)) {
        const j = Number(key);
        const w = assignments[j];
        if (w > 1e-12) {
          onlineAssigned[i] += w;
          matches.push({ i, j, w, d: distance(instance.online[i], instance.offline[j]) });
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
