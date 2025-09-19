import { Component, Input, Output, EventEmitter, AfterViewInit, OnChanges, SimpleChanges, OnDestroy } from '@angular/core';
// import * as L from 'leaflet';
import { Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule } from '@angular/common';

export interface MapHazardZone {
  id: string;
  coordinates: [number, number][][]; // Polygon(s)
  riskScore: number; // 0-1
}

export interface MapHazardPrediction {
  id: string;
  coordinates: [number, number][][];
  timestamp: string;
}

export interface MapVictimCluster {
  id: string;
  lat: number;
  lon: number;
  priority: 'Immediate' | 'High' | 'Medium' | 'Low';
}

export interface MapResponder {
  id: string;
  lat: number;
  lon: number;
  unitType: 'Ambulance' | 'Fire' | 'Police' | 'Other';
}

export interface MapRoute {
  id: string;
  coordinates: [number, number][];
  type: 'suggested' | 'alternate';
}

export interface MapFacility {
  id: string;
  lat: number;
  lon: number;
  type: 'Hospital' | 'Shelter' | 'SafeZone' | 'RescueZone' | 'Roadblock';
  name: string;
}

@Component({
  selector: 'app-central-map-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './central-map-panel.component.html',
  styleUrls: ['./central-map-panel.component.scss']
})
export class CentralMapPanelComponent implements AfterViewInit, OnChanges, OnDestroy {
  private L: typeof import('leaflet') | undefined;
  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}
  @Input() hazardZones: MapHazardZone[] = [];
  @Input() hazardPredictions: MapHazardPrediction[] = [];
  @Input() victimClusters: MapVictimCluster[] = [];
  @Input() responders: MapResponder[] = [];
  @Input() routes: MapRoute[] = [];
  @Input() facilities: MapFacility[] = [];
  @Input() predictionTimestamp: string = '';
  @Input() mapMode: 'Fire' | 'Flood' = 'Fire';
  @Output() predictionTimestampChange = new EventEmitter<string>();

  private map?: any;
  private overlays: any;
  // Forecast animation + legend support
  private forecastPulseTimer: any;
  private forecastPulseState: number = 0;
  private forecastLayerRefs: any[] = [];
  private legendControl: any;
  private enableTooltips: boolean = true; // disabled on small/mobile screens
  private readonly MOBILE_BREAKPOINT = 640;
  private userLocale: string = 'en-US';
  private hoverDelayMs = 140;
  private victimDetailsCache: Map<string, any[]> = new Map();

  // Simple i18n dictionary (could later be externalized)
  private i18n: Record<string, string> = {
    zoneRisk: 'Risk Score',
    forecastAt: 'Forecast Spread @',
    victimCluster: 'Victim Cluster',
    priority: 'Priority',
    assigned: 'Assigned',
    responderUnit: 'Responder Unit',
    myUnit: 'My Unit',
    route: 'Route',
    suggestedRoute: 'Suggested Route',
    alternateRoute: 'Alternate Route',
    routeEnd: 'Route Terminus',
    facility: 'Facility',
    coordinates: 'Approx. Coords'
  };

  getPredictionIndex(): number {
    return this.hazardPredictions.findIndex(p => p.timestamp === this.predictionTimestamp);
  }

  async ngAfterViewInit() {
    // Guard: prevent double initialization if Angular re-attaches the view (e.g., conditional rendering / hydration edge cases)
    if (this.map) {
      return; // already initialized
    }
    if (isPlatformBrowser(this.platformId)) {
      const L = await import('leaflet');
      this.L = L;
      // Double-check target element exists to avoid runtime errors
      const mapEl = document.getElementById('map');
      if (!mapEl) return;
      this.map = L.map(mapEl, {
        center: [37.7749, -122.4194],
        zoom: 13,
        layers: [
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
          })
        ]
      });
      this.overlays = L.layerGroup();
      this.overlays.addTo(this.map);
      // Decide tooltip enablement (disable on narrow/mobile screens)
      try {
        if (typeof window !== 'undefined') {
          this.enableTooltips = window.innerWidth >= this.MOBILE_BREAKPOINT;
          this.userLocale = navigator.language || this.userLocale;
        }
      } catch {}
      this.renderLayers();
    }
  }

  ngOnDestroy() {
    // Clean up Leaflet map instance to free DOM handlers and allow re-init later without error
    if (this.map) {
      try {
        this.map.remove();
      } catch {}
      this.map = undefined;
      this.overlays = undefined;
    }
    if (this.forecastPulseTimer) {
      clearInterval(this.forecastPulseTimer);
      this.forecastPulseTimer = undefined;
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (this.map && this.L) {
      this.renderLayers();
    }
  }

  private renderLayers() {
    const L = this.L;
    if (!L) return;
    this.overlays.clearLayers();
    this.forecastLayerRefs = [];
    // 🔴 Fire/Flood Zone Overlay
    for (const zone of this.hazardZones) {
      const isFlood = this.mapMode === 'Flood';
      const color = !isFlood
        ? 'rgba(255, 0, 0, 0.55)'
        : 'rgba(33, 150, 243, 0.55)';
      for (const poly of zone.coordinates) {
        // For flood incidents make outline slightly thicker and add dashed inner accent by layering
        if (isFlood) {
          // Base filled polygon
          const activeLayer = L.polygon(poly, {
            color: 'rgba(33,150,243,0.9)',
            fillColor: color,
            fillOpacity: 0.32,
            weight: 4,
            dashArray: undefined
          }).addTo(this.overlays);
          if (this.enableTooltips) {
            this.attachTooltipWithDebounce(activeLayer, this.buildTooltipHTML('zone', {
              title: 'Active Flood Zone',
              risk: zone.riskScore
            }));
          }
          // Subtle inner accent (dashed lighter stroke)
            L.polygon(poly, {
              color: 'rgba(144,202,249,0.9)',
              fill: false,
              weight: 2,
              dashArray: '6 6'
            }).addTo(this.overlays);
        } else {
          const fireLayer = L.polygon(poly, {
            color,
            fillColor: color,
            fillOpacity: 0.35,
            weight: 3,
            dashArray: undefined
          }).addTo(this.overlays);
          if (this.enableTooltips) {
            this.attachTooltipWithDebounce(fireLayer, this.buildTooltipHTML('zone', {
              title: 'Active Fire Zone',
              risk: zone.riskScore
            }));
          }
        }
      }
    }
    // 🟡 Forecast Spread (animated polygon)
    if (this.predictionTimestamp) {
      const pred = this.hazardPredictions.find(p => p.timestamp === this.predictionTimestamp);
      if (pred) {
        const predColor = this.mapMode === 'Fire' ? 'rgba(255, 193, 7, 0.7)' : 'rgba(33, 150, 243, 0.4)';
        for (const poly of pred.coordinates) {
          const layer = L.polygon(poly, {
            color: predColor,
            fillColor: predColor,
            fillOpacity: 0.22,
            dashArray: '8',
            weight: 2
          }).addTo(this.overlays);
          if (this.enableTooltips) {
            this.attachTooltipWithDebounce(layer, this.buildTooltipHTML('forecast', {
              timestamp: this.predictionTimestamp,
              title: 'Forecast Spread'
            }));
          }
          this.forecastLayerRefs.push(layer);
        }
      }
    }
    // 👤 Assigned Victim Cluster (highlighted)
    // For demo, highlight the first cluster as assigned
    let assignedClusterId = this.victimClusters.length > 0 ? this.victimClusters[0].id : null;
    for (const cluster of this.victimClusters) {
      const isAssigned = cluster.id === assignedClusterId;
      const icon = L.divIcon({
        className: `victim-icon ${cluster.priority.toLowerCase()}${isAssigned ? ' assigned' : ''}`,
        html: `<span title="${cluster.priority}">${isAssigned ? '👤' : '🧑‍🤝‍🧑'}</span>`
      });
      const m = L.marker([cluster.lat, cluster.lon], { icon }).addTo(this.overlays);
      if (this.enableTooltips) {
        this.attachTooltipWithDebounce(m, this.buildTooltipHTML('cluster', {
          id: cluster.id,
          priority: cluster.priority,
          assigned: isAssigned,
          lat: cluster.lat,
          lon: cluster.lon,
          loadingVictims: true
        }));
        let loaded = false;
        m.on('tooltipopen', () => {
          if (loaded) return;
          loaded = true;
          const victims = this.getOrGenerateVictimsForCluster(cluster.id, cluster.priority);
          const tt = (m as any).getTooltip?.();
          if (tt) {
            tt.setContent(this.buildTooltipHTML('cluster', {
              id: cluster.id,
              priority: cluster.priority,
              assigned: isAssigned,
              lat: cluster.lat,
              lon: cluster.lon,
              victims
            }));
          }
        });
      }
    }
    // 🚑 My Unit Position (first responder is "my unit")
    let myUnitId = this.responders.length > 0 ? this.responders[0].id : null;
    for (const responder of this.responders) {
      const isMyUnit = responder.id === myUnitId;
      const baseIcon = this.responderIconHtml(responder.unitType);
      const myUnitIcon = this.mapMode === 'Flood'
        ? `${baseIcon}<span style="font-size:1.1em;">★</span>`
        : `${baseIcon}<span style="font-size:1.1em;">★</span>`;
      const icon = L.divIcon({
        className: `responder-icon ${responder.unitType.toLowerCase()}${isMyUnit ? ' my-unit' : ''}`,
        html: isMyUnit ? myUnitIcon : baseIcon
      });
      const rm = L.marker([responder.lat, responder.lon], { icon }).addTo(this.overlays);
      if (this.enableTooltips) {
        this.attachTooltipWithDebounce(rm, this.buildTooltipHTML('responder', {
          unitType: responder.unitType,
          myUnit: isMyUnit,
          id: responder.id
        }));
      }
    }
    // ⬆ Suggested Route + ⬅ Alternate (with arrowheads)
    for (const route of this.routes) {
      const polyline = L.polyline(route.coordinates, {
        color: route.type === 'suggested' ? '#388e3c' : '#ff9800',
        weight: route.type === 'suggested' ? 7 : 4,
        dashArray: route.type === 'alternate' ? '12' : undefined,
        opacity: route.type === 'suggested' ? 0.98 : 0.8,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(this.overlays);
      if (this.enableTooltips) {
        this.attachTooltipWithDebounce(polyline, this.buildTooltipHTML('route', {
          type: route.type
        }));
      }
      // Add arrowhead marker at the end of the route
      const last = route.coordinates[route.coordinates.length - 1];
      const icon = L.divIcon({
        className: `route-arrow ${route.type}`,
        iconSize: [24, 24],
        html: route.type === 'suggested' ? '<span style="font-size:1.6em;color:#388e3c;">⬆</span>' : '<span style="font-size:1.4em;color:#ff9800;">⬅</span>'
      });
      const term = L.marker(last, { icon, interactive: false }).addTo(this.overlays);
      if (this.enableTooltips) {
        this.attachTooltipWithDebounce(term, this.buildTooltipHTML('routeEnd', { }));
      }
    }
    // 🏥 Nearest Hospital / 🛟 Safe Zone
    for (const facility of this.facilities) {
      const icon = L.divIcon({
        className: `facility-icon ${facility.type.toLowerCase()}`,
        html: this.facilityIconHtml(facility.type)
      });
      const fm = L.marker([facility.lat, facility.lon], { icon }).addTo(this.overlays);
      if (this.enableTooltips) {
        this.attachTooltipWithDebounce(fm, this.buildTooltipHTML('facility', {
          type: facility.type,
          id: facility.id
        }));
      }
    }
    // Start/refresh forecast pulse if Flood mode
    this.startForecastPulseIfNeeded();
    // Add legend UI
    this.addLegendControl(L);
  }

  /** Build unified HTML tooltip snippet */
  private buildTooltipHTML(kind: string, data: any): string {
    const fmtNumber = (v: number, digits: number = 2) =>
      typeof v === 'number' && !isNaN(v) ? v.toLocaleString(this.userLocale, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '';
    const fmtTime = (ts: number) => {
      try {
        return new Intl.DateTimeFormat(this.userLocale, { hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
      } catch { return ''; }
    };
    const fmtCoords = (lat?: number, lon?: number) => {
      if (typeof lat !== 'number' || typeof lon !== 'number') return '';
      return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    };

    let title = '';
    const rows: string[] = [];

    switch (kind) {
      case 'zone':
        title = data.title || 'Active Zone';
  rows.push(this.row(this.i18n['zoneRisk'], fmtNumber(data.risk)));
        break;
      case 'forecast':
        title = data.title || 'Forecast';
  rows.push(this.row(this.i18n['forecastAt'], fmtTime(data.timestamp)));
        break;
      case 'cluster':
  title = this.i18n['victimCluster'];
        if (data.id) rows.push(this.row('ID', data.id));
  rows.push(this.row(this.i18n['priority'], data.priority));
  if (data.assigned) rows.push(this.row(this.i18n['assigned'], 'Yes'));
  rows.push(this.row(this.i18n['coordinates'], fmtCoords(data.lat, data.lon)));
        if (data.loadingVictims) {
          rows.push(`<div class="mt-row"><span class="mt-label">Victims:</span><span class="mt-value">Loading...</span></div>`);
        } else if (Array.isArray(data.victims) && data.victims.length) {
          const iconFor = (sev: string) => {
            switch (sev) {
              case 'critical': return '🔴';
              case 'serious': return '🟠';
              case 'stable': return '🟢';
              default: return '⚪';
            }
          };
          const victimLines = data.victims.map((v: any) => `<div class=\"mt-victim\" aria-label=\"Victim ${this.escape(v.id)} ${this.escape(v.severity)}\">
              <span class=\"v-id\">${this.escape(v.id)}</span>
              <span class=\"v-sev sev-${this.escape(v.severity)}\" title=\"${this.escape(v.severity)}\">${iconFor(v.severity)}</span>
              <span class=\"v-need\">${this.escape(v.need)}</span>
              <span class=\"v-status\">${this.escape(v.status)}</span>
            </div>`).join('');
          rows.push(`<div class=\"mt-row mt-victims-block\"><span class=\"mt-label\">Victims:</span><div class=\"mt-victims\">${victimLines}</div></div>`);
        }
        break;
      case 'responder':
  title = data.myUnit ? `${this.i18n['myUnit']}` : this.i18n['responderUnit'];
        if (data.unitType) rows.push(this.row('Type', data.unitType));
        if (data.id) rows.push(this.row('ID', data.id));
        break;
      case 'route':
  title = data.type === 'suggested' ? this.i18n['suggestedRoute'] : this.i18n['alternateRoute'];
        break;
      case 'routeEnd':
  title = this.i18n['routeEnd'];
        break;
      case 'facility':
  title = this.i18n['facility'];
        if (data.type) rows.push(this.row('Type', data.type));
        if (data.id) rows.push(this.row('ID', data.id));
        break;
      default:
        title = '';
    }

    return `\n    <div class="map-tooltip">\n      ${title ? `<div class=\"mt-title\">${this.escape(title)}</div>` : ''}\n      ${rows.join('')}\n    </div>`;
  }

  private row(label: string, value: any): string {
    if (value === undefined || value === '') return '';
    return `<div class=\"mt-row\"><span class=\"mt-label\">${this.escape(label)}:</span><span class=\"mt-value\">${this.escape(String(value))}</span></div>`;
  }

  private escape(v: string): string {
    return v.replace(/[&<>"]+/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[s] as string));
  }

  /** Attach tooltip with manual debounced open/close to reduce clutter */
  private attachTooltipWithDebounce(layer: any, html: string) {
    if (!layer || !layer.bindTooltip) return;
    layer.bindTooltip(html, { sticky: true, direction: 'top', opacity: 0.95, className: 'unified-leaflet-tooltip' });
    let timer: any;
    layer.on('mouseover', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try { layer.openTooltip(); } catch {}
      }, this.hoverDelayMs);
    });
    layer.on('mouseout', () => {
      if (timer) clearTimeout(timer);
      try { layer.closeTooltip(); } catch {}
    });
    // For touch devices we could open on click (if enabledTooltips true)
    layer.on('click', () => {
      if (!this.enableTooltips) return;
      try { layer.openTooltip(); } catch {}
    });
  }

  // Legend control
  private addLegendControl(L: any) {
    if (!this.map) return;
    if (this.legendControl) {
      try { this.legendControl.remove(); } catch {}
      this.legendControl = undefined;
    }
    this.legendControl = L.control({ position: 'topright' });
    const mode = this.mapMode;
    this.legendControl.onAdd = () => {
      const div = L.DomUtil.create('div', 'map-legend');
      div.setAttribute('role', 'group');
      div.setAttribute('aria-label', 'Map legend');
      div.innerHTML = `
        <div class="legend-title">${mode} Layers</div>
        <div class="legend-row"><span class="legend-swatch active-zone ${mode.toLowerCase()}"></span><span class="legend-label">Active ${mode} Zone</span></div>
        <div class="legend-row"><span class="legend-swatch forecast ${mode.toLowerCase()}"></span><span class="legend-label">Forecast Spread</span></div>
        <div class="legend-row"><span class="legend-icon">🧑‍🤝‍🧑</span><span class="legend-label">Victim Cluster</span></div>
        <div class="legend-row"><span class="legend-icon">${mode === 'Flood' ? '🚑' : '🚑'}</span><span class="legend-label">Responder Unit</span></div>
  <div class="legend-row"><span class="legend-icon">${mode === 'Flood' ? '🏥' : '🏥'}</span><span class="legend-label">Hospital</span></div>
  <div class="legend-row"><span class="legend-icon">${mode === 'Flood' ? '🛟' : '🛟'}</span><span class="legend-label">Safe Zone</span></div>
      `;
      return div;
    };
    this.legendControl.addTo(this.map);
  }

  // Forecast pulse animation (Flood only)
  private startForecastPulseIfNeeded() {
    if (this.forecastPulseTimer) {
      clearInterval(this.forecastPulseTimer);
      this.forecastPulseTimer = undefined;
    }
    if (this.mapMode !== 'Flood' || this.forecastLayerRefs.length === 0) return;
    this.forecastPulseTimer = setInterval(() => {
      this.forecastPulseState = (this.forecastPulseState + 1) % 40; // cycle
      const phase = Math.abs(20 - this.forecastPulseState) / 20; // 0..1..0
      const fillOpacity = 0.18 + phase * 0.14; // 0.18 -> 0.32 -> 0.18
      for (const layer of this.forecastLayerRefs) {
        try { layer.setStyle({ fillOpacity }); } catch {}
      }
    }, 140);
  }

  private responderIconHtml(type: string): string {
    // Flood mode: prefix with droplet to reinforce context
    if (this.mapMode === 'Flood') {
      switch (type) {
        case 'Ambulance': return '🚑';
        case 'Fire': return '🚒';
        case 'Police': return '🚓';
        default: return '🚨';
      }
    }
    switch (type) {
      case 'Ambulance': return '🚑';
      case 'Fire': return '🚒';
      case 'Police': return '🚓';
      default: return '🚨';
    }
  }

  private riskColor(score: number): string {
    // For Fire: gradient green (low) to red (high)
    const r = Math.round(255 * score);
    const g = Math.round(180 * (1 - score));
    return `rgb(${r},${g},64)`;
  }

  private facilityIconHtml(type: string): string {
    const isFlood = this.mapMode === 'Flood';
    switch (type) {
      case 'Hospital': return isFlood ? '🏥' : '🏥';
      case 'Shelter': return isFlood ? '🏚️' : '🏚️';
      case 'SafeZone': return isFlood ? '🛟' : '🛟';
      case 'RescueZone': return isFlood ? '🛟' : '🛟';
      case 'Roadblock': return isFlood ? '🚧' : '🚧';
      default: return isFlood ? '❓' : '❓';
    }
  }

  // Lazy victim generation with deterministic variety based on cluster id hash
  private getOrGenerateVictimsForCluster(clusterId: string, priority: string) {
    if (this.victimDetailsCache.has(clusterId)) {
      return this.victimDetailsCache.get(clusterId)!;
    }
    const baseCount = priority === 'Immediate' ? 5 : priority === 'High' ? 4 : priority === 'Medium' ? 3 : 2;
    // pseudo-random but deterministic count augmentation
    const hash = Array.from(clusterId).reduce((a, c) => a + c.charCodeAt(0), 0);
    const extra = hash % 3; // 0..2
    const total = baseCount + extra;
    const severities: Array<'critical' | 'serious' | 'stable'> = ['critical', 'serious', 'stable'];
    const needsPool = ['Medical', 'Evacuation', 'Water', 'Food', 'Stabilization'];
    const statuses: Array<'awaiting' | 'treated' | 'evacuated'> = ['awaiting', 'treated', 'awaiting', 'evacuated'];
    const victims = Array.from({ length: total }).map((_, i) => ({
      id: `${clusterId}-V${i + 1}`,
      need: needsPool[(hash + i) % needsPool.length],
      severity: severities[(hash + i) % severities.length],
      status: statuses[(hash + i) % statuses.length]
    }));
    this.victimDetailsCache.set(clusterId, victims);
    return victims;
  }
}
