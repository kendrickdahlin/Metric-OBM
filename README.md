# Online Bipartite Matching Simulator (Metric on R)

This project simulates online bipartite matching where:
- Offline vertices are fixed points in `R` (real line).
- Online vertices arrive one-by-one in a fixed order.
- An arrival is adjacent to every currently-unmatched offline vertex within radius `r`.
- Distance is Euclidean in 1D: `|x - y|`.

## Input format
Create a JSON file like:

```json
{
  "offline": [0.0, 1.2, 2.6, 5.0],
  "online": [0.4, 1.7, 2.1, 4.6, 5.4],
  "radius": 0.9
}
```

- `offline`: positions of offline vertices.
- `online`: online arrivals in order.
- `radius`: adjacency threshold.

## Run

```bash
python3 simulator.py examples/basic.json
```

Choose an algorithm:

```bash
python3 simulator.py examples/basic.json --algorithm greedy-nearest
python3 simulator.py examples/basic.json --algorithm greedy-first
python3 simulator.py examples/basic.json --algorithm random --seed 7
```

## Visual simulator

Open `/Users/dahlink/Desktop/Thesis/visual_simulator.html` in your browser.

In the app you can:
- set offline/online counts,
- type exact positions on the real line,
- set radius `r`,
- choose an algorithm,
- generate random positions from a numeric range,
- run the algorithm and see the matching drawn,
- save/load JSON instances.
It reports competitive ratio (`ALG/OPT`) using offline optimum matching cardinality.

Algorithm definitions for the browser simulator are in:

- `/Users/dahlink/Desktop/Thesis/algorithms.js`

This keeps algorithm logic separate from UI markup in `visual_simulator.html`.

New algorithms added:
- `Alg 1 (fractional): Outermost equal-rate` (`alg1-outermost-balanced`)
- `Alg 2 Opt 1 (fractional): Outer-layer queue` (`alg2-priority-outer`)
- `Alg 2 Opt 2 (fractional): Distance-priority queue` (`alg2-priority-distance`)

For fractional algorithms, assignments are weighted and must satisfy:
- each online arrival sends at most weight `1`,
- each offline node receives at most weight `1`,
- nodes with equal priority receive equal-rate weight.

## Built-in algorithms
- `greedy-nearest`: match each arrival to the nearest feasible unmatched offline vertex.
- `greedy-first`: match to the feasible unmatched offline vertex with smallest index.
- `random`: match uniformly at random among feasible unmatched offline vertices.

## Output metrics
The simulator reports:
- matching cardinality,
- offline optimum matching cardinality,
- competitive ratio (`ALG/OPT`),
- unmatched counts on each side,
- full match list.

## Extend
To add a new online rule, add a function in `simulator.py` with signature:

```python
def my_algorithm(instance: Instance, i: int, candidates: list[int]) -> int:
    ...
```

Then register it in `ALGORITHMS`.
