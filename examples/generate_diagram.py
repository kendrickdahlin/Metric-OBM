import json, sys

# ---------------------------------------------------------------------------
#  Layout constants
# ---------------------------------------------------------------------------

DIAGRAM_WIDTH_CM = 14.0
MARGIN_CM        = 0.8
Y_ONLINE         = 2.5
Y_OFFLINE        = 0.0
RADIUS_ONLINE    = 0.28
RADIUS_OFFLINE   = 0.22

# ---------------------------------------------------------------------------
#  Colour definitions
# ---------------------------------------------------------------------------

COLOURS = [
    r"\providecolor{onlinecol}{RGB}{220, 60, 60}",
    r"\providecolor{offlinecol}{RGB}{50, 100, 200}",
    r"\providecolor{edgecol}{RGB}{180, 200, 230}",
    r"\providecolor{matchcol}{RGB}{50, 160, 80}",
    r"\providecolor{labelgray}{RGB}{140, 140, 140}",
]

# ---------------------------------------------------------------------------
#  Coordinate helpers
# ---------------------------------------------------------------------------

def make_scaler(x_min, x_max):
    """Map real positions to cm coordinates."""
    x_range = x_max - x_min if x_max != x_min else 1.0
    scale   = DIAGRAM_WIDTH_CM / x_range
    shift   = x_min - MARGIN_CM / scale
    return lambda pos: round((pos - shift) * scale, 4)


def compute_edges(online, offline, radius):
    """Return all (online_pos, offline_pos) pairs within radius."""
    return [(r, l) for r in online for l in offline if abs(r - l) <= radius]


def is_matched(r, l, matching):
    """Return True if (online_pos, offline_pos) is in the matching."""
    return matching and any(
        abs(r - mr) < 1e-9 and abs(l - ml) < 1e-9
        for (mr, ml) in matching
    )

# ---------------------------------------------------------------------------
#  LaTeX block generators
# ---------------------------------------------------------------------------

def edge_lines(edges, xc, matching):
    lines = [
        "    % Edges (gray) and matched edges (green, thick)",
        r"    \tikzset{matchedge/.style={draw=edgecol, line width=0.4pt}}",
        r"    \tikzset{matchededge/.style={draw=matchcol, line width=1.5pt}}",
    ]
    # Draw unmatched edges first, matched edges on top
    for (r, l) in edges:
        if not is_matched(r, l, matching):
            lines.append(
                f"    \\draw[matchedge] ({xc(r)}cm, {Y_ONLINE}cm)"
                f" -- ({xc(l)}cm, {Y_OFFLINE}cm);"
            )
    for (r, l) in edges:
        if is_matched(r, l, matching):
            lines.append(
                f"    \\draw[matchededge] ({xc(r)}cm, {Y_ONLINE}cm)"
                f" -- ({xc(l)}cm, {Y_OFFLINE}cm);"
            )
    return lines


def number_line_lines(x_left, x_right):
    return [
        "    % Number lines",
        f"    \\draw[onlinecol,  line width=1.2pt]"
        f" ({x_left}cm, {Y_ONLINE}cm) -- ({x_right}cm, {Y_ONLINE}cm);",
        f"    \\draw[offlinecol, line width=1.2pt]"
        f" ({x_left}cm, {Y_OFFLINE}cm) -- ({x_right}cm, {Y_OFFLINE}cm);",
    ]


def axis_label_lines(x_left):
    return [
        "    % Axis labels",
        f"    \\node[onlinecol,  font=\\small\\ttfamily, left]"
        f" at ({x_left}cm, {Y_ONLINE}cm) {{Online}};",
        f"    \\node[offlinecol, font=\\small\\ttfamily, left]"
        f" at ({x_left}cm, {Y_OFFLINE}cm) {{Offline}};",
    ]


def online_node_lines(online, xc):
    lines = ["    % Online nodes  (number inside circle = arrival order)"]
    for arrival, pos in enumerate(online, start=1):
        x = xc(pos)
        lines += [
            f"    \\fill[onlinecol] ({x}cm, {Y_ONLINE}cm) circle ({RADIUS_ONLINE}cm);",
            f"    \\node[white, font=\\tiny\\bfseries]"
            f" at ({x}cm, {Y_ONLINE}cm) {{{arrival}}};",
            f"    \\node[labelgray, font=\\tiny, above=4pt]"
            f" at ({x}cm, {Y_ONLINE+0.1}cm) {{{pos}}};",
        ]
    return lines


def offline_node_lines(offline, xc):
    lines = ["    % Offline nodes"]
    for pos in offline:
        x = xc(pos)
        lines += [
            f"    \\fill[offlinecol] ({x}cm, {Y_OFFLINE}cm) circle ({RADIUS_OFFLINE}cm);",
            f"    \\node[labelgray, font=\\tiny, below=4pt]"
            f" at ({x}cm, {Y_OFFLINE}cm) {{{pos}}};",
        ]
    return lines

# ---------------------------------------------------------------------------
#  Main generator
# ---------------------------------------------------------------------------

def generate_tikz(data, output_path):
    offline  = data["offline"]
    online   = data["online"]
    radius   = data["radius"]
    # matching is optional: list of [online_pos, offline_pos] pairs
    matching = [tuple(m) for m in data.get("matching", [])]

    all_pos = offline + online
    x_min, x_max = min(all_pos), max(all_pos)

    xc      = make_scaler(x_min, x_max)
    x_left  = xc(x_min) - MARGIN_CM
    x_right = xc(x_max) + MARGIN_CM
    edges   = compute_edges(online, offline, radius)

    lines = (
        ["% Bipartite matching diagram - requires tikz, xcolor, graphicx"]
        + COLOURS
        + ["", r"\resizebox{\textwidth}{!}{%", r"  \begin{tikzpicture}", ""]
        + edge_lines(edges, xc, matching)    + [""]
        + number_line_lines(x_left, x_right) + [""]
        # + axis_label_lines(x_left)           + [""]
        + online_node_lines(online, xc)      + [""]
        + offline_node_lines(offline, xc)    + [""]
        + [r"  \end{tikzpicture}", r"}% end resizebox"]
    )

    with open(output_path, "w") as f:
        f.write("\n".join(lines))
    print(f"Written: {output_path}")

# ---------------------------------------------------------------------------
#  Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 generate_diagram.py input.json [output.tex]")
        sys.exit(1)

    input_path  = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else input_path.replace(".json", ".tex")

    with open(input_path) as f:
        data = json.load(f)

    generate_tikz(data, output_path)