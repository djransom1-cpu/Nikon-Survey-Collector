/**
 * Nikon NPL-322+ Total Station Survey Data Collector Application
 * Master Controller & Application State Engine
 */

import { NikonProtocolEngine } from './nikon_protocol.js';
import { SurveyCadRenderer } from './survey_cad.js';
import { DxfExporter } from './dxf_exporter.js';

class SurveyApp {
  constructor() {
    this.engine = new NikonProtocolEngine();
    this.cad = null;
    this.currentMode = 'topo';
    this.deferredInstallPrompt = null;

    this.jobs = this.loadJobsFromStorage();
    this.activeJobId = localStorage.getItem('nikon_active_job_id') || null;
    this.points = [];

    this.simTimer = null;
    this.currentReadout = { HA_deg: 124.58667, VA_deg: 88.2111, SD_ft: 145.820, HT_ft: 5.00, code: 'EP' };

    this.init();
  }

  init() {
    this.cad = new SurveyCadRenderer('surveyCanvas');
    this.setupPwaInstaller();
    this.setupJobManager();
    this.setupModals();
    this.setupEventListeners();
    this.setupModeTabs();
    this.startNikonSimulator();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(err => console.log('Survey SW:', err));
    }

    if (this.activeJobId && this.jobs[this.activeJobId]) {
      this.loadJobState(this.activeJobId);
    } else {
      this.createNewJob("DEFAULT_JOB_01");
    }

