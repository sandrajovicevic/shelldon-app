/*
 * Shared pixel-art design for Shelldon, the deadpan-but-helpful decision shell.
 * Pure function, no DOM/Node APIs, so it works identically in the browser
 * (live SVG rendering) and in the Node icon-generation script.
 */
(function (root) {
  var GRID = 32;

  var COLORS = {
    bg: '#14141f',
    outline: '#0a0a12',
    teal: '#8fe3dc',
    tealDark: '#5cb8b0',
    tealHighlight: '#c9f5f0',
    pink: '#ff6ec7',
    pinkSoft: '#ffb3e6',
    white: '#f5f7ff',
    black: '#12121a',
    transparent: null,
  };

  function normDiff(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  // Builds a GRID x GRID array of hex colors (or null = transparent) for the
  // given expression state. States: idle, shake, reveal, annoyed, pleased.
  function buildGrid(opts) {
    opts = opts || {};
    var state = opts.state || 'idle';
    var transparentBg = !!opts.transparentBg;

    var cx = 16, cy = 21.5, Rbase = 13.5, rippleAmp = 0.55, scallops = 7;
    var fanAngles = [18, 45, 72, 99, 126, 153].map(function (d) { return (d * Math.PI) / 180; });

    var grid = [];
    for (var gy = 0; gy < GRID; gy++) {
      var row = [];
      for (var gx = 0; gx < GRID; gx++) {
        var dx = gx - cx + 0.5;
        var dy = gy - cy + 0.5;
        var cell = transparentBg ? COLORS.transparent : COLORS.bg;

        if (dy <= 1.1) {
          var r = Math.sqrt(dx * dx + dy * dy);
          var angle = Math.atan2(-dy + 0.0001, dx);
          if (angle >= -0.35 && angle <= Math.PI + 0.35) {
            var edge = Rbase + rippleAmp * Math.sin(angle * scallops);
            if (r <= edge) {
              cell = COLORS.teal;
              // outline near boundary
              if (edge - r < 0.85) {
                cell = COLORS.outline;
              } else {
                // fan ridge lines
                var onRidge = false;
                for (var i = 0; i < fanAngles.length; i++) {
                  if (Math.abs(normDiff(angle, fanAngles[i])) < 0.08 && r > 2.2) {
                    onRidge = true;
                    break;
                  }
                }
                if (onRidge) {
                  cell = COLORS.pink;
                } else if (angle > 1.75 && angle < 2.45 && r > edge * 0.45 && r < edge * 0.8) {
                  cell = COLORS.tealHighlight;
                }
              }
            }
          }
        }
        row.push(cell);
      }
      grid.push(row);
    }

    paintFace(grid, state);
    return grid;
  }

  function setPx(grid, x, y, color) {
    if (y >= 0 && y < GRID && x >= 0 && x < GRID) grid[y][x] = color;
  }

  function paintFace(grid, state) {
    var leftEyeX = 11, rightEyeX = 21, eyeY = 15;

    [leftEyeX, rightEyeX].forEach(function (ex) {
      if (state === 'shake') {
        // scrunched shut: a curved dark line
        setPx(grid, ex - 1, eyeY, COLORS.black);
        setPx(grid, ex, eyeY - 1, COLORS.black);
        setPx(grid, ex + 1, eyeY, COLORS.black);
        return;
      }

      // eyeball (white)
      for (var yy = -1; yy <= 1; yy++) {
        for (var xx = -1; xx <= 1; xx++) {
          setPx(grid, ex + xx, eyeY + yy, COLORS.white);
        }
      }

      var lidRows = state === 'annoyed' || state === 'fed_up' ? 2 : 1;
      for (var l = 0; l < lidRows; l++) {
        setPx(grid, ex - 1, eyeY - 1 + l, COLORS.black);
        setPx(grid, ex, eyeY - 1 + l, COLORS.black);
        setPx(grid, ex + 1, eyeY - 1 + l, COLORS.black);
      }

      // pupil
      var pupilY = state === 'annoyed' || state === 'fed_up' ? eyeY + 1 : eyeY;
      setPx(grid, ex, pupilY, COLORS.black);

      // furrowed brow converging toward center, for the fully-done-with-you look
      if (state === 'fed_up') {
        var innerDir = ex === leftEyeX ? 1 : -1;
        setPx(grid, ex + innerDir, eyeY - 2, COLORS.black);
      }
    });

    // mouth: flat deadpan line, with subtle variants per state
    var mouthY = 19;
    if (state === 'pleased') {
      setPx(grid, 13, mouthY, COLORS.black);
      setPx(grid, 14, mouthY, COLORS.black);
      setPx(grid, 15, mouthY, COLORS.black);
      setPx(grid, 16, mouthY, COLORS.black);
      setPx(grid, 17, mouthY, COLORS.black);
      setPx(grid, 18, mouthY + 1, COLORS.black); // slight upturn on one side
    } else if (state === 'annoyed') {
      setPx(grid, 13, mouthY + 1, COLORS.black);
      setPx(grid, 14, mouthY, COLORS.black);
      setPx(grid, 15, mouthY, COLORS.black);
      setPx(grid, 16, mouthY, COLORS.black);
      setPx(grid, 17, mouthY, COLORS.black);
      setPx(grid, 18, mouthY, COLORS.black);
    } else if (state === 'fed_up') {
      setPx(grid, 13, mouthY + 2, COLORS.black);
      setPx(grid, 14, mouthY + 1, COLORS.black);
      setPx(grid, 15, mouthY, COLORS.black);
      setPx(grid, 16, mouthY, COLORS.black);
      setPx(grid, 17, mouthY + 1, COLORS.black);
      setPx(grid, 18, mouthY + 2, COLORS.black);
    } else if (state === 'shake') {
      setPx(grid, 15, mouthY, COLORS.black);
      setPx(grid, 16, mouthY, COLORS.black);
      setPx(grid, 15, mouthY + 1, COLORS.black);
      setPx(grid, 16, mouthY + 1, COLORS.black);
    } else {
      for (var mx = 13; mx <= 18; mx++) setPx(grid, mx, mouthY, COLORS.black);
    }

    // pink cheek blush, subtle (skipped for fed_up -- not a blushing moment)
    if (state !== 'fed_up') {
      setPx(grid, leftEyeX - 2, eyeY + 2, COLORS.pinkSoft);
      setPx(grid, rightEyeX + 2, eyeY + 2, COLORS.pinkSoft);
    }

    if (state === 'reveal') {
      setPx(grid, 25, 8, COLORS.pink);
      setPx(grid, 26, 7, COLORS.pinkSoft);
    }

    if (state === 'fed_up') {
      // small irritation marks, top-left
      setPx(grid, 8, 6, COLORS.pink);
      setPx(grid, 9, 7, COLORS.pink);
      setPx(grid, 7, 8, COLORS.pink);
    }
  }

  var api = { GRID: GRID, COLORS: COLORS, buildGrid: buildGrid };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ShellDesign = api;
  }
})(typeof window !== 'undefined' ? window : this);
