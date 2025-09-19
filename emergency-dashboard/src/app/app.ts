import { Component, signal, ChangeDetectorRef } from '@angular/core';
import { MapboxService } from './services/mapbox.service';
import { ApiService } from './services/api.service';
import { FormsModule } from '@angular/forms';
import { HeaderToolbarComponent } from './components/header-toolbar.component';
import { VictimPrioritizationListComponent, VictimCluster } from './components/victim-prioritization-list.component';
import { CentralMapPanelComponent, MapHazardZone, MapHazardPrediction, MapVictimCluster, MapResponder, MapRoute, MapFacility } from './components/central-map-panel.component';
import { RightPanelAIAssistantComponent } from './components/right-panel-ai-assistant.component';
import { FooterNotificationPanelComponent } from './components/footer-notification-panel.component';

@Component({
  selector: 'app-root',
  imports: [HeaderToolbarComponent, VictimPrioritizationListComponent, CentralMapPanelComponent, RightPanelAIAssistantComponent, FooterNotificationPanelComponent, FormsModule],
  templateUrl: './app.html',
  styleUrls: ['./app.scss']
})
export class App {
  // Map center coordinates for each incident
  incidentCenters: { [incident: string]: [number, number] } = {
    'Fire - Downtown Warehouse': [37.7820, -122.4100],
    'Flood - Riverside District': [37.7900, -122.4200],
    'Fire - Industrial Park': [37.7605, -122.4302],
    'Flood - East Valley': [37.7702, -122.4401],
    'Fire - North Hills': [37.7509, -122.4507],
    'Flood - South Meadows': [37.7303, -122.4605],
    'Fire - City Center': [37.7208, -122.4702],
    'Flood - West End': [37.7102, -122.4801]
  };
  mapCenter: [number, number] = [37.7820, -122.4100];
  aiSummary: string = 'Fire contained in North Sector. 3 victims awaiting evacuation. Medical team en route.';
  responderQuery: string = '';

  incidents: string[];
  selectedIncident: string;
  mapMode: 'Fire' | 'Flood' = 'Fire';
  forecastHour: number = 0;
  priority: string = 'All';

  notificationEvents: Array<{
    id: string;
    type: 'road' | 'hazard' | 'responder' | 'other';
    message: string;
    timestamp: string;
    read: boolean;
  }> = [
    { id: '1', type: 'road', message: 'Main St closed due to debris', timestamp: new Date().toISOString(), read: false },
    { id: '2', type: 'hazard', message: 'Hazard zone expanded in North Sector', timestamp: new Date().toISOString(), read: false },
    { id: '3', type: 'responder', message: 'Ambulance R1 arrived at scene', timestamp: new Date().toISOString(), read: false },
    { id: '4', type: 'other', message: 'Weather update: wind increasing', timestamp: new Date().toISOString(), read: true }
  ];
  notificationFilter: string = 'all';

