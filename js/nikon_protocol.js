/**
 * Nikon NPL-322+ Total Station Communication & Geodetic Coordinate Math Engine
 * Supports:
 * - Nikon AP-700 / Raw Transmission Format Parsing
 * - 3D Survey Coordinate Calculation (HD, VD, Northing, Easting, Elevation)
 * - Instrument Station Setup & Backsight Orientation Calibration
 * - Stakeout Construction Layout Navigation (Turn Angles, Distances, Cut/Fill)
 * - Nikon Instrument Simulator for off-site demo / field testing
 */

export class NikonProtocolEngine {
  constructor() {
    // Current Station State
    this.occupiedStation = {
      id: "100",
      northing: 5000.000,
      easting: 5000.000,
      elevation: 100.000,
      HI: 5.25 // Instrument Height
    };

    this.backsight = {
      id: "99",
      northing: 5150.000,
      easting: 5000.000,
      elevation: 100.000,
      azimuthRad: 0.0, // North = 0 rad
      circleOffsetRad: 0.0 // Zero circle calibration offset
    };

    this.simulatorActive = true;
    this.simulatedAngleDeg = 124.58667;
  }

  // Set Occupied Station & Backsight Reference
  setStationSetup(occ, bs) {
    this.occupiedStation = { ...occ };

    if (bs.mode === 'coord') {
      const dE = bs.easting - occ.easting;
      const dN = bs.northing - occ.northing;
      let az = Math.atan2(dE, dN);
      if (az < 0) az += 2 * Math.PI;

      const calcHD = Math.hypot(dE, dN);

      this.backsight = {
        id: bs.id || "BS",
        northing: bs.northing,
        easting: bs.easting,
        elevation: bs.elevation || occ.elevation,
        azimuthRad: az,
        calcHD
      };
    } else {
      let azDeg = parseFloat(bs.azimuthDeg) || 0;
      this.backsight = {
        id: "BS_AZ",
        northing: 0,
        easting: 0,
        elevation: occ.elevation,
        azimuthRad: (azDeg * Math.PI) / 180.0,
        calcHD: 0
      };
    }
  }

  // Converts Decimal Degrees to Deg-Min-Sec String
  static degToDms(degVal) {
    if (isNaN(degVal)) return `00° 00' 00"`;
    const sign = degVal < 0 ? '-' : '';
    const absDeg = Math.abs(degVal);
    const d = Math.floor(absDeg);
    const minFloat = (absDeg - d) * 60;
    const m = Math.floor(minFloat);
    const s = Math.round((minFloat - m) * 60);

    const dStr = String(d).padStart(2, '0');
    const mStr = String(m).padStart(2, '0');
    const sStr = String(s).padStart(2, '0');

    return `${sign}${dStr}° ${mStr}' ${sStr}"`;
  }

  // Converts Deg-Min-Sec String to Decimal Degrees
  static dmsToDeg(dmsStr) {
    if (typeof dmsStr === 'number') return dmsStr;
    const parts = String(dmsStr).replace(/[^0-9.-]/g, ' ').trim().split(/\s+/);
    if (parts.length === 0) return 0;

    const d = parseFloat(parts[0]) || 0;
    const m = parseFloat(parts[1]) || 0;
    const s = parseFloat(parts[2]) || 0;

    return d + (m / 60) + (s / 3600);
  }

  /**
   * 3D Coordinate Calculation from Raw Total Station Measurement
   * Inputs:
   * - HA_deg: Horizontal Circle Angle (Degrees)
   * - VA_deg: Zenith Vertical Angle (Degrees, 90° = Horizontal)
   * - SD_ft: Slope Distance (Feet/Meters)
   * - HT_ft: Target Rod Height (Feet/Meters)
   */
  calculatePointCoordinates(HA_deg, VA_deg, SD_ft, HT_ft) {
    const occ = this.occupiedStation;
    const bs = this.backsight;

    // Convert angles to radians
    const HA_rad = (HA_deg * Math.PI) / 180.0;
    const VA_rad = (VA_deg * Math.PI) / 180.0;

    // True Bearing / Azimuth
    let azimuth = bs.azimuthRad + HA_rad;
    while (azimuth >= 2 * Math.PI) azimuth -= 2 * Math.PI;

    // Horizontal & Vertical Distances
    const HD = SD_ft * Math.sin(VA_rad);
    const VD = SD_ft * Math.cos(VA_rad);

    // 3D Northing, Easting, Elevation
    const N = occ.northing + (HD * Math.cos(azimuth));
    const E = occ.easting + (HD * Math.sin(azimuth));
    const Z = occ.elevation + VD + occ.HI - HT_ft;

    return {
      northing: parseFloat(N.toFixed(3)),
      easting: parseFloat(E.toFixed(3)),
      elevation: parseFloat(Z.toFixed(3)),
      HD: parseFloat(HD.toFixed(3)),
      VD: parseFloat(VD.toFixed(3)),
      azimuthDeg: parseFloat(((azimuth * 180.0) / Math.PI).toFixed(4)),
      azimuthDms: NikonProtocolEngine.degToDms((azimuth * 180.0) / Math.PI)
    };
  }

