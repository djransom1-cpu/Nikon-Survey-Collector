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

  // Helper to convert Nikon DDD.MMSS format (e.g. 124.3512 -> 124°35'12") into Decimal Degrees
  static nikonDmsToDeg(val) {
    if (isNaN(val) || val === 0) return 0;
    const sign = val < 0 ? -1 : 1;
    const absVal = Math.abs(val);
    const d = Math.floor(absVal);
    const minSec = (absVal - d) * 100;
    const m = Math.floor(minSec + 0.00001);
    const s = (minSec - m) * 100;

    // Check if format is DDD.MMSS
    if (m < 60 && s < 60) {
      return sign * (d + (m / 60) + (s / 3600));
    }
    return val; // Already decimal degrees
  }

  // Parse Raw String Output from Nikon NPL-322+ Total Station (AP-700, CSV, and Raw Shots)
  parseNikonRawString(rawStr) {
    if (!rawStr) return null;
    const cleanStr = rawStr.trim();
    if (cleanStr.length === 0) return null;

    const parts = cleanStr.split(',').map(s => s.trim());

    // Format 1: Nikon AP-700 Side Shot: SS, ptId, HT, SD, HA, VA, [code/date]
    if (parts[0] === 'SS' && parts.length >= 6) {
      const ptId = parts[1];
      const HT_ft = parseFloat(parts[2]) || 5.0;
      const SD_ft = parseFloat(parts[3]) || 0;
      const HA_raw = parseFloat(parts[4]) || 0;
      const VA_raw = parseFloat(parts[5]) || 90;
      const code = parts[6] || 'TOPO';

      return {
        pointId: ptId,
        HA_deg: NikonProtocolEngine.nikonDmsToDeg(HA_raw),
        VA_deg: NikonProtocolEngine.nikonDmsToDeg(VA_raw),
        SD_ft,
        HT_ft,
        code
      };
    }

    // Format 2: Direct 5 or 6 field CSV: ptId, HA, VA, SD, HT, code OR ptId, SD, HA, VA, HT, code
    if (parts.length >= 4) {
      // Check if parts[0] is header or point ID
      let startIdx = (isNaN(parseFloat(parts[0])) && parts.length >= 5) ? 1 : 0;
      
      const ptId = parts[startIdx] || '101';
      const num1 = parseFloat(parts[startIdx + 1]) || 0;
      const num2 = parseFloat(parts[startIdx + 2]) || 0;
      const num3 = parseFloat(parts[startIdx + 3]) || 0;
      const num4 = parseFloat(parts[startIdx + 4]) || 5.0;
      const code = parts[startIdx + 5] || 'TOPO';

      // Distinguish if num1 is SD (distance < 10000 and num2 is angle) or HA
      let SD_ft = num1;
      let HA_raw = num2;
      let VA_raw = num3;

      if (num1 > 360 && num3 <= 360) {
        // num1 is SD
        SD_ft = num1;
        HA_raw = num2;
        VA_raw = num3;
      } else if (num2 > 360) {
        // num3 or num1 is angle
        HA_raw = num1;
        VA_raw = num2;
        SD_ft = num3;
      }

      return {
        pointId: ptId,
        HA_deg: NikonProtocolEngine.nikonDmsToDeg(HA_raw),
        VA_deg: NikonProtocolEngine.nikonDmsToDeg(VA_raw),
        SD_ft,
        HT_ft: num4,
        code
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

/**
 * Synchronous Command Queue for Total Station Hardware Pacing
 * Enforces:
 * - 150ms inter-packet delay for UART buffer clearing
 * - Synchronous ACK/Response handshaking before next packet
 * - 1000ms timeout handling for heavy EDM measurement cycles
 */
export class NikonCommandQueue {
  constructor(writeFn, logFn) {
    this.writeFn = writeFn;
    this.logFn = logFn;
    this.queue = [];
    this.isProcessing = false;
    this.interPacketDelayMs = 150; // 150ms UART clear delay
    this.responseTimeoutMs = 1000; // 1000ms EDM timeout
    this.timer = null;
  }

  enqueue(commandStr) {
    this.queue.push(commandStr);
    if (!this.isProcessing) {
      this.processNext();
    }
  }

  processNext() {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const cmd = this.queue.shift();
    if (this.logFn) this.logFn(`📤 [PACED QUEUE WRITE]: Sending "${cmd.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`);

    this.writeFn(cmd, () => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (this.logFn) this.logFn(`⏱️ [QUEUE TIMEOUT]: 1000ms elapsed. Clearing buffer & pacing next packet...`);
        this.finishCommand();
      }, this.responseTimeoutMs);
    });
  }

  onResponseReceived() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.logFn) this.logFn(`📥 [QUEUE ACK]: Response received. Enforcing 150ms buffer clear delay...`);
    this.finishCommand();
  }

  finishCommand() {
    setTimeout(() => {
      this.processNext();
    }, this.interPacketDelayMs);
  }
}