  protected readonly title = signal('emergency-dashboard');
  // Demo data for map panel
  // Demo data for both modes
  incidentHazardZones: { [incident: string]: MapHazardZone[] } = {
    'Fire - Downtown Warehouse': [
      { id: 'fire-hz-dw', coordinates: [
        [ [37.779, -122.413], [37.785, -122.413], [37.785, -122.407], [37.779, -122.407] ]
      ], riskScore: 0.95 }
    ],
    'Flood - Riverside District': [
      { id: 'flood-hz-rd', coordinates: [
        [ [37.787, -122.423], [37.793, -122.423], [37.793, -122.417], [37.787, -122.417] ]
      ], riskScore: 0.7 }
    ],
    'Fire - Industrial Park': [
      { id: 'fire-hz-ip', coordinates: [
        [ [37.758, -122.433], [37.764, -122.433], [37.764, -122.427], [37.758, -122.427] ]
      ], riskScore: 0.9 }
    ],
    'Flood - East Valley': [
      { id: 'flood-hz-ev', coordinates: [
        [ [37.767, -122.443], [37.773, -122.443], [37.773, -122.437], [37.767, -122.437] ]
      ], riskScore: 0.7 }
    ],
    'Fire - North Hills': [
      { id: 'fire-hz-nh', coordinates: [
        [ [37.748, -122.453], [37.754, -122.453], [37.754, -122.447], [37.748, -122.447] ]
      ], riskScore: 0.92 }
    ],
    'Flood - South Meadows': [
      { id: 'flood-hz-sm', coordinates: [
        [ [37.727, -122.463], [37.733, -122.463], [37.733, -122.457], [37.727, -122.457] ]
      ], riskScore: 0.7 }
    ],
    'Fire - City Center': [
      { id: 'fire-hz-cc', coordinates: [
        [ [37.718, -122.473], [37.724, -122.473], [37.724, -122.467], [37.718, -122.467] ]
      ], riskScore: 0.93 }
    ],
    'Flood - West End': [
      { id: 'flood-hz-we', coordinates: [
        [ [37.707, -122.483], [37.713, -122.483], [37.713, -122.477], [37.707, -122.477] ]
      ], riskScore: 0.7 }
    ]
  };
  incidentHazardPredictions: { [incident: string]: MapHazardPrediction[] } = {
    'Fire - Downtown Warehouse': [
      { id: 'fire-pred-dw', coordinates: [
        [ [37.777, -122.415], [37.787, -122.415], [37.787, -122.405], [37.777, -122.405] ]
      ], timestamp: '2025-09-18T17:00:00Z' }
    ],
    'Flood - Riverside District': [
      { id: 'flood-pred-rd', coordinates: [
        [ [37.785, -122.425], [37.795, -122.425], [37.795, -122.415], [37.785, -122.415] ]
      ], timestamp: '2025-09-18T17:00:00Z' }
    ],
    'Fire - Industrial Park': [
      { id: 'fire-pred-ip', coordinates: [
        [ [37.756, -122.435], [37.766, -122.435], [37.766, -122.425], [37.756, -122.425] ]
      ], timestamp: '2025-09-18T17:00:00Z' }
    ],
    'Flood - East Valley': [
      { id: 'flood-pred-ev', coordinates: [
        [ [37.765, -122.445], [37.775, -122.445], [37.775, -122.435], [37.765, -122.435] ]
      ], timestamp: '2025-09-18T17:00:00Z' }
    ],
    'Fire - North Hills': [
      { id: 'fire-pred-nh', coordinates: [
        [ [37.746, -122.455], [37.756, -122.455], [37.756, -122.445], [37.746, -122.445] ]
      ], timestamp: '2025-09-18T17:00:00Z' }
    ],
    'Flood - South Meadows': [
      { id: 'flood-pred-sm', coordinates: [
        [ [37.725, -122.465], [37.735, -122.465], [37.735, -122.455], [37.725, -122.455] ]
      ], timestamp: '2025-09-18T17:00:00Z' }
    ],
    'Fire - City Center': [
      { id: 'fire-pred-cc', coordinates: [
        [ [37.716, -122.475], [37.726, -122.475], [37.726, -122.465], [37.716, -122.465] ]
      ], timestamp: '2025-09-18T17:00:00Z' }
    ],
    'Flood - West End': [
      { id: 'flood-pred-we', coordinates: [
        [ [37.705, -122.485], [37.715, -122.485], [37.715, -122.475], [37.705, -122.475] ]
      ], timestamp: '2025-09-18T17:00:00Z' }
    ]
  };

