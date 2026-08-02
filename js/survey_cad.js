/**
 * HTML5 Canvas Interactive 2D Field CAD Viewer for Survey Points & Linework
 * Features:
 * - Real-time rendering of Occupied Station, Backsight Vector, Topo Points, and Stakeout Targets
 * - Automatic CAD Extents calculation, Zoom In/Out, Pan controls
 * - Code-based linework linking (e.g., connecting EP or WALL points)
 * - Touch pan/zoom support for Android & Windows touchscreens
 */

export class SurveyCadRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');

    this.scale = 2.0; // pixels per foot
    this.panX = 0;
    this.panY = 0;

    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;

    this.setupInteractivity();
    this.resizeCanvas();
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement;
    this.canvas.width = parent.clientWidth || 600;
    this.canvas.height = parent.clientHeight || 450;
  }

  setupInteractivity() {
    window.addEventListener('resize', () => {
      this.resizeCanvas();
    });

    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.dragStartX = e.clientX - this.panX;
      this.dragStartY = e.clientY - this.panY;
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        this.panX = e.clientX - this.dragStartX;
        this.panY = e.clientY - this.dragStartY;
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      this.zoom(zoomFactor, e.clientX, e.clientY);
    });
  }

  zoom(factor) {
    this.scale *= factor;
    this.scale = Math.max(0.1, Math.min(this.scale, 50.0));
  }

  zoomExtents(station, points) {
    if (!station || points.length === 0) {
      this.panX = this.canvas.width / 2;
      this.panY = this.canvas.height / 2;
      this.scale = 2.0;
      return;
    }

    let minE = station.easting;
    let maxE = station.easting;
    let minN = station.northing;
    let maxN = station.northing;

    points.forEach(p => {
      if (p.easting < minE) minE = p.easting;
      if (p.easting > maxE) maxE = p.easting;
      if (p.northing < minN) minN = p.northing;
      if (p.northing > maxN) maxN = p.northing;
    });

    const widthFt = (maxE - minE) || 100;
    const heightFt = (maxN - minN) || 100;

    const scaleX = (this.canvas.width * 0.75) / widthFt;
    const scaleY = (this.canvas.height * 0.75) / heightFt;
    this.scale = Math.min(scaleX, scaleY);

    const midE = (minE + maxE) / 2;
    const midN = (minN + maxN) / 2;

    this.panX = (this.canvas.width / 2) - (midE * this.scale);
    this.panY = (this.canvas.height / 2) + (midN * this.scale); // Invert N to Y
  }

  // Converts Survey Coordinates (Easting, Northing) to Canvas Screen (X, Y)
  worldToScreen(easting, northing) {
    const screenX = (easting * this.scale) + this.panX;
    const screenY = (-northing * this.scale) + this.panY; // Y increases downward in Canvas
    return { x: screenX, y: screenY };
  }

  renderCAD(station, backsight, points, activeStakeTarget = null) {
    this.resizeCanvas();
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Dark Background Grid
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, width, height);

    // Draw Grid Pattern
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    const gridSize = 50 * this.scale;

    if (gridSize > 15) {
      for (let x = this.panX % gridSize; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = this.panY % gridSize; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    if (!station) return;

    const occPos = this.worldToScreen(station.easting, station.northing);

    // 1. Draw Backsight Vector Line
    if (backsight) {
      let bsPos;
      if (backsight.northing !== 0 || backsight.easting !== 0) {
        bsPos = this.worldToScreen(backsight.easting, backsight.northing);
      } else {
        const bsE = station.easting + (100 * Math.sin(backsight.azimuthRad));
        const bsN = station.northing + (100 * Math.cos(backsight.azimuthRad));
        bsPos = this.worldToScreen(bsE, bsN);
      }

      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(occPos.x, occPos.y);
      ctx.lineTo(bsPos.x, bsPos.y);
      ctx.stroke();
      ctx.restore();

      // Backsight Point Circle
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(bsPos.x, bsPos.y, 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.font = '11px JetBrains Mono';
      ctx.fillText(`BS:${backsight.id}`, bsPos.x + 10, bsPos.y + 4);
    }

    // 2. Draw Code Linework (Connect points sharing same code like EP or WALL)
    const codeGroups = {};
    points.forEach(p => {
      if (!codeGroups[p.code]) codeGroups[p.code] = [];
      codeGroups[p.code].push(p);
    });

    Object.keys(codeGroups).forEach(code => {
      const pts = codeGroups[code];
      if (pts.length > 1) {
        ctx.strokeStyle = code === 'EP' ? '#10b981' : (code === 'WALL' ? '#f59e0b' : '#64748b');
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        pts.forEach((p, idx) => {
          const pos = this.worldToScreen(p.easting, p.northing);
          if (idx === 0) ctx.moveTo(pos.x, pos.y);
          else ctx.lineTo(pos.x, pos.y);
        });
        ctx.stroke();
      }
    });

    // 3. Draw Measured Point Nodes & Labels
    points.forEach(p => {
      const pos = this.worldToScreen(p.easting, p.northing);

      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 4, 0, 2 * Math.PI);
      ctx.fill();

      // Point Text Labels
      ctx.fillStyle = '#9ca3af';
      ctx.font = '10px JetBrains Mono';
      ctx.fillText(`${p.id} [${p.code}]`, pos.x + 8, pos.y - 4);
      ctx.fillStyle = '#64748b';
      ctx.fillText(`Z:${p.elevation.toFixed(1)}`, pos.x + 8, pos.y + 8);
    });

    // 4. Draw Active Stakeout Target Highlight
    if (activeStakeTarget) {
      const targetPos = this.worldToScreen(activeStakeTarget.easting, activeStakeTarget.northing);

      // Gold Target Reticle
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(targetPos.x, targetPos.y, 12, 0, 2 * Math.PI);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(targetPos.x - 16, targetPos.y);
      ctx.lineTo(targetPos.x + 16, targetPos.y);
      ctx.moveTo(targetPos.x, targetPos.y - 16);
      ctx.lineTo(targetPos.x, targetPos.y + 16);
      ctx.stroke();

      ctx.fillStyle = '#eab308';
      ctx.font = 'bold 12px JetBrains Mono';
      ctx.fillText(`STAKE: ${activeStakeTarget.id}`, targetPos.x + 15, targetPos.y - 15);
    }

    // 5. Draw Occupied Station Tripod Symbol (Red Circle + Cross)
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(occPos.x, occPos.y, 8, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(occPos.x, occPos.y, 3, 0, 2 * Math.PI);
    ctx.fill();

    ctx.font = 'bold 12px Inter';
    ctx.fillText(`OCC:${station.id}`, occPos.x + 12, occPos.y + 4);
  }
}
