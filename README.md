# CassyCAS Symbolic Workstation

A precision instrument for symbolic mathematics, built with MathJS, MathLive, and Plotly.

## Features

- **Symbolic Algebra**: Simplification, expansion, factoring, and more.
- **Calculus**: Symbolic differentiation, antiderivatives, and numerical definite integration.
- **Solvers**: Multi-variable system solvers and root-finding using numerical methods.
- **Linear Algebra**: Matrix operations including inversion, determinants, and eigenvalues.
- **Plotting**: High-performance 2D and 3D plotting with Plotly.js.
- **Units**: Comprehensive dimensional analysis and unit conversions.
- **Dynamic Interface**:
  - Dual input modes (Monaco Editor / Visual MathField).
  - Categorized Command Palette (⌘ K).
  - Real-time live preview of expressions.
  - Automatic notebook refresh when toggling Exact/Approximate or Radian/Degree modes.
  - Workspace management with user-defined variables and functions.

## Usage

1. **Expressions**: Type expressions in the input area and press `Enter` to evaluate.
2. **Modes**: Switch between different mathematical disciplines using the sidebar.
3. **Definitions**: Define variables (e.g., `a = 10`) or functions (e.g., `f(x) = x^2`) to use them in subsequent cells.
4. **Toggles**: Use the top bar to switch between `Exact` and `Approx` modes, and `Rad` and `Deg` for trigonometry. Past cells will update automatically.
5. **Commands**: Press `⌘ K` to search for functions, constants, or switch modes.
6. **Plots**: Click the "Plot" button on math results to visualize them. Use the Plot tab for custom 2D/3D graphs.

## Tech Stack

- **MathJS**: Core mathematical engine.
- **MathLive**: Visual math input and rendering.
- **Plotly.js**: Interactive graphing.
- **Monaco Editor**: High-performance code input with syntax highlighting.
- **MathJax**: High-quality LaTeX rendering.