  incidentResponders: { [incident: string]: MapResponder[] } = {
    'Fire - Downtown Warehouse': [ { id: 'R1', lat: 37.7822, lon: -122.4102, unitType: 'Ambulance' } ],
    'Flood - Riverside District': [ { id: 'R2', lat: 37.7902, lon: -122.4203, unitType: 'Ambulance' } ],
    'Fire - Industrial Park': [ { id: 'R3', lat: 37.7607, lon: -122.4305, unitType: 'Ambulance' } ],
    'Flood - East Valley': [ { id: 'R4', lat: 37.7704, lon: -122.4403, unitType: 'Ambulance' } ],
    'Fire - North Hills': [ { id: 'R5', lat: 37.7511, lon: -122.4509, unitType: 'Ambulance' } ],
    'Flood - South Meadows': [ { id: 'R6', lat: 37.7305, lon: -122.4607, unitType: 'Ambulance' } ],
    'Fire - City Center': [ { id: 'R7', lat: 37.7210, lon: -122.4704, unitType: 'Ambulance' } ],
    'Flood - West End': [ { id: 'R8', lat: 37.7104, lon: -122.4803, unitType: 'Ambulance' } ]
  };
  incidentRoutes: { [incident: string]: MapRoute[] } = {};
  incidentFacilities: { [incident: string]: MapFacility[] } = {
    'Fire - Downtown Warehouse': [
      // Place Hospital just south of fire zone
      { id: 'F1', lat: 37.778, lon: -122.410, type: 'Hospital', name: 'General Hospital' },
      // Place SafeZone just north of fire zone
      { id: 'F2', lat: 37.786, lon: -122.410, type: 'SafeZone', name: 'Safe Zone Alpha' }
    ],
    'Flood - Riverside District': [
      { id: 'F1', lat: 37.791, lon: -122.419, type: 'Hospital', name: 'Riverside Hospital' },
      { id: 'F2', lat: 37.789, lon: -122.421, type: 'SafeZone', name: 'Safe Zone Beta' }
    ],
    'Fire - Industrial Park': [
      // Place Hospital just south of fire zone
      { id: 'F1', lat: 37.757, lon: -122.430, type: 'Hospital', name: 'Industrial Hospital' },
      // Place SafeZone just north of fire zone
      { id: 'F2', lat: 37.765, lon: -122.430, type: 'SafeZone', name: 'Safe Zone Gamma' }
    ],
    'Flood - East Valley': [
      { id: 'F1', lat: 37.771, lon: -122.439, type: 'Hospital', name: 'Valley Hospital' },
      { id: 'F2', lat: 37.769, lon: -122.441, type: 'SafeZone', name: 'Safe Zone Delta' }
    ],
    'Fire - North Hills': [
      // Place Hospital just south of fire zone
      { id: 'F1', lat: 37.747, lon: -122.450, type: 'Hospital', name: 'North Hills Hospital' },
      // Place SafeZone just north of fire zone
      { id: 'F2', lat: 37.755, lon: -122.450, type: 'SafeZone', name: 'Safe Zone Epsilon' }
    ],
    'Flood - South Meadows': [
      { id: 'F1', lat: 37.731, lon: -122.459, type: 'Hospital', name: 'South Meadows Hospital' },
      { id: 'F2', lat: 37.729, lon: -122.461, type: 'SafeZone', name: 'Safe Zone Zeta' }
    ],
    'Fire - City Center': [
      // Place Hospital just south of fire zone
      { id: 'F1', lat: 37.717, lon: -122.470, type: 'Hospital', name: 'City Center Hospital' },
      // Place SafeZone just north of fire zone
      { id: 'F2', lat: 37.725, lon: -122.470, type: 'SafeZone', name: 'Safe Zone Eta' }
    ],
    'Flood - West End': [
      { id: 'F1', lat: 37.711, lon: -122.479, type: 'Hospital', name: 'West End Hospital' },
      { id: 'F2', lat: 37.709, lon: -122.481, type: 'SafeZone', name: 'Safe Zone Theta' }
    ]
  };
  floodHazardZones: MapHazardZone[] = [
    { id: 'flood-hz1', coordinates: [[[37.772, -122.425], [37.773, -122.425], [37.773, -122.423], [37.772, -122.423]]], riskScore: 0.7 }
  ];
  floodHazardPredictions: MapHazardPrediction[] = [
    { id: 'flood-pred1', coordinates: [[[37.771, -122.426], [37.774, -122.426], [37.774, -122.423], [37.771, -122.423]]], timestamp: '2025-09-18T17:00:00Z' }
  ];

  // Use backing fields for overlays to allow assignment
  private _hazardZones: MapHazardZone[] = [];
  private _hazardPredictions: MapHazardPrediction[] = [];
  private _responders: MapResponder[] = [];
  private _routes: MapRoute[] = [];
  private _facilities: MapFacility[] = [];

