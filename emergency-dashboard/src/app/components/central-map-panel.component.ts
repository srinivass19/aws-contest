import { Component, Input, Output, EventEmitter, AfterViewInit, OnChanges, SimpleChanges } from '@angular/core';
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
export class CentralMapPanelComponent implements AfterViewInit, OnChanges {
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

  getPredictionIndex(): number {
    return this.hazardPredictions.findIndex(p => p.timestamp === this.predictionTimestamp);
  }

  async ngAfterViewInit() {
    if (isPlatformBrowser(this.platformId)) {
      const L = await import('leaflet');
      this.L = L;
      this.map = L.map('map', {
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
      this.renderLayers();
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
    // 🔴 Fire/Flood Zone Overlay
    for (const zone of this.hazardZones) {
      const color = this.mapMode === 'Fire'
        ? 'rgba(255, 0, 0, 0.55)'
        : 'rgba(33, 150, 243, 0.55)';
      for (const poly of zone.coordinates) {
        L.polygon(poly, {
          color,
          fillColor: color,
          fillOpacity: 0.35,
          weight: 3,
          dashArray: undefined
        }).addTo(this.overlays);
      }
    }
    // 🟡 Forecast Spread (animated polygon)
    if (this.predictionTimestamp) {
      const pred = this.hazardPredictions.find(p => p.timestamp === this.predictionTimestamp);
      if (pred) {
        const predColor = this.mapMode === 'Fire' ? 'rgba(255, 193, 7, 0.7)' : 'rgba(33, 150, 243, 0.4)';
        for (const poly of pred.coordinates) {
          L.polygon(poly, {
            color: predColor,
            fillColor: predColor,
            fillOpacity: 0.22,
            dashArray: '8',
            weight: 2
          }).addTo(this.overlays);
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
      L.marker([cluster.lat, cluster.lon], { icon }).addTo(this.overlays);
    }
    // 🚑 My Unit Position (first responder is "my unit")
    let myUnitId = this.responders.length > 0 ? this.responders[0].id : null;
    for (const responder of this.responders) {
      const isMyUnit = responder.id === myUnitId;
      const icon = L.divIcon({
        className: `responder-icon ${responder.unitType.toLowerCase()}${isMyUnit ? ' my-unit' : ''}`,
        html: isMyUnit ? '🚑<span style="font-size:1.2em;">★</span>' : this.responderIconHtml(responder.unitType)
      });
      L.marker([responder.lat, responder.lon], { icon }).addTo(this.overlays);
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
      // Add arrowhead marker at the end of the route
      const last = route.coordinates[route.coordinates.length - 1];
      const icon = L.divIcon({
        className: `route-arrow ${route.type}`,
        iconSize: [24, 24],
        html: route.type === 'suggested' ? '<span style="font-size:1.6em;color:#388e3c;">⬆</span>' : '<span style="font-size:1.4em;color:#ff9800;">⬅</span>'
      });
      L.marker(last, { icon, interactive: false }).addTo(this.overlays);
    }
    // 🏥 Nearest Hospital / 🛟 Safe Zone
    for (const facility of this.facilities) {
      const icon = L.divIcon({
        className: `facility-icon ${facility.type.toLowerCase()}`,
        html: this.facilityIconHtml(facility.type)
      });
      L.marker([facility.lat, facility.lon], { icon }).addTo(this.overlays);
    }
  }

  private riskColor(score: number): string {
    // For Fire: gradient green (low) to red (high)
    const r = Math.round(255 * score);
    const g = Math.round(180 * (1 - score));
    return `rgb(${r},${g},64)`;
  }

  private responderIconHtml(type: string): string {
    switch (type) {
      case 'Ambulance': return '🚑';
      case 'Fire': return '🚒';
      case 'Police': return '🚓';
      default: return '🚨';
    }
  }

  private facilityIconHtml(type: string): string {
    switch (type) {
      case 'Hospital': return '🏥';
      case 'Shelter': return '🏚️';
      case 'SafeZone': return '🛟'; // lifebuoy for safe zone
      case 'RescueZone': return '🛟';
      case 'Roadblock': return '🚧';
      default: return '❓';
    }
  }
}
