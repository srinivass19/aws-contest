import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';

export interface NotificationEvent {
  id: string;
  type: 'road' | 'hazard' | 'responder' | 'other';
  message: string;
  timestamp: string;
  read: boolean;
}

@Component({
  selector: 'app-footer-notification-panel',
  standalone: true,
  imports: [CommonModule, DatePipe],
  templateUrl: './footer-notification-panel.component.html',
  styleUrls: ['./footer-notification-panel.component.scss']
})
export class FooterNotificationPanelComponent {
  @Input() events: NotificationEvent[] = [];
  @Input() filter: string = 'all';
  @Output() filterChange = new EventEmitter<string>();
  @Output() markAsRead = new EventEmitter<string>();
  @Output() markAllRead = new EventEmitter<void>();

  get filteredEvents() {
    if (this.filter === 'all') return this.events;
    return this.events.filter(e => e.type === this.filter);
  }

  onFilterChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    this.filterChange.emit(value);
  }

  onMarkAsRead(id: string) {
    this.markAsRead.emit(id);
  }

  hasUnread(): boolean {
    return this.events.some(e => !e.read);
  }

  onMarkAll() {
    if (!this.hasUnread()) return;
    this.markAllRead.emit();
  }
}