  get hazardZones(): MapHazardZone[] { return this._hazardZones; }
  get hazardPredictions(): MapHazardPrediction[] { return this._hazardPredictions; }
  get responders(): MapResponder[] { return this._responders; }
  get routes(): MapRoute[] { return this._routes; }
  get facilities(): MapFacility[] { return this._facilities; }
  // All clusters for all incidents
  allMapVictimClusters: { [incident: string]: MapVictimCluster[] } = (() => {
    // For fire incidents, place clusters by priority: Immediate=center, High=close, Medium=farther, Low=farthest
    const fireIncidents = [
      'Fire - Downtown Warehouse',
      'Fire - Industrial Park',
      'Fire - North Hills',
      'Fire - City Center',
    ];
    const floodIncidents = [
      'Flood - Riverside District',
      'Flood - East Valley',
      'Flood - South Meadows',
      'Flood - West End',
    ];
    const priorities = ['Immediate', 'High', 'High', 'Medium', 'Low'];
    const clusterCount = 5;
    const result: { [incident: string]: MapVictimCluster[] } = {};
    let incidentIdx = 0;
    // Fire incidents: priority-based rings
    for (const incident of fireIncidents) {
      const center = this.incidentCenters[incident];
      const baseLat = center[0];
      const baseLon = center[1];
      const clusters: MapVictimCluster[] = [];
      // Priority: Immediate=center, High=~120m, Medium=~200m, Low=~300m (spread out even more)
      // 1 deg lat ~ 111km, 1 deg lon ~ 88km at SF
      const metersToLat = 1 / 111000;
      const metersToLon = 1 / 88000;
      const rings = {
        'Immediate': 0,
        'High': 120,
        'Medium': 200,
        'Low': 300
      };
      // Assign priorities to clusters
      const clusterPriorities = ['Immediate', 'High', 'High', 'Medium', 'Low'];
      let highIdx = 0, mediumIdx = 0, lowIdx = 0;
      for (let i = 0; i < clusterCount; i++) {
        const priority = clusterPriorities[i] as 'Immediate' | 'High' | 'Medium' | 'Low';
        let lat = baseLat, lon = baseLon;
        if (priority === 'Immediate') {
          // Center
        } else {
          // Place in ring for this priority
          let ringRadius = rings[priority];
          // Spread High, Medium, Low evenly in their rings
          let angle = 0;
          if (priority === 'High') {
            angle = (2 * Math.PI * highIdx) / 2; highIdx++;
          } else if (priority === 'Medium') {
            angle = (2 * Math.PI * mediumIdx) / 1; mediumIdx++;
          } else if (priority === 'Low') {
            angle = (2 * Math.PI * lowIdx) / 1; lowIdx++;
          }
          // Add a small random offset for realism
          const jitterLat = (Math.random() - 0.5) * metersToLat * 5;
          const jitterLon = (Math.random() - 0.5) * metersToLon * 5;
          lat = baseLat + Math.cos(angle) * ringRadius * metersToLat + jitterLat;
          lon = baseLon + Math.sin(angle) * ringRadius * metersToLon + jitterLon;
        }
        clusters.push({
          id: `VC-${incidentIdx + 2}${i + 1}01`,
          lat,
          lon,
          priority
        });
      }
      result[incident] = clusters;
      incidentIdx++;
    }
    // Flood incidents: priority-based rings (same as fire)
    for (const incident of floodIncidents) {
      const center = this.incidentCenters[incident];
      const baseLat = center[0];
      const baseLon = center[1];
      const clusters: MapVictimCluster[] = [];
      // Priority: Immediate=center, High=~120m, Medium=~200m, Low=~300m (spread out even more)
      const metersToLat = 1 / 111000;
      const metersToLon = 1 / 88000;
      const rings = {
        'Immediate': 0,
        'High': 120,
        'Medium': 200,
        'Low': 300
      };
      const clusterPriorities = ['Immediate', 'High', 'High', 'Medium', 'Low'];
      let highIdx = 0, mediumIdx = 0, lowIdx = 0;
      for (let i = 0; i < clusterCount; i++) {
        const priority = clusterPriorities[i] as 'Immediate' | 'High' | 'Medium' | 'Low';
        let lat = baseLat, lon = baseLon;
        if (priority === 'Immediate') {
          // Center
        } else {
          let ringRadius = rings[priority];
          let angle = 0;
          if (priority === 'High') {
            angle = (2 * Math.PI * highIdx) / 2; highIdx++;
          } else if (priority === 'Medium') {
            angle = (2 * Math.PI * mediumIdx) / 1; mediumIdx++;
          } else if (priority === 'Low') {
            angle = (2 * Math.PI * lowIdx) / 1; lowIdx++;
          }
          const jitterLat = (Math.random() - 0.5) * metersToLat * 5;
          const jitterLon = (Math.random() - 0.5) * metersToLon * 5;
          lat = baseLat + Math.cos(angle) * ringRadius * metersToLat + jitterLat;
          lon = baseLon + Math.sin(angle) * ringRadius * metersToLon + jitterLon;
        }
        clusters.push({
          id: `VC-${incidentIdx + 2}${i + 1}01`,
          lat,
          lon,
          priority
        });
      }
      result[incident] = clusters;
      incidentIdx++;
    }
    return result;
  })();
  mapVictimClusters: MapVictimCluster[] = [];
  predictionTimestamp: string = '2025-09-18T17:00:00Z';
  clusters: VictimCluster[] = [];

