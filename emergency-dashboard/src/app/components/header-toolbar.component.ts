
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSliderModule } from '@angular/material/slider';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-header-toolbar',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatToolbarModule,
    MatButtonModule,
    MatSelectModule,
    MatFormFieldModule,
    MatSliderModule,
    MatIconModule
  ],
  templateUrl: './header-toolbar.component.html',
  styleUrls: ['./header-toolbar.component.scss']
})
export class HeaderToolbarComponent {
  @Input() incidents: string[] = [];
  @Input() selectedIncident: string = '';
  @Input() mapMode: 'Fire' | 'Flood' = 'Fire';
  @Input() forecastHour: number = 0;
  @Input() priority: string = 'All';
  @Output() incidentChange = new EventEmitter<string>();
  @Output() mapModeChange = new EventEmitter<'Fire' | 'Flood'>();
  @Output() forecastHourChange = new EventEmitter<number>();
  @Output() priorityChange = new EventEmitter<string>();

  priorities = ['All', 'Immediate', 'High', 'Medium', 'Low'];

  onIncidentChange(event: any) {
    // Angular Material selectionChange emits { value }
    this.incidentChange.emit(event.value);
  }
  onMapModeChange(mode: 'Fire' | 'Flood') {
    this.mapModeChange.emit(mode);
  }
  onForecastChange(value: number) {
    this.forecastHourChange.emit(Number(value));
  }
  onPriorityChange(priority: string) {
    this.priorityChange.emit(priority);
  }
}
