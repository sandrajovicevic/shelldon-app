/*
 * Shared pixel-art design for Shelldon, the deadpan-but-helpful decision shell.
 * Pure function, no DOM/Node APIs, so it works identically in the browser
 * (live SVG rendering) and in the Node icon-generation script.
 */
(function (root) {
  var GRID = 36;

  var COLORS = {
    bg: '#f5eae0',
    outline: '#3a2015',
    shell: '#e67a3f',
    shellDark: '#b8551f',
    shellDarker: '#8f3f18',
    shellHighlight: '#f5a066',
    wrap: '#7fa88f',
    wrapDark: '#587d64',
    white: '#f5f7ff',
    black: '#2a1a12',
    blush: '#e8785a',
    transparent: null,
  };

  // Half-width of the shell silhouette at a given grid row: a short pointed
  // nub on top blending into one big rounded dome -- an onion/shell profile,
  // not a tall tapering kite.
  function shellHalfWidth(y) {
    var spireTop = 8, seam = 14, bodyBottom = 34;
    if (y < spireTop || y > bodyBottom) return 0;

    if (y <= seam) {
      var t = (y - spireTop) / (seam - spireTop); // 0..1
      var eased = 1 - Math.cos((t * Math.PI) / 2); // slow start, curves out near the seam
      return 1 + eased * 6; // ~1px tip growing to ~7 at the seam
    }

    var seamW = 7, bulgeMax = 17, peakT = 0.24;
    var t2 = (y - seam) / (bodyBottom - seam); // 0..1
    if (t2 <= peakT) {
      var t3 = t2 / peakT;
      return seamW + (bulgeMax - seamW) * (1 - Math.cos(t3 * Math.PI)) / 2;
    }
    var t4 = (t2 - peakT) / (1 - peakT);
    return 2 + (bulgeMax - 2) * Math.cos((t4 * Math.PI) / 2);
  }

  function buildGrid(opts) {
    opts = opts || {};
    var state = opts.state || 'idle';
    var transparentBg = !!opts.transparentBg;
    var cx = GRID / 2;

    var grid = [];
    for (var gy = 0; gy < GRID; gy++) {
      var row = [];
      var halfW = shellHalfWidth(gy + 0.5);
      for (var gx = 0; gx < GRID; gx++) {
        var dx = gx + 0.5 - cx;
        var cell = transparentBg ? COLORS.transparent : COLORS.bg;

        if (halfW > 0 && Math.abs(dx) <= halfW) {
          if (halfW - Math.abs(dx) < 0.9) {
            cell = COLORS.outline;
          } else {
            // directional shading: light upper-left, mid, dark lower-right
            var lightness = -dx / (halfW || 1); // -1 (right edge) .. 1 (left edge)
            if (lightness > 0.45) cell = COLORS.shellHighlight;
            else if (lightness > -0.25) cell = COLORS.shell;
            else if (lightness > -0.7) cell = COLORS.shellDark;
            else cell = COLORS.shellDarker;
          }
        }
        row.push(cell);
      }
      grid.push(row);
    }

    paintSpiralHint(grid);
    paintWrap(grid, state);
    paintFace(grid, state);
    return grid;
  }

  function setPx(grid, x, y, color) {
    if (y >= 0 && y < GRID && x >= 0 && x < GRID) grid[y][x] = color;
  }

  function paintSpiralHint(grid) {
    var cx = GRID / 2;
    setPx(grid, cx, 8, COLORS.outline);
    setPx(grid, cx - 1, 9, COLORS.shellDark);
    setPx(grid, cx, 10, COLORS.shellDark);
  }

  function paintWrap(grid, state) {
    var cx = GRID / 2;
    var top = 30, bottom = 33;
    for (var gy = top; gy <= bottom; gy++) {
      var halfW = shellHalfWidth(gy + 0.5) - 1;
      var left = cx - halfW, right = cx + halfW;
      var v = (gy - top) / (bottom - top || 1);
      for (var gx = 0; gx < GRID; gx++) {
        var dx = gx + 0.5 - cx;
        if (Math.abs(dx) <= halfW) {
          var u = (gx + 0.5 - left) / ((right - left) || 1);
          var onCrossA = Math.abs(u - v) < 0.14;
          var onCrossB = Math.abs(u - (1 - v)) < 0.14;
          setPx(grid, gx, gy, (onCrossA || onCrossB) ? COLORS.wrapDark : COLORS.wrap);
        }
      }
    }
    for (var gx2 = 0; gx2 < GRID; gx2++) {
      var dx2 = gx2 + 0.5 - cx;
      if (Math.abs(dx2) <= shellHalfWidth(top + 0.5) - 1) setPx(grid, gx2, top, COLORS.wrapDark);
      if (Math.abs(dx2) <= shellHalfWidth(bottom + 0.5) - 1) setPx(grid, gx2, bottom, COLORS.wrapDark);
    }
  }

  function paintFace(grid, state) {
    var leftEyeX = 11, rightEyeX = 25, eyeY = 23;

    [leftEyeX, rightEyeX].forEach(function (ex) {
      if (state === 'shake') {
        setPx(grid, ex - 1, eyeY, COLORS.black);
        setPx(grid, ex, eyeY - 1, COLORS.black);
        setPx(grid, ex + 1, eyeY, COLORS.black);
        return;
      }

      // wide almond-shaped socket: white base, heavy lid from the top,
      // only a sliver visible at rest -- Shelldon is always half asleep.
      for (var yy = -1; yy <= 2; yy++) {
        for (var xx = -2; xx <= 2; xx++) {
          setPx(grid, ex + xx, eyeY + yy, COLORS.white);
        }
      }
      setPx(grid, ex - 2, eyeY - 1, COLORS.transparent);
      setPx(grid, ex + 2, eyeY - 1, COLORS.transparent);
      setPx(grid, ex - 2, eyeY + 2, COLORS.transparent);
      setPx(grid, ex + 2, eyeY + 2, COLORS.transparent);

      var lidRows = (state === 'annoyed' || state === 'fed_up') ? 3 : 2;
      for (var l = -1; l < lidRows - 1; l++) {
        for (var lx = -1; lx <= 1; lx++) setPx(grid, ex + lx, eyeY + l, COLORS.black);
      }
      setPx(grid, ex - 1, eyeY - 1, COLORS.black);
      setPx(grid, ex + 1, eyeY - 1, COLORS.black);

      var pupilY = eyeY + 2;
      setPx(grid, ex, pupilY, COLORS.black);
      setPx(grid, ex - 1, pupilY, COLORS.black);

      if (state === 'fed_up') {
        var innerDir = ex === leftEyeX ? 1 : -1;
        setPx(grid, ex + innerDir, eyeY - 2, COLORS.black);
        setPx(grid, ex + innerDir * 2, eyeY - 1, COLORS.black);
      }
    });

    var mouthY = 28;
    if (state === 'pleased') {
      setPx(grid, 15, mouthY, COLORS.black);
      setPx(grid, 16, mouthY, COLORS.black);
      setPx(grid, 17, mouthY, COLORS.black);
      setPx(grid, 18, mouthY, COLORS.black);
      setPx(grid, 19, mouthY, COLORS.black);
      setPx(grid, 20, mouthY + 1, COLORS.black);
    } else if (state === 'annoyed') {
      setPx(grid, 15, mouthY + 1, COLORS.black);
      setPx(grid, 16, mouthY, COLORS.black);
      setPx(grid, 17, mouthY, COLORS.black);
      setPx(grid, 18, mouthY, COLORS.black);
      setPx(grid, 19, mouthY, COLORS.black);
      setPx(grid, 20, mouthY, COLORS.black);
    } else if (state === 'fed_up') {
      setPx(grid, 15, mouthY + 2, COLORS.black);
      setPx(grid, 16, mouthY + 1, COLORS.black);
      setPx(grid, 17, mouthY, COLORS.black);
      setPx(grid, 18, mouthY, COLORS.black);
      setPx(grid, 19, mouthY + 1, COLORS.black);
      setPx(grid, 20, mouthY + 2, COLORS.black);
    } else if (state === 'shake') {
      setPx(grid, 17, mouthY, COLORS.black);
      setPx(grid, 18, mouthY, COLORS.black);
      setPx(grid, 17, mouthY + 1, COLORS.black);
      setPx(grid, 18, mouthY + 1, COLORS.black);
    } else {
      for (var mx = 15; mx <= 20; mx++) setPx(grid, mx, mouthY, COLORS.black);
    }

    if (state !== 'fed_up') {
      setPx(grid, leftEyeX - 2, eyeY + 3, COLORS.blush);
      setPx(grid, rightEyeX + 2, eyeY + 3, COLORS.blush);
    }

    if (state === 'reveal') {
      setPx(grid, 29, 9, COLORS.wrap);
      setPx(grid, 30, 8, COLORS.wrap);
    }

    if (state === 'fed_up') {
      setPx(grid, 6, 9, COLORS.shellDarker);
      setPx(grid, 7, 10, COLORS.shellDarker);
      setPx(grid, 5, 11, COLORS.shellDarker);
    }
  }

  var api = { GRID: GRID, COLORS: COLORS, buildGrid: buildGrid };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ShellDesign = api;
  }
})(typeof window !== 'undefined' ? window : this);