  constructor(private cdr: ChangeDetectorRef, private mapboxService: MapboxService, private api: ApiService) {
    this.incidents = [
      'Fire - Downtown Warehouse',
      'Flood - Riverside District',
      'Fire - Industrial Park',
      'Flood - East Valley',
      'Fire - North Hills',
      'Flood - South Meadows',
      'Fire - City Center',
      'Flood - West End'
    ];
    this.selectedIncident = this.incidents.length > 0 ? this.incidents[0] : '';
    this.priority = 'All';
    this.initFromApi();
  }

  async initFromApi() {
    // Hazards
    const hazardType = this.selectedIncident.startsWith('Fire') ? 'fire' : 'flood';
    this.incidentHazardZones[this.selectedIncident] = await this.api.getHazards(hazardType) || [];
    this.incidentHazardPredictions[this.selectedIncident] = await this.api.getHazardForecast() || [];
    // Victims
    const victims = await this.api.getVictims(this.selectedIncident);
    this.allMapVictimClusters[this.selectedIncident] = (victims && victims.length) ? victims : this.allMapVictimClusters[this.selectedIncident];
    // Responders
    this.incidentResponders[this.selectedIncident] = await this.api.getResponders(this.selectedIncident) || [];
    // Routes (dummy: keep using Mapbox for now)
    await this.updateAllIncidentRoutes();
    // Update overlays
    this.updateMapVictimClusters();
    this.updateVictimClusters();
    this.updateIncidentMapData();
  }

