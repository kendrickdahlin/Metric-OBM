#!/usr/bin/env python3
"""Online bipartite matching simulator in 1D Euclidean metric (R)."""

from __future__ import annotations

import argparse
import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


@dataclass
class Instance:
    offline: list[float]
    online: list[float]
    radius: float


@dataclass
class MatchResult:
    algorithm: str
    matches: list[tuple[int, int, float]]  # (online_idx, offline_idx, distance)
    unmatched_online: list[int]
    unmatched_offline: list[int]
    offline_optimum_cardinality: int

    @property
    def cardinality(self) -> int:
        return len(self.matches)

    @property
    def competitive_ratio(self) -> float:
        if self.offline_optimum_cardinality == 0:
            return 1.0
        return self.cardinality / self.offline_optimum_cardinality


def load_instance(path: Path) -> Instance:
    payload = json.loads(path.read_text())
    required = {"offline", "online", "radius"}
    missing = sorted(required - set(payload.keys()))
    if missing:
        raise ValueError(f"Missing field(s): {', '.join(missing)}")

    offline = [float(x) for x in payload["offline"]]
    online = [float(x) for x in payload["online"]]
    radius = float(payload["radius"])
    if radius < 0:
        raise ValueError("radius must be non-negative")

    return Instance(offline=offline, online=online, radius=radius)


def distance(x: float, y: float) -> float:
    return abs(x - y)


def neighbors(instance: Instance, online_pos: float, unmatched_offline: set[int]) -> list[int]:
    r = instance.radius
    # In the metric-threshold model, feasible edges are exactly those within radius r.
    return [
        j
        for j in unmatched_offline
        if distance(online_pos, instance.offline[j]) <= r
    ]

# ALGORITHMS
def greedy_nearest(instance: Instance, i: int, candidates: list[int]) -> int:
    x = instance.online[i]
    return min(candidates, key=lambda j: (distance(x, instance.offline[j]), j))


def greedy_first(instance: Instance, _i: int, candidates: list[int]) -> int:
    return min(candidates)


def random_choice(_instance: Instance, _i: int, candidates: list[int]) -> int:
    return random.choice(candidates)


ALGORITHMS: dict[str, Callable[[Instance, int, list[int]], int] | None] = {
    "greedy-nearest": greedy_nearest,
    "greedy-first":   greedy_first,
    "random":         random_choice,
    "ranking":        None,  # rank is sampled once before the run; see run()
}


def offline_optimum_cardinality(instance: Instance) -> int:
    """Maximum matching cardinality in the full threshold graph (not online-constrained)."""
    n_left = len(instance.online)
    n_right = len(instance.offline)
    adj: list[list[int]] = []
    for x in instance.online:
        nbrs = [j for j, y in enumerate(instance.offline) if distance(x, y) <= instance.radius]
        adj.append(nbrs)

    match_right: list[int] = [-1] * n_right

    def dfs(u: int, seen: list[bool]) -> bool:
        for v in adj[u]:
            if seen[v]:
                continue
            seen[v] = True
            if match_right[v] == -1 or dfs(match_right[v], seen):
                match_right[v] = u
                return True
        return False

    size = 0
    for u in range(n_left):
        seen = [False] * n_right
        if dfs(u, seen):
            size += 1
    return size


def run(instance: Instance, algorithm: str, seed: int | None = None) -> MatchResult:
    if algorithm not in ALGORITHMS:
        raise ValueError(f"Unknown algorithm '{algorithm}'. Choices: {', '.join(sorted(ALGORITHMS))}")

    if seed is not None:
        random.seed(seed)

    if algorithm == "ranking":
        # Draw a uniformly random permutation once, before any arrivals.
        n    = len(instance.offline)
        rank = list(range(n))
        random.shuffle(rank)
        pick = lambda _inst, _i, cands: min(cands, key=lambda j: rank[j])
    else:
        pick = ALGORITHMS[algorithm]
    unmatched_offline = set(range(len(instance.offline)))
    matches: list[tuple[int, int, float]] = []
    unmatched_online: list[int] = []

    # Online vertices are processed in arrival order; each offline vertex can be used at most once.
    for i, x in enumerate(instance.online):
        cands = neighbors(instance, x, unmatched_offline)
        if not cands:
            unmatched_online.append(i)
            continue

        j = pick(instance, i, cands)
        d = distance(x, instance.offline[j])
        matches.append((i, j, d))
        unmatched_offline.remove(j)

    return MatchResult(
        algorithm=algorithm,
        matches=matches,
        unmatched_online=unmatched_online,
        unmatched_offline=sorted(unmatched_offline),
        offline_optimum_cardinality=offline_optimum_cardinality(instance),
    )


def print_result(instance: Instance, result: MatchResult) -> None:
    print(f"Algorithm: {result.algorithm}")
    print(f"Radius: {instance.radius}")
    print(f"Offline vertices: {len(instance.offline)}")
    print(f"Online arrivals: {len(instance.online)}")
    print(f"Matched: {result.cardinality}")
    print(f"Offline optimum matched: {result.offline_optimum_cardinality}")
    print(f"Competitive ratio (ALG/OPT): {result.competitive_ratio:.6f}")
    print(f"Unmatched online: {len(result.unmatched_online)}")
    print(f"Unmatched offline: {len(result.unmatched_offline)}")

    print("\nMatches (online_idx -> offline_idx | online_value -> offline_value | dist):")
    if not result.matches:
        print("  (none)")
    for i, j, d in result.matches:
        print(
            f"  {i} -> {j} | {instance.online[i]:.6f} -> {instance.offline[j]:.6f} | {d:.6f}"
        )


# ---------------------------------------------------------------------------
# Generalized Random Linear Rank (RLR)
# ---------------------------------------------------------------------------

