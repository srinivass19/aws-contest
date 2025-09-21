import { Component, Input, Output, EventEmitter, AfterViewInit, OnChanges, SimpleChanges, OnDestroy } from '@angular/core';
import { Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule } from '@angular/common';
import { VictimFlashService, VictimFlashRequest } from '../services/../services/victim-flash.service';
import { Subscription } from 'rxjs';

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
  // Optional explicit victim list supplied by parent; if absent component generates deterministic mock victims
  victims?: Array<{ id: string; need: string; severity: 'critical' | 'serious' | 'stable'; status: 'awaiting' | 'treated' | 'evacuated' }>;
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
  private L: any; // assigned only in browser to avoid SSR window references
  constructor(@Inject(PLATFORM_ID) private platformId: Object, private victimFlashService: VictimFlashService) {}
  @Input() hazardZones: MapHazardZone[] = [];
  @Input() hazardPredictions: MapHazardPrediction[] = [];
  @Input() victimClusters: MapVictimCluster[] = [];
  // List of victim cluster IDs that should flash/pulse for easy tracking
  @Input() flashingVictimIds: string[] = [];
  // Auto flash newly added clusters for N ms
  @Input() autoFlashNewVictims: boolean = true;
  @Input() autoFlashDurationMs: number = 10000; // 10s default
  // Use priority-based colored flashing variants
  @Input() priorityFlashColors: boolean = true;
  // Automatically focus map on service-issued flash requests if request.focus not explicitly set
  @Input() autoFocusOnServiceFlash: boolean = true;
  @Input() responders: MapResponder[] = [];
  @Input() routes: MapRoute[] = [];
  @Input() facilities: MapFacility[] = [];
  @Input() predictionTimestamp: string = '';
  @Input() mapMode: 'Fire' | 'Flood' = 'Fire';
  // Optional external center (e.g., incident epicenter). When it changes we fly the map there.
  @Input() mapCenter: [number, number] | null = null;
  @Output() predictionTimestampChange = new EventEmitter<string>();
  // Lifecycle events for flashing (auto/service). External (input-bound) flashes are not emitted.
  @Output() victimFlashStarted = new EventEmitter<{ id: string; source: 'auto' | 'service' }>();
  @Output() victimFlashEnded = new EventEmitter<{ id: string; source: 'auto' | 'service' }>();

  private map?: any;
  private overlays: any;
  // Forecast animation + legend support
  private forecastPulseTimer: any;
  private forecastPulseState: number = 0;
  private forecastLayerRefs: any[] = [];
  private victimHighlightCircles: Map<string, any> = new Map();
  private legendControl: any;
  private enableTooltips: boolean = true; // disabled on small/mobile screens
  private readonly MOBILE_BREAKPOINT = 640;
  private userLocale: string = 'en-US';
  private hoverDelayMs = 140;
  private victimDetailsCache: Map<string, any[]> = new Map();
  private markerRefs: Map<string, any> = new Map(); // victim cluster id -> Leaflet marker
  private prevVictimIds: Set<string> = new Set();
  private autoFlashingIds: Set<string> = new Set();
  private autoFlashTimeouts: Map<string, any> = new Map();
  // Service-driven flashing support
  private serviceFlashIds: Set<string> = new Set();
  private serviceFlashTimeouts: Map<string, any> = new Map();
  private serviceNoPriorityColorIds: Set<string> = new Set();
  private victimFlashSub?: Subscription;
  private pendingServiceFlashRequests: VictimFlashRequest[] = []; // queued before markers ready
  // Individual victim rendering support
  @Input() showIndividualVictims: boolean = true; // toggle to display each victim around cluster
  private victimPositions: Map<string, [number, number]> = new Map(); // victimId -> [lat,lon]
  private individualVictimMarkers: Map<string, any> = new Map();

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
    // Robust guard: Under SSR/hydration or when navigating away and back, Angular can destroy/recreate
    // the component while Leaflet leaves a stamped container (_leaflet_id). A later attempt to
    // re-initialize with L.map(existingEl) then throws: "Map container is already initialized.".
    // We handle three cases:
    // 1. this.map still defined -> skip (already active)
    // 2. this.map was destroyed but the DOM element still has a _leaflet_id -> scrub it
    // 3. Normal fresh initialization
    if (!isPlatformBrowser(this.platformId)) return; // no-op during SSR

    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    // If we have a lingering Leaflet container (from a previous instance) clean it so a new map can mount.
    if ((mapEl as any)._leaflet_id) {
      try {
        // Remove any leftover child nodes Leaflet injected
        mapEl.innerHTML = '';
        // Strip leaflet-* classes while preserving any custom ones
        const cleaned = mapEl.className
          .split(/\s+/)
          .filter(c => c && !c.startsWith('leaflet-'))
          .join(' ');
        mapEl.className = cleaned;
        // Delete the stamp so Leaflet no longer thinks it's initialized
        delete (mapEl as any)._leaflet_id;
      } catch {}
    }

    // If we somehow retained a live map instance, just bail out
    if (this.map) return;

    // Load Leaflet only in browser to avoid SSR window reference errors.
    try {
      const leafletModule: any = await import('leaflet');
      const Lcand = leafletModule?.default && leafletModule.default.map ? leafletModule.default : leafletModule;
      if (!Lcand || typeof Lcand.map !== 'function') {
        console.error('[CentralMapPanel] Leaflet module missing expected map() API. Keys:', Object.keys(leafletModule || {}));
        return;
      }
      this.L = Lcand;
      // Inject CSS dynamically (some SSR setups ignore side-effect CSS imports)
      const existing = document.querySelector('link[data-leaflet-css]');
      if (!existing) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        link.setAttribute('data-leaflet-css','true');
        document.head.appendChild(link);
      }
    } catch (err) {
      console.error('[CentralMapPanel] Failed to load Leaflet in browser context', err);
      return;
    }

    const Lfinal = this.L!; // non-null after successful guard above
    this.map = Lfinal.map(mapEl, {
      center: this.mapCenter || [37.7749, -122.4194],
      zoom: 13
    });
    // Add base tile layer separately (avoids map factory expecting a different namespace shape)
    try {
      Lfinal.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(this.map);
    } catch (tileErr) {
      console.error('[CentralMapPanel] Failed to add tile layer', tileErr);
    }
    this.overlays = Lfinal.layerGroup();
    this.overlays.addTo(this.map);
    // Decide tooltip enablement (disable on narrow/mobile screens)
    try {
      if (typeof window !== 'undefined') {
        this.enableTooltips = window.innerWidth >= this.MOBILE_BREAKPOINT;
        this.userLocale = navigator.language || this.userLocale;
      }
    } catch {}
    this.renderLayers();
    if (this.mapCenter) {
      // Defer slightly to allow layout / size invalidation before flyTo
      try { setTimeout(() => this.safeRecenter(this.mapCenter!), 120); } catch {}
    }
    // Ensure Leaflet recalculates dimensions after being placed in a flex container
    try { setTimeout(() => { this.map?.invalidateSize?.(); }, 60); } catch {}
    // Subscribe to service-driven flash requests (browser only)
    try {
      this.victimFlashSub = this.victimFlashService.requests$.subscribe(req => this.handleServiceFlash(req));
    } catch {}
  }

  ngOnDestroy() {
    // Clean up Leaflet map instance to free DOM handlers and allow re-init later without error
    if (this.map) {
      try {
        const container = this.map.getContainer?.();
        this.map.remove();
        // After remove(), Leaflet leaves a _leaflet_id on the container; delete it so we can safely re-init.
        if (container && (container as any)._leaflet_id) {
          try { delete (container as any)._leaflet_id; } catch {}
        }
      } catch {}
      this.map = undefined;
      this.overlays = undefined;
    }
    if (this.forecastPulseTimer) {
      clearInterval(this.forecastPulseTimer);
      this.forecastPulseTimer = undefined;
    }
    if (this.ringPulseTimer) {
      clearInterval(this.ringPulseTimer); this.ringPulseTimer = undefined;
    }
    // Clear auto-flash timers
    for (const t of this.autoFlashTimeouts.values()) {
      try { clearTimeout(t); } catch {}
    }
    this.autoFlashTimeouts.clear();
    // Clear service flash timers & subscription
    for (const t of this.serviceFlashTimeouts.values()) {
      try { clearTimeout(t); } catch {}
    }
    this.serviceFlashTimeouts.clear();
    if (this.victimFlashSub) {
      try { this.victimFlashSub.unsubscribe(); } catch {}
      this.victimFlashSub = undefined;
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    // Re-render layers if hazard / victims / mode changes
    if (this.map && this.L) {
      this.renderLayers();
    }
    // Recenter on mapCenter updates
    if (changes['mapCenter'] && this.map && this.mapCenter) {
      this.safeRecenter(this.mapCenter);
    }
    if (changes['victimClusters']) {
      this.handleNewVictims();
    } else if (changes['flashingVictimIds']) {
      // External flashing set changed; update classes directly
      this.updateFlashingClasses();
    }
    if (changes['priorityFlashColors']) {
      this.updateFlashingClasses();
    }
  }

  /** Smoothly move map center if sufficiently different */
  private safeRecenter(center: [number, number]) {
    if (!this.map) return;
    try {
      const cur = this.map.getCenter?.();
      if (!cur) { this.map.setView(center, this.map.getZoom?.() || 13); return; }
      const deltaLat = Math.abs(cur.lat - center[0]);
      const deltaLng = Math.abs(cur.lng - center[1]);
      // Only animate if moved more than ~30 meters (~0.00027 deg lat); else skip
      if (deltaLat > 0.00027 || deltaLng > 0.00027) {
        this.map.flyTo(center, this.map.getZoom?.() || 13, { duration: 0.65 });
      }
    } catch {}
  }

  private renderLayers() {
    const L = this.L;
    if (!L) return;
    this.overlays.clearLayers();
    this.forecastLayerRefs = [];
  this.markerRefs.clear();
    this.victimHighlightCircles.clear();
    const INDIVIDUAL_DENSITY_THRESHOLD = 40; // above this many victims in a cluster, collapse to aggregated icon
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
      // Prefer explicit victims if supplied; otherwise fall back to deterministic generator
      const victims = (cluster as any).victims && (cluster as any).victims.length
        ? (cluster as any).victims
        : this.getOrGenerateVictimsForCluster(cluster.id, cluster.priority);
      const tooDense = this.showIndividualVictims && victims.length > INDIVIDUAL_DENSITY_THRESHOLD;
      // When showing individual victims, skip cluster marker (avoid overlap), still show ring.
      if (!this.showIndividualVictims || tooDense) {
        const isFlashing = this.flashingVictimIds.includes(cluster.id);
        const icon = L.divIcon({
          className: `victim-icon ${cluster.priority.toLowerCase()}${isAssigned ? ' assigned' : ''}${isFlashing ? ' flashing' : ''}${tooDense ? ' dense' : ''}`,
          html: tooDense
            ? `<span class="dense-count" title="${victims.length} victims">${victims.length}</span>`
            : `<span title="${cluster.priority}">${isAssigned ? '👤' : '🧑‍🤝‍🧑'}</span>`
        });
        const m = L.marker([cluster.lat, cluster.lon], { icon }).addTo(this.overlays);
        this.markerRefs.set(cluster.id, m);
        if (this.enableTooltips) {
          this.attachTooltipWithDebounce(m, this.buildTooltipHTML('cluster', {
            id: cluster.id,
            priority: cluster.priority,
            assigned: isAssigned,
            lat: cluster.lat,
            lon: cluster.lon,
            victims,
            tooDense
          }));
        }
      }
      // Add highlight ring (Fire mode) regardless of cluster marker presence (center reference)
      if (this.mapMode === 'Fire') {
        const color = this.priorityRingColor(cluster.priority);
        const circle = L.circle([cluster.lat, cluster.lon], {
          radius: 120,
            color,
            weight: 2,
            fillColor: color,
            fillOpacity: 0.15,
            opacity: 0.85,
            className: 'victim-ring'
        }).addTo(this.overlays);
        this.victimHighlightCircles.set(cluster.id, circle);
      }
      if (this.showIndividualVictims && !tooDense) {
        const total = victims.length;
        if (total) {
          const maxRadius = cluster.priority === 'Immediate' ? 14 : cluster.priority === 'High' ? 20 : cluster.priority === 'Medium' ? 26 : 32;
          const metersToLat = 1 / 111000;
          const metersToLon = 1 / 88000;
          // Multi-ring distribution strategy: inner rings small capacity, outer rings larger circumference
          // Ring capacities chosen to maintain readable spacing: [1, 6, 12, 18, 24, ...] (increment by 6)
          const ringCapacities: number[] = [1, 6, 12, 18, 24, 30, 36, 42];
          const victimsWithPos: Array<{ v: any; pos: [number, number] }> = [];
          let remaining = total;
          let indexOffset = 0;
          let ringIndex = 0;
          while (remaining > 0 && ringIndex < ringCapacities.length) {
            const cap = ringCapacities[ringIndex];
            const countThisRing = Math.min(cap, remaining);
            const ringFraction = (ringIndex / (ringCapacities.length - 1));
            const baseRadius = maxRadius * (0.2 + 0.75 * (ringIndex / Math.max(1, ringCapacities.length - 1))); // expand outward
            for (let i = 0; i < countThisRing; i++) {
              const v = victims[indexOffset + i];
              if (!v) continue;
              let pos = this.victimPositions.get(v.id);
              if (!pos) {
                const angle = (2 * Math.PI * i) / countThisRing + ringIndex * 0.17; // small rotational offset per ring
                const chars = [...String(v.id)] as string[];
                const hash = chars.reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0);
                const jitterR = (hash % 7) * 0.25; // slight radius jitter
                const jitterAng = ((hash >> 3) % 360) * (Math.PI / 180) * 0.002; // minuscule angular jitter
                const radius = baseRadius + jitterR;
                const dLat = radius * Math.cos(angle + jitterAng) * metersToLat;
                const dLon = radius * Math.sin(angle + jitterAng) * metersToLon;
                pos = [cluster.lat + dLat, cluster.lon + dLon] as [number, number];
                this.victimPositions.set(v.id, pos);
              }
              victimsWithPos.push({ v, pos });
            }
            remaining -= countThisRing;
            indexOffset += countThisRing;
            ringIndex++;
          }
          for (const { v, pos } of victimsWithPos) {
            // Use a unified person glyph for all individual victims; retain severity via border color (CSS class)
            const victimIcon = L.divIcon({
              className: `victim-individual-icon sev-${v.severity} prio-${cluster.priority.toLowerCase()}`,
              html: `<span class=\"vi-emoji\" aria-label=\"${this.escape(v.severity)} victim\" title=\"${this.escape(v.severity)} victim\">🧍</span>`
            });
            const vm = L.marker(pos, { icon: victimIcon }).addTo(this.overlays);
            try { vm.setZIndexOffset?.(500); } catch {}
            this.individualVictimMarkers.set(v.id, vm);
            if (this.enableTooltips) {
              this.attachTooltipWithDebounce(vm, this.buildTooltipHTML('victim', {
                id: v.id,
                clusterId: cluster.id,
                priority: cluster.priority,
                severity: v.severity,
                need: v.need,
                status: v.status,
                lat: pos[0],
                lon: pos[1]
              }));
            }
          }
        }
      }
    }
  // After (re)render, apply any dynamic flashing state (union external + auto)
  this.updateFlashingClasses();
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
    // After markers exist, apply any queued service flash requests
    this.applyPendingServiceFlashes();
    // Kick off ring pulse animation updates (CSS handles icon; JS adjusts circle style)
    this.startRingPulseLoop();
  }

  /** Detect newly added victim clusters and start auto-flash if enabled */
  private handleNewVictims() {
    const currentIds = new Set(this.victimClusters.map(c => c.id));
    const newIds: string[] = [];
    for (const id of currentIds) {
      if (!this.prevVictimIds.has(id)) newIds.push(id);
    }
    // Remove ids that vanished from maps / timers
    for (const oldId of Array.from(this.prevVictimIds)) {
      if (!currentIds.has(oldId)) {
        this.prevVictimIds.delete(oldId);
        if (this.autoFlashingIds.has(oldId)) this.stopAutoFlash(oldId);
      }
    }
    // Begin auto flash
    if (this.autoFlashNewVictims && newIds.length) {
      for (const id of newIds) {
        this.startAutoFlash(id);
      }
    }
    // Update baseline set & classes
    this.prevVictimIds = currentIds;
    this.updateFlashingClasses();
  }

  private startAutoFlash(id: string) {
    if (this.autoFlashingIds.has(id)) return;
    this.autoFlashingIds.add(id);
    this.victimFlashStarted.emit({ id, source: 'auto' });
    const handle = setTimeout(() => {
      this.stopAutoFlash(id);
    }, Math.max(1000, this.autoFlashDurationMs));
    this.autoFlashTimeouts.set(id, handle);
  }

  private stopAutoFlash(id: string) {
    if (this.autoFlashingIds.delete(id)) {
      const t = this.autoFlashTimeouts.get(id);
      if (t) { try { clearTimeout(t); } catch {} }
      this.autoFlashTimeouts.delete(id);
      this.updateFlashingClasses();
      this.victimFlashEnded.emit({ id, source: 'auto' });
    }
  }

  /** Apply flashing classes based on external and auto sets */
  private updateFlashingClasses() {
    // If markers not yet ready, skip
    if (!this.markerRefs.size) {
      // Try again shortly in case this was called just before markers rendered
      setTimeout(() => {
        if (this.markerRefs.size) this.updateFlashingClasses();
      }, 60);
      return;
    }
    const external = new Set(this.flashingVictimIds);
    const usePriority = this.priorityFlashColors;
    for (const cluster of this.victimClusters) {
      const marker = this.markerRefs.get(cluster.id);
      if (!marker) continue;
      const el = marker.getElement && marker.getElement();
      if (!el) continue;
      const shouldFlash = external.has(cluster.id) || this.autoFlashingIds.has(cluster.id) || this.serviceFlashIds.has(cluster.id);
      if (shouldFlash) {
        el.classList.add('flashing');
        const skipPriority = this.serviceNoPriorityColorIds.has(cluster.id);
        if (usePriority && !skipPriority) {
          el.classList.add(`priority-${cluster.priority.toLowerCase()}`);
        } else {
          el.classList.remove('priority-immediate','priority-high','priority-medium','priority-low');
        }
      } else {
        el.classList.remove('flashing');
        el.classList.remove('priority-immediate','priority-high','priority-medium','priority-low');
      }
    }
  }

  /** Handle service-driven flash request */
  private handleServiceFlash(req: VictimFlashRequest) {
    const id = req.id;
    if (!id || !this.victimClusters.find(c => c.id === id)) return; // ignore unknown id
    // If markers not created yet (map not rendered), queue request
    if (!this.markerRefs.size) {
      this.pendingServiceFlashRequests.push(req);
      return;
    }
    // Renew if already active
    if (this.serviceFlashTimeouts.has(id)) {
      try { clearTimeout(this.serviceFlashTimeouts.get(id)); } catch {}
    }
    this.serviceFlashIds.add(id);
    if (req.priorityColors === false) {
      this.serviceNoPriorityColorIds.add(id);
    } else {
      this.serviceNoPriorityColorIds.delete(id);
    }
    this.updateFlashingClasses();
    this.victimFlashStarted.emit({ id, source: 'service' });
    // Focus logic
    const shouldFocus = typeof req.focus === 'boolean' ? req.focus : this.autoFocusOnServiceFlash;
    if (shouldFocus) {
      this.focusOnCluster(id);
    }
    const duration = Math.max(500, req.durationMs ?? this.autoFlashDurationMs);
    const handle = setTimeout(() => this.endServiceFlash(id), duration);
    this.serviceFlashTimeouts.set(id, handle);
  }

  private endServiceFlash(id: string) {
    if (this.serviceFlashIds.delete(id)) {
      const t = this.serviceFlashTimeouts.get(id);
      if (t) { try { clearTimeout(t); } catch {} }
      this.serviceFlashTimeouts.delete(id);
      this.serviceNoPriorityColorIds.delete(id);
      this.updateFlashingClasses();
      this.victimFlashEnded.emit({ id, source: 'service' });
    }
  }

  /** Fly/zoom to a cluster */
  private focusOnCluster(id: string, zoom: number = 15) {
    if (!this.map) return;
    const marker = this.markerRefs.get(id);
    if (!marker) return;
    try {
      const ll = marker.getLatLng?.();
      if (ll) {
        const currentZoom = this.map.getZoom?.() ?? zoom;
        this.map.flyTo(ll, currentZoom < zoom ? zoom : currentZoom, { duration: 0.75 });
      }
    } catch {}
  }

  /** Apply any queued service flash requests once markers exist */
  private applyPendingServiceFlashes() {
    if (!this.pendingServiceFlashRequests.length || !this.markerRefs.size) return;
    const pending = [...this.pendingServiceFlashRequests];
    this.pendingServiceFlashRequests = [];
    for (const req of pending) {
      // Re-run with live markers
      this.handleServiceFlash(req);
    }
  }

  /** Map priority to ring base color */
  private priorityRingColor(p: MapVictimCluster['priority']): string {
    switch (p) {
      case 'Immediate': return '#f44336';
      case 'High': return '#ff9800';
      case 'Medium': return '#ffeb3b';
      case 'Low': return '#1976d2';
      default: return '#ff9800';
    }
  }

  private ringPulseTimer?: any;
  private ringPulsePhase: number = 0; // legacy (unused for per-priority now)
  private ringPhaseById: Map<string, number> = new Map();
  private startRingPulseLoop() {
    if (this.ringPulseTimer) {
      clearInterval(this.ringPulseTimer); this.ringPulseTimer = undefined;
    }
    if (this.mapMode !== 'Fire' || this.victimHighlightCircles.size === 0) return;
    // Per-priority cycle lengths (ms): Immediate 900, High 1100, Medium 1300, Low 1500
    const cycleMs = (priority: MapVictimCluster['priority']) => {
      switch (priority) {
        case 'Immediate': return 900;
        case 'High': return 1100;
        case 'Medium': return 1300;
        case 'Low': return 1500;
      }
    };
    // 50ms tick for all; each circle computes its own phase based on its cycle
    this.ringPulseTimer = setInterval(() => {
      for (const [id, circle] of this.victimHighlightCircles.entries()) {
        const cluster = this.victimClusters.find(c => c.id === id);
        if (!cluster) continue;
        const cyc = cycleMs(cluster.priority);
        // advance stored phase time
        const prev = this.ringPhaseById.get(id) ?? 0;
        const next = (prev + 50) % cyc;
        this.ringPhaseById.set(id, next);
        const t = next / cyc; // 0..1
        const scale = 0.85 + 0.3 * Math.sin(t * Math.PI * 2);
        const opacity = 0.10 + 0.07 * (Math.sin(t * Math.PI * 2) * 0.5 + 0.5);
        try {
          const base = 120;
          circle.setStyle({ fillOpacity: opacity });
          circle.setRadius(base * scale);
        } catch {}
      }
    }, 50);
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
      case 'victim':
        title = 'Victim';
        if (data.id) rows.push(this.row('ID', data.id));
        if (data.clusterId) rows.push(this.row('Cluster', data.clusterId));
        if (data.priority) rows.push(this.row('Priority', data.priority));
        if (data.severity) rows.push(this.row('Severity', data.severity));
        if (data.need) rows.push(this.row('Need', data.need));
        if (data.status) rows.push(this.row('Status', data.status));
        if (typeof data.lat === 'number' && typeof data.lon === 'number') {
          rows.push(this.row('Coords', `${data.lat.toFixed(4)}, ${data.lon.toFixed(4)}`));
        }
        break;
      default:
        title = '';
    }

    return `\n    <div class="map-tooltip">\n      ${title ? `<div class=\"mt-title\">${this.escape(title)}</div>` : ''}\n      ${rows.join('')}\n    </div>`;
  }

  /** Deterministic pseudo-random victim position within cluster radius based on victim id */
  private getOrComputeVictimPosition(victimId: string, cluster: MapVictimCluster, priority: MapVictimCluster['priority']): [number, number] {
    const existing = this.victimPositions.get(victimId);
    if (existing) return existing;
    // base radius (meters) scaled by priority (spread larger for lower priority)
    const base = priority === 'Immediate' ? 25 : priority === 'High' ? 40 : priority === 'Medium' ? 55 : 70;
    const hash = Array.from(victimId).reduce((a,c)=> (a*31 + c.charCodeAt(0)) >>> 0, 0);
    const angle = (hash % 360) * Math.PI / 180;
    const dist = ( (hash >> 8) % 1000 ) / 1000 * base; // 0..base meters
    const metersToLat = 1 / 111000; // approx
    const metersToLon = 1 / 88000;  // approx (adjustable by latitude; simplified)
    const dLat = dist * Math.cos(angle) * metersToLat;
    const dLon = dist * Math.sin(angle) * metersToLon;
    const pos: [number, number] = [cluster.lat + dLat, cluster.lon + dLon];
    this.victimPositions.set(victimId, pos);
    return pos;
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
    const showVictims = this.showIndividualVictims;
    this.legendControl.onAdd = () => {
      const div = L.DomUtil.create('div', 'map-legend');
      div.setAttribute('role', 'group');
      div.setAttribute('aria-label', 'Map legend');
      const toggleLabel = this.showIndividualVictims ? 'Show Clusters' : 'Show Individuals';
      const toggleIcon = this.showIndividualVictims ? '👥' : '🧍';
      div.innerHTML = `
        <div class="legend-title">${mode} Layers
          <button type="button" class="legend-toggle-btn" aria-label="${toggleLabel}" title="${toggleLabel}" data-action="toggle-victim-view">${toggleIcon}</button>
        </div>
        <div class="legend-row"><span class="legend-swatch active-zone ${mode.toLowerCase()}"></span><span class="legend-label">Active ${mode} Zone</span></div>
        <div class="legend-row"><span class="legend-swatch forecast ${mode.toLowerCase()}"></span><span class="legend-label">Forecast Spread</span></div>
        <div class="legend-row"><span class="legend-icon">🧑‍🤝‍🧑</span><span class="legend-label">Victim Cluster</span></div>
        <div class="legend-row"><span class="legend-swatch flashing-swatch"></span><span class="legend-label">Flashing / Tracked</span></div>
        <div class="legend-row"><span class="legend-icon">${mode === 'Flood' ? '🚑' : '🚑'}</span><span class="legend-label">Responder Unit</span></div>
        <div class="legend-row"><span class="legend-icon">${mode === 'Flood' ? '🏥' : '🏥'}</span><span class="legend-label">Hospital</span></div>
        <div class="legend-row"><span class="legend-icon">${mode === 'Flood' ? '🛟' : '🛟'}</span><span class="legend-label">Safe Zone</span></div>
        ${showVictims ? `
          <div class="legend-subtitle">Victim Severity</div>
          <div class="legend-row"><span class="legend-icon victim-sev-sample critical">🧍</span><span class="legend-label">Critical</span></div>
          <div class="legend-row"><span class="legend-icon victim-sev-sample serious">🧍</span><span class="legend-label">Serious</span></div>
          <div class="legend-row"><span class="legend-icon victim-sev-sample stable">🧍</span><span class="legend-label">Stable</span></div>
        ` : ''}
      `;
      return div;
    };
    this.legendControl.addTo(this.map);
    // Attach click listener for toggle inside legend once it's added
    try {
      const container = (this.legendControl as any).getContainer?.();
      if (container) {
        container.addEventListener('click', (e: any) => {
          const btn = e.target?.closest('[data-action="toggle-victim-view"]');
          if (btn) {
            // Emit a custom DOM event upward; parent (app component) can listen if needed
            // For now we just flip the local Input then re-render.
            this.showIndividualVictims = !this.showIndividualVictims;
            // Force legend rebuild & layer re-render
            this.renderLayers();
          }
        });
      }
    } catch {}
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
