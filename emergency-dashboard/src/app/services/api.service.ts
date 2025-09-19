// API service for all backend endpoints
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly baseUrl = '/api'; // Change to your backend base URL if needed

  async getHazards(type: 'fire' | 'flood'): Promise<any> {
    // Dummy hazard polygon centered on incident
    const base = type === 'fire' ? [37.782, -122.410] : [37.790, -122.420];
    return [
      {
        id: `${type}-hz-dummy`,
        coordinates: [
          [
            [base[0] - 0.003, base[1] - 0.003],
            [base[0] + 0.003, base[1] - 0.003],
            [base[0] + 0.003, base[1] + 0.003],
            [base[0] - 0.003, base[1] + 0.003]
          ]
        ],
        riskScore: type === 'fire' ? 0.9 : 0.7
      }
    ];
  }

  async getHazardForecast(): Promise<any> {
    // Dummy forecast polygon offset from hazard
    return [
      {
        id: 'hz-forecast-dummy',
        coordinates: [
          [
            [37.779, -122.413],
            [37.786, -122.413],
            [37.786, -122.406],
            [37.779, -122.406]
          ]
        ],
        timestamp: new Date().toISOString()
      }
    ];
  }

  async getVictims(incidentId: string): Promise<any> {
    // Dummy clusters, slightly offset by incidentId hash
    const offset = incidentId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 10 * 0.0005;
    return [
      { id: 'VC-1', lat: 37.782 + offset, lon: -122.409 - offset, priority: 'Immediate' },
      { id: 'VC-2', lat: 37.783 + offset, lon: -122.408 - offset, priority: 'High' },
      { id: 'VC-3', lat: 37.784 + offset, lon: -122.407 - offset, priority: 'Medium' },
      { id: 'VC-4', lat: 37.785 + offset, lon: -122.406 - offset, priority: 'Low' }
    ];
  }

  async getResponders(incidentId: string): Promise<any> {
    // Dummy responders, slightly offset by incidentId hash
    const offset = incidentId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 10 * 0.0005;
    return [
      { id: 'R1', lat: 37.7822 + offset, lon: -122.4102 - offset, unitType: 'Ambulance' },
      { id: 'R2', lat: 37.784 + offset, lon: -122.408 - offset, unitType: 'Fire' }
    ];
  }

  async postAssignment(payload: any): Promise<any> {
    return fetch(`${this.baseUrl}/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => r.json());
  }

  async assistantQuery(query: string): Promise<any> {
    return fetch(`${this.baseUrl}/assistant/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    }).then(r => r.json());
  }

  async assistantVoice(audio: Blob): Promise<any> {
    const formData = new FormData();
    formData.append('audio', audio);
    return fetch(`${this.baseUrl}/assistant/voice`, {
      method: 'POST',
      body: formData
    }).then(r => r.json());
  }

  async ragQuery(query: string): Promise<any> {
    return fetch(`${this.baseUrl}/rag/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    }).then(r => r.json());
  }

  async ragVoice(audio: Blob): Promise<any> {
    const formData = new FormData();
    formData.append('audio', audio);
    return fetch(`${this.baseUrl}/rag/voice`, {
      method: 'POST',
      body: formData
    }).then(r => r.json());
  }

  // WebSocket for live updates
  getIncidentWebSocket(incidentId: string): WebSocket {
    return new WebSocket(`${window.location.origin.replace('http', 'ws')}/ws/incident/${incidentId}`);
  }
}
