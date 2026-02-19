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


ALGORITHMS: dict[str, Callable[[Instance, int, list[int]], int]] = {
    "greedy-nearest": greedy_nearest,
    "greedy-first": greedy_first,
    "random": random_choice,
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


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input", type=Path, help="Path to JSON instance")
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
    return p


def main() -> None:
    args = build_parser().parse_args()
    instance = load_instance(args.input)
    result = run(instance, args.algorithm, seed=args.seed)
    print_result(instance, result)


if __name__ == "__main__":
    main()