  // For each incident, fetch Mapbox road-based routes and update incidentRoutes
  async updateAllIncidentRoutes() {
    const fireIncidents = [
      'Fire - Downtown Warehouse',
      'Fire - Industrial Park',
      'Fire - North Hills',
      'Fire - City Center',
    ];
    const floodIncidents = [
      'Flood - Riverside District',
      'Flood - East Valley',
      'Flood - South Meadows',
      'Flood - West End',
    ];
    const allIncidents = [...fireIncidents, ...floodIncidents];
    for (const incident of allIncidents) {
      const hz = (this.incidentHazardZones[incident]?.[0]?.coordinates[0]) || this.incidentCenters[incident];
      const pred = (this.incidentHazardPredictions[incident]?.[0]?.coordinates[0]) || this.incidentCenters[incident];
      // Get centroid of prediction polygon
      const centroid = pred.reduce((acc, cur) => [acc[0] + cur[0], acc[1] + cur[1]], [0, 0]).map(x => x / pred.length) as [number, number];
      // Get centroid of hazard polygon
      const hzCentroid = hz.reduce((acc, cur) => [acc[0] + cur[0], acc[1] + cur[1]], [0, 0]).map(x => x / hz.length) as [number, number];
      // Suggested: approach from north (0 deg), Alternate: approach from east (90 deg)
      const getPoint = (center: [number, number], angleDeg: number, dist: number) => {
        const angleRad = angleDeg * Math.PI / 180;
        return [center[0] + dist * Math.cos(angleRad), center[1] + dist * Math.sin(angleRad)] as [number, number];
      };
      const startSuggested = getPoint(centroid, 0, 0.01); // ~1km north
      const startAlternate = getPoint(centroid, 90, 0.01); // ~1km east
      // End at hazard centroid
      const end = hzCentroid;
      // Fetch Mapbox routes
      try {
        const suggestedRoute = await this.mapboxService.getRoute(startSuggested, end);
        const alternateRoute = await this.mapboxService.getRoute(startAlternate, end);
        this.incidentRoutes[incident] = [
          { id: 'route1', coordinates: suggestedRoute, type: 'suggested' },
          { id: 'route2', coordinates: alternateRoute, type: 'alternate' }
        ];
      } catch (e) {
        // Fallback to straight lines if API fails
        this.incidentRoutes[incident] = [
          { id: 'route1', coordinates: [startSuggested, end], type: 'suggested' },
          { id: 'route2', coordinates: [startAlternate, end], type: 'alternate' }
        ];
      }
    }
    // Update overlays if needed
    this.updateIncidentMapData();
    this.cdr.markForCheck();
  }

  onResponderQueryChange(value: string) {
    this.responderQuery = value;
  }

  onSubmitResponderQuery() {
    // TODO: Integrate with AI backend
    this.aiSummary = `AI Response to: ${this.responderQuery}`;
    this.responderQuery = '';
  }

  onNotificationFilterChange(type: string) {
    this.notificationFilter = type;
  }

  onMarkNotificationAsRead(id: string) {
    const event = this.notificationEvents.find(e => e.id === id);
    if (event) event.read = true;
  }

  onMapModeChange(mode: 'Fire' | 'Flood') {
    this.mapMode = mode;
  }
  
  async onIncidentChange(incident: string) {
    this.selectedIncident = incident;
    this.priority = 'All'; // Reset priority filter on incident change
    await this.initFromApi();
  }

  updateIncidentMapData() {
  // overlays for map
  this._hazardZones = this.incidentHazardZones[this.selectedIncident] || [];
  this._hazardPredictions = this.incidentHazardPredictions[this.selectedIncident] || [];
  this._responders = this.incidentResponders[this.selectedIncident] || [];
  this._routes = this.incidentRoutes[this.selectedIncident] || [];
  this._facilities = this.incidentFacilities[this.selectedIncident] || [];
  // Update map center for new incident
  this.mapCenter = this.incidentCenters[this.selectedIncident] || [37.7749, -122.4194];
  }

  updateVictimClusters() {
    // Map MapVictimCluster[] to VictimCluster[] for the selected incident, using the priority from allMapVictimClusters
    const mapClusters = this.allMapVictimClusters[this.selectedIncident] || [];
    this.clusters = mapClusters.map((c, idx) => ({
      id: c.id,
      name: `Cluster ${idx + 1}`,
      location: { lat: c.lat, lon: c.lon, uncertainty: (
        c.priority === 'Immediate' ? 30 :
        c.priority === 'High' ? 40 :
        c.priority === 'Medium' ? 50 :
        60
      ) },
      numVictims: 3 + idx,
      needs: c.priority === 'Immediate' ? ['Medical', 'Evacuation'] : (c.priority === 'High' ? ['Medical'] : ['Evacuation']),
      confidence: c.priority === 'Immediate' ? 0.9 : (c.priority === 'High' ? 0.7 : 0.5),
      status: idx % 3 === 0 ? 'en route' : (idx % 3 === 1 ? 'on scene' : 'rescued'),
      priority: c.priority
    }));
    this.cdr.markForCheck();
  }

  updateMapVictimClusters() {
  // Always show all clusters for the selected incident on the map
  this.mapVictimClusters = this.allMapVictimClusters[this.selectedIncident] || [];
  }

}