  /**
   * Stakeout Navigation Math
   * Calculates field instructions (Turn Angle, Distance Delta, Cut/Fill) to navigate to Target Point.
   */
  calculateStakeoutGuidance(targetPt, currentHA_deg, currentVA_deg, currentSD_ft, currentHT_ft) {
    const occ = this.occupiedStation;
    const bs = this.backsight;

    // Target Vectors relative to Instrument Station
    const dE = targetPt.easting - occ.easting;
    const dN = targetPt.northing - occ.northing;
    const dZ = targetPt.elevation - occ.elevation;

    let targetAzRad = Math.atan2(dE, dN);
    if (targetAzRad < 0) targetAzRad += 2 * Math.PI;

    const targetHD = Math.hypot(dE, dN);

    // Required Horizontal Angle on Circle
    let reqHA_rad = targetAzRad - bs.azimuthRad;
    while (reqHA_rad < 0) reqHA_rad += 2 * Math.PI;
    while (reqHA_rad >= 2 * Math.PI) reqHA_rad -= 2 * Math.PI;

    const currentHA_rad = (currentHA_deg * Math.PI) / 180.0;
    let turnDeltaRad = reqHA_rad - currentHA_rad;
    while (turnDeltaRad > Math.PI) turnDeltaRad -= 2 * Math.PI;
    while (turnDeltaRad < -Math.PI) turnDeltaRad += 2 * Math.PI;

    const turnDeltaDeg = (turnDeltaRad * 180.0) / Math.PI;
    const turnDirection = turnDeltaDeg >= 0 ? 'TURN RIGHT' : 'TURN LEFT';
    const turnDms = NikonProtocolEngine.degToDms(Math.abs(turnDeltaDeg));

    // Measured Horizontal Distance
    const currentVA_rad = (currentVA_deg * Math.PI) / 180.0;
    const currentHD = currentSD_ft * Math.sin(currentVA_rad);
    const distDelta = targetHD - currentHD;

    const distDirection = distDelta >= 0 ? `GO FORWARD ${distDelta.toFixed(2)} ft` : `COME BACK ${Math.abs(distDelta).toFixed(2)} ft`;

    // Vertical Cut / Fill
    const currentZ = occ.elevation + (currentSD_ft * Math.cos(currentVA_rad)) + occ.HI - currentHT_ft;
    const cutFill = targetPt.elevation - currentZ;
    const cutFillText = cutFill >= 0 ? `FILL ${cutFill.toFixed(2)} ft (RAISE ROD)` : `CUT ${Math.abs(cutFill).toFixed(2)} ft (LOWER ROD)`;

    const isOnTarget = Math.abs(turnDeltaDeg) < 0.05 && Math.abs(distDelta) < 0.05 && Math.abs(cutFill) < 0.05;

    return {
      turnInstruction: `${turnDirection} ${turnDms}`,
      distInstruction: distDirection,
      cutFillInstruction: cutFillText,
      turnDeltaDeg,
      distDelta,
      cutFill,
      isOnTarget,
      targetHD: targetHD.toFixed(2)
    };
  }

  // Parse Raw String Output from Nikon NPL-322+ Total Station
  parseNikonRawString(rawStr) {
    if (!rawStr) return null;
    const parts = rawStr.split(',').map(s => s.trim());

    if (parts.length >= 6) {
      return {
        pointId: parts[0],
        HA_deg: parseFloat(parts[1]) || 0,
        VA_deg: parseFloat(parts[2]) || 90,
        SD_ft: parseFloat(parts[3]) || 0,
        HT_ft: parseFloat(parts[4]) || 5.0,
        code: parts[5] || 'TOPO'
      };
    }
    return null;
  }

  // Generates Simulated Measurement for Off-Site Field Testing
  generateSimulatedMeasurement(code = 'EP', HT_ft = 5.00) {
    this.simulatedAngleDeg += (Math.random() * 2.5) - 1.0;
    if (this.simulatedAngleDeg < 0) this.simulatedAngleDeg += 360;

    const HA_deg = parseFloat(this.simulatedAngleDeg.toFixed(4));
    const VA_deg = parseFloat((88.5 + (Math.random() * 0.5)).toFixed(4));
    const SD_ft = parseFloat((120.0 + (Math.random() * 45.0)).toFixed(3));

    return {
      HA_deg,
      VA_deg,
      SD_ft,
      HT_ft,
      code,
      HA_dms: NikonProtocolEngine.degToDms(HA_deg),
      VA_dms: NikonProtocolEngine.degToDms(VA_deg)
    };
  }
}