def run_rlr(
    offline: list[float],
    online_sequence: list[float],
    start_index: int,
    direction: str,
    radius: float = 1.0,
) -> tuple[list[tuple[int, int]], list[int], list[float]]:
    """Run RLR for a fixed starting node and direction.

    Offline nodes are sorted by position: l_1 ≤ l_2 ≤ … ≤ l_n.
    ``start_index`` is the 0-based index into that sorted list (i.e. l_{s+1}).
    ``direction`` is ``'right'`` or ``'left'``.

    Right ranking: l_s, l_{s+1}, …, l_n, l_1, …, l_{s-1}  (cyclically increasing)
    Left  ranking: l_s, l_{s-1}, …, l_1, l_n, …, l_{s+1}  (cyclically decreasing)

    Returns:
        matches           – list of (online_idx, offline_original_idx)
        unmatched_online  – list of online indices that could not be matched
        ranking_positions – offline positions listed in priority order (rank 0 first)
    """
    n = len(offline)
    # Indices of offline nodes sorted by position.
    sorted_orig = sorted(range(n), key=lambda j: offline[j])

    # rank[original_idx] = priority  (0 = highest, i.e. matched first).
    rank: list[int] = [0] * n
    ranking_positions: list[float] = []
    for k in range(n):
        pos = (start_index + k) % n if direction == "right" else (start_index - k) % n
        orig = sorted_orig[pos]
        rank[orig] = k
        ranking_positions.append(offline[orig])

    # Run the online matching.
    available: set[int] = set(range(n))
    matches:           list[tuple[int, int]] = []
    unmatched_online:  list[int]             = []

    for i, x in enumerate(online_sequence):
        candidates = [j for j in available if abs(x - offline[j]) <= radius]
        if not candidates:
            unmatched_online.append(i)
            continue
        # Match to the highest-priority (lowest-rank) available neighbour.
        j = min(candidates, key=lambda j: rank[j])
        matches.append((i, j))
        available.remove(j)

    return matches, unmatched_online, ranking_positions


def analyze_rlr(
    offline: list[float],
    online_sequence: list[float],
    opt: int,
    radius: float = 1.0,
) -> float:
    """Run all 2n RLR combinations, print per-combination details, and return
    the expected ratio (average matched / OPT over all 2n combinations).

    Args:
        offline:         Offline node positions (need not be pre-sorted).
        online_sequence: Online node positions in arrival order.
        opt:             Known offline optimum cardinality.
        radius:          Edge-existence threshold (default 1.0).
    """
    n = len(offline)
    sorted_offline = sorted(offline)
    total_combinations = 2 * n

    print(f"Offline nodes (sorted): {sorted_offline}")
    print(f"Online arrival order:   {online_sequence}")
    print(f"OPT = {opt}  |  Radius = {radius}")
    print(f"Running all {total_combinations} combinations  "
          f"({n} starting nodes × 2 directions)")
    print("=" * 72)

    total_ratio = 0.0
    for start_index in range(n):
        for direction in ("right", "left"):
            matches, unmatched_online, ranking = run_rlr(
                offline, online_sequence, start_index, direction, radius
            )
            num_matched = len(matches)
            ratio       = num_matched / opt if opt > 0 else 1.0
            total_ratio += ratio

            start_val     = sorted_offline[start_index]
            matched_online = sorted(i for i, _j in matches)

            print(f"\n  Start: l_{start_index + 1} = {start_val}  |  Direction: {direction}")
            print(f"  Ranking:          {ranking}")
            print(f"  Matches (u→o):    {[(i, j) for i, j in matches]}")
            print(f"  Matched online:   {matched_online}")
            print(f"  Unmatched online: {unmatched_online}")
            print(f"  Ratio:            {num_matched}/{opt} = {ratio:.6f}")

    expected_ratio = total_ratio / total_combinations
    print()
    print("=" * 72)
    print(f"Expected ratio over all {total_combinations} combinations: "
          f"{expected_ratio:.6f}")
    return expected_ratio


def _test_rlr_instances() -> None:
    """Run analyze_rlr on the two built-in test instances."""
    sep = "=" * 72

    print(sep)
    print("Instance 1  (5 offline nodes, 5 online nodes, OPT = 5)")
    print(sep)
    offline1 = [-0.2, -0.1, 1.0, 2.1, 2.2]
    online1  = [0.0,   2.0, -1.2, 1.0, 3.2]
    analyze_rlr(offline1, online1, opt=5)

    print()
    print(sep)
    print("Instance 2  (7 offline nodes, 7 online nodes, OPT = 7)")
    print(sep)
    offline2 = [-0.2, -0.1, 1.0, 2.0, 3.0, 4.1, 4.2]
    online2  = [0.0,   2.0,  3.8, -1.2, 1.0, 3.0, 5.2]
    analyze_rlr(offline2, online2, opt=7)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input", type=Path, nargs="?", default=None,
                   help="Path to JSON instance (not required with --test-rlr)")
    p.add_argument(
        "--algorithm",
        default="greedy-nearest",
        choices=sorted(ALGORITHMS.keys()),
        help="Online matching rule",
    )
    p.add_argument(
        "--seed",
        type=int,
        default=None,
        help="RNG seed (only needed for random algorithm)",
    )
    p.add_argument(
        "--test-rlr",
        action="store_true",
        help="Run generalized RLR analysis on built-in test instances and exit",
    )
    return p


def main() -> None:
    parser = build_parser()
    args   = parser.parse_args()

    if args.test_rlr:
        _test_rlr_instances()
        return

    if args.input is None:
        parser.error("the following arguments are required: input")

    instance = load_instance(args.input)
    result   = run(instance, args.algorithm, seed=args.seed)
    print_result(instance, result)


if __name__ == "__main__":
    main()
