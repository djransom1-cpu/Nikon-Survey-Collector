/**
 * AutoCAD DXF File Generator for Field Survey Points & Linework
 * Outputs standard R12/2000 ASCII .dxf files compatible with:
 * - AutoCAD, Civil 3D, Carlson Survey, MicroStation, and QGIS
 */

export class DxfExporter {
  static generateDXF(station, points) {
    let dxf = '';

    // 1. HEADER SECTION
    dxf += `0\nSECTION\n2\nHEADER\n`;
    dxf += `9\n$ACADVER\n1\nAC1009\n`; // AutoCAD R12 ASCII DXF
    dxf += `0\nENDSEC\n`;

    // 2. TABLES SECTION (LAYERS)
    dxf += `0\nSECTION\n2\nTABLES\n`;
    dxf += `0\nTABLE\n2\nLAYER\n70\n3\n`;

    // Layer 1: SURVEY_POINTS (Blue)
    dxf += `0\nLAYER\n2\nSURVEY_POINTS\n70\n0\n62\n5\n6\nCONTINUOUS\n`;
    // Layer 2: SURVEY_TEXT (White)
    dxf += `0\nLAYER\n2\nSURVEY_TEXT\n70\n0\n62\n7\n6\nCONTINUOUS\n`;
    // Layer 3: SURVEY_LINEWORK (Green)
    dxf += `0\nLAYER\n2\nSURVEY_LINEWORK\n70\n0\n62\n3\n6\nCONTINUOUS\n`;

    dxf += `0\nENDTAB\n0\nENDSEC\n`;

    // 3. ENTITIES SECTION (POINTS, TEXT, LINES)
    dxf += `0\nSECTION\n2\nENTITIES\n`;

    // A. Station Point
    if (station) {
      dxf += `0\nPOINT\n8\nSURVEY_POINTS\n10\n${station.easting}\n20\n${station.northing}\n30\n${station.elevation}\n`;
      dxf += `0\nTEXT\n8\nSURVEY_TEXT\n10\n${station.easting + 1.0}\n20\n${station.northing}\n30\n${station.elevation}\n40\n0.8\n1\nOCC:${station.id}\n`;
    }

    // B. Measured Survey Points
    points.forEach(p => {
      // Point Node
      dxf += `0\nPOINT\n8\nSURVEY_POINTS\n10\n${p.easting}\n20\n${p.northing}\n30\n${p.elevation}\n`;

      // Point ID Label
      dxf += `0\nTEXT\n8\nSURVEY_TEXT\n10\n${p.easting + 0.5}\n20\n${p.northing + 0.5}\n30\n${p.elevation}\n40\n0.6\n1\nPT:${p.id}\n`;

      // Elevation Label
      dxf += `0\nTEXT\n8\nSURVEY_TEXT\n10\n${p.easting + 0.5}\n20\n${p.northing - 0.5}\n30\n${p.elevation}\n40\n0.5\n1\nZ:${p.elevation.toFixed(2)}\n`;

      // Code Label
      dxf += `0\nTEXT\n8\nSURVEY_TEXT\n10\n${p.easting + 0.5}\n20\n${p.northing - 1.2}\n30\n${p.elevation}\n40\n0.5\n1\nCode:${p.code}\n`;
    });

    // C. Code Linework
    const codeGroups = {};
    points.forEach(p => {
      if (!codeGroups[p.code]) codeGroups[p.code] = [];
      codeGroups[p.code].push(p);
    });

    Object.keys(codeGroups).forEach(code => {
      const pts = codeGroups[code];
      if (pts.length > 1) {
        for (let i = 0; i < pts.length - 1; i++) {
          const p1 = pts[i];
          const p2 = pts[i + 1];
          dxf += `0\nLINE\n8\nSURVEY_LINEWORK\n10\n${p1.easting}\n20\n${p1.northing}\n30\n${p1.elevation}\n11\n${p2.easting}\n21\n${p2.northing}\n31\n${p2.elevation}\n`;
        }
      }
    });

    dxf += `0\nENDSEC\n0\nEOF\n`;
    return dxf;
  }

  static generateCSV(points) {
    let csv = `PointID,Northing,Easting,Elevation,Code\n`;
    points.forEach(p => {
      csv += `${p.id},${p.northing.toFixed(3)},${p.easting.toFixed(3)},${p.elevation.toFixed(3)},"${p.code}"\n`;
    });
    return csv;
  }
}