    this.updateUI();
  }

  setupPwaInstaller() {
    const installBtn = document.getElementById('pwaInstallBtn');
    if (!installBtn) return;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      installBtn.style.display = 'inline-flex';
    });

    installBtn.addEventListener('click', async () => {
      if (!this.deferredInstallPrompt) return;
      this.deferredInstallPrompt.prompt();
      const { outcome } = await this.deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') console.log('Survey PWA installed!');
      this.deferredInstallPrompt = null;
      installBtn.style.display = 'none';
    });

    window.addEventListener('appinstalled', () => {
      installBtn.style.display = 'none';
      this.deferredInstallPrompt = null;
    });
  }

  loadJobsFromStorage() {
    try {
      return JSON.parse(localStorage.getItem('nikon_survey_jobs')) || {};
    } catch(e) {
      return {};
    }
  }

  saveJobsToStorage() {
    localStorage.setItem('nikon_survey_jobs', JSON.stringify(this.jobs));
  }

  createNewJob(name, surveyor = 'Field Crew', startPt = 100) {
    const jobId = 'job_' + Date.now();
    const newJob = {
      id: jobId,
      name: name || 'SURVEY_JOB',
      surveyor,
      createdAt: new Date().toLocaleDateString(),
      station: { id: "100", northing: 5000.000, easting: 5000.000, elevation: 100.000, HI: 5.25 },
      backsight: { id: "99", northing: 5150.000, easting: 5000.000, elevation: 100.000, azimuthRad: 0, mode: 'coord' },
      nextPointId: parseInt(startPt) || 101,
      points: [
        { id: "100", northing: 5000.000, easting: 5000.000, elevation: 100.000, code: "MON" },
        { id: "99", northing: 5150.000, easting: 5000.000, elevation: 100.000, code: "MON" }
      ]
    };

    this.jobs[jobId] = newJob;
    this.saveJobsToStorage();
    this.loadJobState(jobId);
  }

  loadJobState(jobId) {
    const job = this.jobs[jobId];
    if (!job) return;

    this.activeJobId = jobId;
    localStorage.setItem('nikon_active_job_id', jobId);

    document.getElementById('activeJobName').textContent = job.name;
    document.getElementById('activeStationName').textContent = job.station.id;
    document.getElementById('topo-pt-id').value = job.nextPointId || 101;

    this.engine.setStationSetup(job.station, job.backsight);
    this.points = job.points || [];

    this.populateStakeoutTargetsSelect();
    this.renderPointsTable();
    this.updateUI();
  }

  autoSaveActiveJob() {
    if (!this.activeJobId || !this.jobs[this.activeJobId]) return;
    const job = this.jobs[this.activeJobId];
    job.station = this.engine.occupiedStation;
    job.backsight = this.engine.backsight;
    job.points = this.points;
    job.nextPointId = parseInt(document.getElementById('topo-pt-id').value) || 101;
    this.saveJobsToStorage();
  }

  setupJobManager() {
    const modal = document.getElementById('jobModal');
    document.getElementById('jobManagerBtn').addEventListener('click', () => {
      this.renderJobsListUI();
      modal.classList.remove('hidden');
    });

    document.getElementById('closeJobModalBtn').addEventListener('click', () => {
      modal.classList.add('hidden');
    });

    document.getElementById('newJobForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('job-name').value.trim();
      const surveyor = document.getElementById('job-surveyor').value.trim();
      const startPt = document.getElementById('job-start-pt').value;

      if (name) {
        this.createNewJob(name, surveyor, startPt);
        modal.classList.add('hidden');
      }
    });
  }

  renderJobsListUI() {
    const container = document.getElementById('jobsList');
    if (!container) return;
    container.innerHTML = '';

    const jobIds = Object.keys(this.jobs);
    if (jobIds.length === 0) {
      container.innerHTML = `<div style="color:var(--text-muted); font-size:0.85rem; font-style:italic;">No saved jobs found.</div>`;
      return;
    }

    jobIds.reverse().forEach(id => {
      const j = this.jobs[id];
      const div = document.createElement('div');
      div.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.6rem;
        background: rgba(255,255,255,0.03);
        border: 1px solid var(--panel-border);
        border-radius: 6px;
      `;
      div.innerHTML = `
        <div>
          <strong style="color:var(--text-color); font-size:0.9rem;">${j.name}</strong>
          <div style="font-size:0.75rem; color:var(--text-muted);">${j.points ? j.points.length : 0} Points | Created: ${j.createdAt}</div>
        </div>
        <button class="btn btn-primary open-job-btn" data-id="${id}" style="padding:0.3rem 0.6rem; font-size:0.8rem;">Open</button>
      `;
      container.appendChild(div);
    });

    container.querySelectorAll('.open-job-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.loadJobState(e.target.dataset.id);
        document.getElementById('jobModal').classList.add('hidden');
      });
    });
  }

  setupModals() {
    // Connection Modal
    const connModal = document.getElementById('connectModal');
    document.getElementById('connectDeviceBtn').addEventListener('click', () => {
      connModal.classList.remove('hidden');
      this.populateAndroidBluetoothDevices();
    });
    document.getElementById('closeConnectModalBtn').addEventListener('click', () => connModal.classList.add('hidden'));

    const scanBtn = document.getElementById('scanBtDevicesBtn');
    if (scanBtn) {
      scanBtn.addEventListener('click', () => this.populateAndroidBluetoothDevices(true));
    }

    const stopSimBtn = document.getElementById('stopSimModalBtn');
    if (stopSimBtn) {
      stopSimBtn.addEventListener('click', () => {
        this.stopNikonSimulator();
        alert("🛑 Simulator Mode Turned OFF!");
        connModal.classList.add('hidden');
      });
    }

    document.getElementById('startConnectBtn').addEventListener('click', async () => {
      const connType = document.getElementById('conn-type').value;

      if (connType === 'disconnect') {
        this.stopNikonSimulator();
        if (this.activePort) {
          try { await this.activePort.close(); } catch(e){}
          this.activePort = null;
        }
        if (window.bluetoothSerial) {
          window.bluetoothSerial.disconnect();
        }
        alert("🛑 Disconnected from all instruments & Simulator turned OFF.");
        connModal.classList.add('hidden');
        return;
      }

      if (connType === 'android_spp') {
        const macAddress = document.getElementById('android-bt-select').value;
        if (!macAddress) {
          alert("⚠️ Please select a paired Bluetooth Total Station device from the dropdown, or tap 'Scan'!");
          return;
        }

        if (window.bluetoothSerial) {
          const doConnect = (isInsecure = true) => {
            const connectFn = (isInsecure && window.bluetoothSerial.connectInsecure)
              ? window.bluetoothSerial.connectInsecure.bind(window.bluetoothSerial)
              : window.bluetoothSerial.connect.bind(window.bluetoothSerial);

            this.logBtDebug(`Attempting ${isInsecure ? 'Insecure' : 'Secure'} Bluetooth RFCOMM socket to MAC: ${macAddress}...`);

            connectFn(macAddress, () => {
              this.stopNikonSimulator();
              document.getElementById('connStatusBadge').textContent = '🟢 Live Bluetooth (Nikon SPP)';
              document.getElementById('connStatusBadge').style.color = 'var(--pass-color)';
              this.logBtDebug(`🟢 CONNECTED to Nikon Total Station (${macAddress}) via Native ${isInsecure ? 'Insecure' : 'Secure'} SPP!`);
              alert(`🎯 SUCCESS! Linked to Nikon Total Station over ${isInsecure ? 'Insecure' : 'Secure'} Bluetooth SPP!`);

              this.btRawBuffer = '';

              // 1. Subscribe to Raw Byte Stream
              window.bluetoothSerial.subscribeRawData((data) => {
                const bytes = new Uint8Array(data);
                let str = '';
                for (let i = 0; i < bytes.length; i++) {
                  str += String.fromCharCode(bytes[i]);
                }
                this.handleRawDataChunk(str);
              }, (err) => {
                this.logBtDebug(`⚠️ SubscribeRawData error: ${err}`);
              });

              // 2. Subscribe to Newline
              window.bluetoothSerial.subscribe('\n', (line) => {
                this.handleNikonRawString(line);
              }, (err) => {});

              // 3. Fallback Continuous 500ms Polling Reader to drain any unread bytes from RFCOMM buffer
              if (this.btPollInterval) clearInterval(this.btPollInterval);
              this.btPollInterval = setInterval(() => {
                window.bluetoothSerial.read((data) => {
                  if (data && data.length > 0) {
                    this.handleRawDataChunk(data);
                  }
                }, (err) => {});
              }, 500);

            }, (err) => {
              if (isInsecure) {
                this.logBtDebug(`⚠️ Insecure connection failed (${err}). Retrying with Secure connection...`);
                doConnect(false);
              } else {
                this.logBtDebug(`❌ Bluetooth Connection Failed: ${err}`);
                alert("❌ Bluetooth Connection Failed: " + (err || "Check instrument power & pairing"));
              }
            });
          };

          doConnect(true);
        } else {
          alert("📱 Native Bluetooth SPP is active inside the Android APK. On Windows PC / Web, select 'Windows Serial Port'.");
        }
      } else if (connType === 'serial') {
        if ('serial' in navigator) {
          try {
            // Request Web Serial Port (works for both USB cable COM ports & Bluetooth Virtual COM ports!)
            const port = await navigator.serial.requestPort();
            await port.open({ baudRate: parseInt(document.getElementById('conn-baud').value) || 9600 });
            
            this.stopNikonSimulator();
            this.activePort = port;
            
            document.getElementById('connStatusBadge').textContent = '🟢 Connected Live';
            document.getElementById('connStatusBadge').style.color = 'var(--pass-color)';
            alert("🔌 Connected to Nikon Total Station Serial / Bluetooth COM Port!");

            this.readSerialStream(port);
          } catch(err) {
            alert("⚠️ Serial Connection Notice: " + err.message);
          }
        } else {
          alert("⚠️ Web Serial API is not supported in this browser environment. Use Native Android Bluetooth SPP mode above on your tablet!");
        }
      } else if (connType === 'simulator') {
        this.startNikonSimulator();
        alert("⚡ Operating in Nikon NPL-322+ Field Simulator Mode!");
      }

      connModal.classList.add('hidden');
    });

    // Export Modal
    const expModal = document.getElementById('exportModal');
    document.getElementById('exportDataBtn').addEventListener('click', () => expModal.classList.remove('hidden'));
    document.getElementById('closeExportModalBtn').addEventListener('click', () => expModal.classList.add('hidden'));

    document.getElementById('exportDxfBtn').addEventListener('click', () => {
      const dxfContent = DxfExporter.generateDXF(this.engine.occupiedStation, this.points);
      this.downloadFile(dxfContent, `${document.getElementById('activeJobName').textContent}.dxf`, 'application/dxf');
      expModal.classList.add('hidden');
    });

    document.getElementById('exportCsvBtn').addEventListener('click', () => {
      const csvContent = DxfExporter.generateCSV(this.points);
      this.downloadFile(csvContent, `${document.getElementById('activeJobName').textContent}.csv`, 'text/csv');
      expModal.classList.add('hidden');
    });

    document.getElementById('exportNikonRawBtn').addEventListener('click', () => {
      let rawContent = `NIKON RAW MEASUREMENT JOB FILE\nJOB:${document.getElementById('activeJobName').textContent}\n`;
      this.points.forEach(p => {
        rawContent += `PT,${p.id},N:${p.northing},E:${p.easting},Z:${p.elevation},CODE:${p.code}\n`;
      });
      this.downloadFile(rawContent, `${document.getElementById('activeJobName').textContent}.raw`, 'text/plain');
      expModal.classList.add('hidden');
    });
  }

  async readSerialStream(port) {
    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
    const reader = textDecoder.readable.getReader();

    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        reader.releaseLock();
        break;
      }
      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      lines.forEach(line => {
        this.handleNikonRawString(line);
      });
    }
  }

  logBtDebug(msg) {
    console.log("[BT DEBUG]", msg);
    const consoleEl = document.getElementById('bt-debug-console');
    if (consoleEl) {
      const time = new Date().toLocaleTimeString();
      const div = document.createElement('div');
      div.textContent = `[${time}] ${msg}`;
      consoleEl.prepend(div);
    }
  }

  handleRawDataChunk(chunk) {
    if (!chunk) return;
    this.logBtDebug(`📥 RAW BYTES RECEIVED (${chunk.length}): "${chunk.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`);

    this.btRawBuffer = (this.btRawBuffer || '') + chunk;

    // Split incoming stream by \r or \n
    const lines = this.btRawBuffer.split(/[\r\n]+/);
    this.btRawBuffer = lines.pop(); // Retain incomplete line fragment

    lines.forEach(line => {
      if (line.trim().length > 0) {
        this.handleNikonRawString(line.trim());
      }
    });
  }

  handleNikonRawString(line) {
    if (!line) return;
    this.logBtDebug(`🎯 PARSING STRING: "${line}"`);

    const badge = document.getElementById('connStatusBadge');
    if (badge) {
      badge.textContent = `🟢 Live Shot Parsed!`;
      badge.style.color = 'var(--pass-color)';
    }

    const parsed = this.engine.parseNikonRawString(line);
    if (parsed) {
      this.currentReadout = {
        HA_deg: parsed.HA_deg,
        VA_deg: parsed.VA_deg,
        SD_ft: parsed.SD_ft,
        HT_ft: parsed.HT_ft,
        code: parsed.code,
        HA_dms: NikonProtocolEngine.degToDms(parsed.HA_deg),
        VA_dms: NikonProtocolEngine.degToDms(parsed.VA_deg)
      };
      this.updateReadoutDisplay();
      if (this.currentMode === 'stakeout') {
        this.updateStakeoutGuidance();
      }
      this.logBtDebug(`✅ MATCHED SHOT: HA=${parsed.HA_deg}°, VA=${parsed.VA_deg}°, SD=${parsed.SD_ft}ft`);
    } else {
      this.logBtDebug(`⚠️ RAW STRING DID NOT MATCH NIKON PATTERN: "${line}"`);
    }
  }

  populateAndroidBluetoothDevices(showAlert = false) {
    const select = document.getElementById('android-bt-select');
    if (!select) return;

    if (window.bluetoothSerial) {
      // 1. Check if Bluetooth is enabled
      window.bluetoothSerial.isEnabled(() => {
        // Bluetooth is ON - fetch paired devices
        window.bluetoothSerial.list((devices) => {
          select.innerHTML = '';
          if (!devices || devices.length === 0) {
            select.innerHTML = '<option value="">⚠️ No paired devices - Scanning nearby...</option>';
            this.discoverUnpairedBluetoothDevices(showAlert);
            return;
          }

          devices.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.address; // MAC Address
            opt.textContent = `📡 ${d.name || 'Nikon Instrument'} (${d.address})`;
            select.appendChild(opt);
          });

          if (showAlert) alert(`✅ Found ${devices.length} paired Bluetooth device(s)!`);
        }, (err) => {
          alert("⚠️ Bluetooth Permission Notice: Please allow 'Nearby Devices' or 'Location' permission in Android Settings -> Apps -> Nikon Survey Collector -> Permissions.");
        });
      }, () => {
        // Bluetooth is OFF - prompt user to turn it ON
        window.bluetoothSerial.enable(() => {
          this.populateAndroidBluetoothDevices(showAlert);
        }, () => {
          alert("⚠️ Please turn ON Bluetooth on your tablet!");
        });
      });
    } else {
      select.innerHTML = '<option value="">📱 Android Native Bluetooth active inside APK</option>';
    }
  }

  discoverUnpairedBluetoothDevices(showAlert = false) {
    const select = document.getElementById('android-bt-select');
    if (!select || !window.bluetoothSerial) return;

    if (showAlert) alert("🔍 Scanning for nearby Bluetooth total stations...");

    window.bluetoothSerial.discoverUnpaired((devices) => {
      if (devices && devices.length > 0) {
        select.innerHTML = '';
        devices.forEach(d => {
          if (!select.querySelector(`option[value="${d.address}"]`)) {
            const opt = document.createElement('option');
            opt.value = d.address;
            opt.textContent = `📡 ${d.name || 'Nikon Total Station'} (${d.address})`;
            select.appendChild(opt);
          }
        });
        if (showAlert) alert(`✅ Discovered ${devices.length} nearby Bluetooth device(s)!`);
      } else {
        if (showAlert) alert("⚠️ No Bluetooth devices found. Ensure 'Nearby Devices' permission is enabled in Tablet Settings -> Apps -> Nikon Survey Collector -> Permissions.");
      }
    }, (err) => {
      console.log("BT Discover Error:", err);
      if (showAlert) alert("⚠️ Scan Notice: Please enable 'Location' & 'Nearby Devices' in Android App Settings.");
    });
  }

  downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  setupModeTabs() {
    document.querySelectorAll('.mode-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const targetMode = e.currentTarget.dataset.mode;
        this.switchMode(targetMode);
      });
    });
  }

  switchMode(modeName) {
    this.currentMode = modeName;
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === modeName));
    document.querySelectorAll('.mode-content').forEach(mc => mc.classList.toggle('active', mc.id === `mode-${modeName}`));

    if (modeName === 'stakeout') {
      this.populateStakeoutTargetsSelect();
    }
    this.updateUI();
  }

  setupEventListeners() {
    const toggleSimBtn = document.getElementById('toggleSimBtn');
    if (toggleSimBtn) {
      toggleSimBtn.addEventListener('click', () => this.toggleNikonSimulator());
    }

    // Trigger Nikon Measure Button
    document.getElementById('triggerNikonMeasureBtn').addEventListener('click', () => {
      if (window.bluetoothSerial) {
        this.logBtDebug("📤 Sending remote measure command M\\r\\n & B\\r\\n to total station over Bluetooth...");
        window.bluetoothSerial.write("M\r\n", () => {
          this.logBtDebug("✅ Sent command 'M\\r\\n' over Bluetooth");
        }, (err) => {
          this.logBtDebug("⚠️ Write error 'M': " + err);
        });

        setTimeout(() => {
          window.bluetoothSerial.write("B\r\n", () => {
            this.logBtDebug("✅ Sent command 'B\\r\\n' over Bluetooth");
          });
        }, 200);
      }

      if (this.simTimer) {
        const code = document.getElementById('topo-code').value;
        const HT = parseFloat(document.getElementById('topo-target-ht').value) || 5.0;
        this.currentReadout = this.engine.generateSimulatedMeasurement(code, HT);
        this.updateReadoutDisplay();
      }
    });

    // Record Point Button
    document.getElementById('recordPointBtn').addEventListener('click', () => {
      this.shootAndRecordPoint();
    });

    // Quick Code Chips
    document.querySelectorAll('.chip-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        const code = e.currentTarget.dataset.code;
        document.getElementById('topo-code').value = code;
      });
    });

    // Code Select Switch Custom
    document.getElementById('topo-code').addEventListener('change', (e) => {
      const isCustom = e.target.value === 'CUSTOM';
      document.getElementById('topo-code-custom').style.display = isCustom ? 'block' : 'none';
    });

    // Station Setup Submit
    document.getElementById('setStationBtn').addEventListener('click', () => {
      const occ = {
        id: document.getElementById('occ-pt-id').value.trim() || '100',
        northing: parseFloat(document.getElementById('occ-northing').value) || 5000,
        easting: parseFloat(document.getElementById('occ-easting').value) || 5000,
        elevation: parseFloat(document.getElementById('occ-elevation').value) || 100,
        HI: parseFloat(document.getElementById('occ-hi').value) || 5.25
      };

      const bsMode = document.getElementById('bs-mode').value;
      const bs = {
        mode: bsMode,
        id: document.getElementById('bs-pt-id').value.trim() || '99',
        northing: parseFloat(document.getElementById('bs-northing').value) || 5150,
        easting: parseFloat(document.getElementById('bs-easting').value) || 5000,
        elevation: parseFloat(document.getElementById('occ-elevation').value) || 100,
        azimuthDeg: parseFloat(document.getElementById('bs-az-deg').value) || 0
      };

      this.engine.setStationSetup(occ, bs);
      document.getElementById('activeStationName').textContent = occ.id;
      alert(`🎯 Station ${occ.id} setup complete & Backsight calibrated!`);
      this.autoSaveActiveJob();
      this.updateUI();
    });

    // CAD Canvas Control Buttons
    document.getElementById('cadZoomInBtn').addEventListener('click', () => {
      this.cad.zoom(1.25);
      this.updateUI();
    });

    document.getElementById('cadZoomOutBtn').addEventListener('click', () => {
      this.cad.zoom(0.8);
      this.updateUI();
    });

    document.getElementById('cadZoomExtentsBtn').addEventListener('click', () => {
      this.cad.zoomExtents(this.engine.occupiedStation, this.points);
      this.updateUI();
    });

    // Theme Toggle
    document.getElementById('themeToggleBtn').addEventListener('click', () => {
      document.body.classList.toggle('dark-theme');
      document.body.classList.toggle('light-theme');
      const isDark = document.body.classList.contains('dark-theme');
      document.getElementById('themeIcon').textContent = isDark ? '🌙' : '☀️';
      this.updateUI();
    });

    // Stakeout Select Change
    document.getElementById('stake-target-select').addEventListener('change', () => {
      this.updateStakeoutGuidance();
    });

    // Store Stakeout Point
    document.getElementById('storeStakePointBtn').addEventListener('click', () => {
      const targetId = document.getElementById('stake-target-select').value;
      const target = this.points.find(p => p.id === targetId);
      if (target) {
        const stakedPtId = `${target.id}_STK`;
        this.points.push({
          id: stakedPtId,
          northing: target.northing,
          easting: target.easting,
          elevation: target.elevation,
          code: "STAKEOUT"
        });
        alert(`🚩 Staked Point "${stakedPtId}" recorded into database!`);
        this.renderPointsTable();
        this.autoSaveActiveJob();
        this.updateUI();
      }
    });
  }

  startNikonSimulator() {
    this.stopNikonSimulator();
    this.simTimer = setInterval(() => {
      const code = document.getElementById('topo-code').value;
      const HT = parseFloat(document.getElementById('topo-target-ht').value) || 5.0;
      this.currentReadout = this.engine.generateSimulatedMeasurement(code, HT);
      this.updateReadoutDisplay();
      if (this.currentMode === 'stakeout') {
        this.updateStakeoutGuidance();
      }
    }, 2000);

    const toggleBtn = document.getElementById('toggleSimBtn');
    if (toggleBtn) {
      toggleBtn.textContent = '⚡ Sim: ON';
      toggleBtn.style.color = '#eab308';
      toggleBtn.style.borderColor = '#eab308';
    }

    const badge = document.getElementById('connStatusBadge');
    if (badge) {
      badge.textContent = '⚡ Simulator Mode';
      badge.style.color = 'var(--accent-color)';
    }
  }

  resetReadoutToStandby() {
    this.currentReadout = {
      HA_deg: null,
      VA_deg: null,
      SD_ft: null,
      HT_ft: 5.00,
      code: 'TOPO',
      HA_dms: '--° --\' --"',
      VA_dms: '--° --\' --"'
    };
    this.updateReadoutDisplay();
  }

  stopNikonSimulator() {
    if (this.simTimer) {
      clearInterval(this.simTimer);
      this.simTimer = null;
    }

    const toggleBtn = document.getElementById('toggleSimBtn');
    if (toggleBtn) {
      toggleBtn.textContent = '🛑 Sim: OFF';
      toggleBtn.style.color = 'var(--text-muted)';
      toggleBtn.style.borderColor = 'var(--panel-border)';
    }

    const badge = document.getElementById('connStatusBadge');
    if (badge && !this.activePort) {
      badge.textContent = '🔴 Disconnected';
      badge.style.color = 'var(--fail-color)';
    }

    this.resetReadoutToStandby();
  }

  toggleNikonSimulator() {
    if (this.simTimer) {
      this.stopNikonSimulator();
      alert("🛑 Nikon Instrument Simulator Turned OFF.");
    } else {
      this.startNikonSimulator();
      alert("⚡ Nikon Instrument Simulator Turned ON.");
    }
  }

  updateReadoutDisplay() {
    const r = this.currentReadout;
    if (!r || r.SD_ft === null || r.SD_ft === undefined) {
      document.getElementById('disp-ha').textContent = '--° --\' --"';
      document.getElementById('disp-va').textContent = '--° --\' --"';
      document.getElementById('disp-sd').textContent = '-- ft (Standby)';
      document.getElementById('disp-hd').textContent = '-- ft';
      return;
    }

    document.getElementById('disp-ha').textContent = r.HA_dms;
    document.getElementById('disp-va').textContent = r.VA_dms;
    document.getElementById('disp-sd').textContent = `${r.SD_ft.toFixed(3)} ft`;

    const VA_rad = (r.VA_deg * Math.PI) / 180.0;
    const HD = r.SD_ft * Math.sin(VA_rad);
    document.getElementById('disp-hd').textContent = `${HD.toFixed(3)} ft`;
  }

  shootAndRecordPoint() {
    const ptIdInput = document.getElementById('topo-pt-id');
    const ptId = ptIdInput.value.trim() || '101';

    let code = document.getElementById('topo-code').value;
    if (code === 'CUSTOM') {
      code = document.getElementById('topo-code-custom').value.trim() || 'TOPO';
    }

    const r = this.currentReadout;
    const coords = this.engine.calculatePointCoordinates(r.HA_deg, r.VA_deg, r.SD_ft, r.HT_ft);

    const newPt = {
      id: ptId,
      northing: coords.northing,
      easting: coords.easting,
      elevation: coords.elevation,
      code
    };

    this.points.push(newPt);

    // Auto-increment point ID
    const nextId = parseInt(ptId) + 1;
    if (!isNaN(nextId)) ptIdInput.value = nextId;

    this.renderPointsTable();
    this.populateStakeoutTargetsSelect();
    this.autoSaveActiveJob();
    this.updateUI();

    alert(`📸 Recorded Point ${newPt.id} (${newPt.code}): N=${newPt.northing}, E=${newPt.easting}, Z=${newPt.elevation}`);
  }

  populateStakeoutTargetsSelect() {
    const select = document.getElementById('stake-target-select');
    if (!select) return;
    select.innerHTML = '';

    this.points.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `Point ${p.id} [${p.code}] - N:${p.northing} E:${p.easting} Z:${p.elevation}`;
      select.appendChild(opt);
    });
  }

  updateStakeoutGuidance() {
    const select = document.getElementById('stake-target-select');
    if (!select || !select.value) return;

    const target = this.points.find(p => p.id === select.value);
    if (!target) return;

    const r = this.currentReadout;
    const g = this.engine.calculateStakeoutGuidance(target, r.HA_deg, r.VA_deg, r.SD_ft, r.HT_ft);

    document.getElementById('stake-turn').textContent = g.turnInstruction;
    document.getElementById('stake-dist').textContent = g.distInstruction;
    document.getElementById('stake-cutfill').textContent = g.cutFillInstruction;

    const badge = document.getElementById('stake-status-badge');
    if (g.isOnTarget) {
      badge.textContent = "ON TARGET (EXACT MATCH)";
      badge.style.background = "rgba(16, 185, 129, 0.2)";
      badge.style.color = "var(--pass-color)";
    } else {
      badge.textContent = `TARGET DIST: ${g.targetHD} ft`;
      badge.style.background = "rgba(234, 179, 8, 0.2)";
      badge.style.color = "var(--warn-color)";
    }
  }

  renderPointsTable() {
    const tbody = document.getElementById('pointsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    this.points.forEach((p, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${p.id}</strong></td>
        <td>${p.northing.toFixed(3)}</td>
        <td>${p.easting.toFixed(3)}</td>
        <td>${p.elevation.toFixed(3)}</td>
        <td><span style="color:var(--accent-color);">${p.code}</span></td>
        <td>
          <button class="del-pt-btn" data-idx="${idx}" style="background:none; border:none; color:var(--fail-color); cursor:pointer; font-weight:bold;">✕</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.del-pt-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        this.points.splice(idx, 1);
        this.renderPointsTable();
        this.autoSaveActiveJob();
        this.updateUI();
      });
    });
  }

  updateUI() {
    let stakeTarget = null;
    if (this.currentMode === 'stakeout') {
      const select = document.getElementById('stake-target-select');
      if (select && select.value) {
        stakeTarget = this.points.find(p => p.id === select.value);
      }
    }

    this.cad.renderCAD(this.engine.occupiedStation, this.engine.backsight, this.points, stakeTarget);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new SurveyApp();
});
