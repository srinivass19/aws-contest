import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule, LowerCasePipe, PercentPipe } from '@angular/common';

export interface VictimCluster {
  id: string;
  name: string;
  location: { lat: number; lon: number; uncertainty: number };
  numVictims: number;
  needs: string[];
  confidence: number;
  status: 'en route' | 'on scene' | 'rescued';
}

@Component({
  selector: 'app-victim-prioritization-list',
  standalone: true,
  imports: [CommonModule, LowerCasePipe, PercentPipe],
  templateUrl: './victim-prioritization-list.component.html',
  styleUrls: ['./victim-prioritization-list.component.scss']
})
export class VictimPrioritizationListComponent {
  @Input() clusters: VictimCluster[] = [];
  @Input() priority: string = '';
  @Input() loading: boolean = false;
  @Output() assignResponder = new EventEmitter<string>();
  @Output() addNote = new EventEmitter<string>();

  getPriorityLabel(cluster: VictimCluster): string {
    // Use the actual priority property if present, otherwise fallback to confidence mapping
    if ((cluster as any).priority) {
      return (cluster as any).priority;
    }
    return 'N/A';
  }

  get filteredClusters(): VictimCluster[] {
    if (!this.priority || this.priority.toLowerCase() === 'all') return this.clusters;
    return this.clusters.filter(c => this.getPriorityLabel(c).toLowerCase() === this.priority.toLowerCase());
  }

  trackById(index: number, cluster: VictimCluster) {
    return cluster.id;
  }
}
