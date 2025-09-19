import { Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-right-panel-ai-assistant',
  standalone: true,
  templateUrl: './right-panel-ai-assistant.component.html',
  styleUrls: ['./right-panel-ai-assistant.component.scss']
})
export class RightPanelAIAssistantComponent {
  @Input() summary: string = '';
  @Input() responderQuery: string = '';
  @Output() responderQueryChange = new EventEmitter<string>();
  @Output() submitQuery = new EventEmitter<void>();

  onQueryInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.responderQueryChange.emit(value);
  }

  onSubmit() {
    this.submitQuery.emit();
  }

  playTTS() {
    // Placeholder for TTS logic
    const utterance = new SpeechSynthesisUtterance(this.summary);
    window.speechSynthesis.speak(utterance);
  }
}
