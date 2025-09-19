import { Injectable } from '@angular/core';
import { MAPBOX_API_KEY } from '../mapbox.config';

@Injectable({ providedIn: 'root' })
export class MapboxService {
  private readonly baseUrl = 'https://api.mapbox.com/directions/v5/mapbox/driving';

  async getRoute(start: [number, number], end: [number, number]): Promise<[number, number][]> {
    // Mapbox expects [lon,lat]
    const coords = `${start[1]},${start[0]};${end[1]},${end[0]}`;
    const url = `${this.baseUrl}/${coords}?geometries=geojson&access_token=${MAPBOX_API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Mapbox Directions API error');
    const data = await response.json();
    // Return array of [lat,lon]
    return data.routes[0].geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
  }
}