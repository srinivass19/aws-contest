import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';

export interface VictimFlashRequest {
  id: string;
  durationMs?: number;
  focus?: boolean; // request map focus on start
  priorityColors?: boolean; // apply priority color variant
}

@Injectable({ providedIn: 'root' })
export class VictimFlashService {
  private _requests = new Subject<VictimFlashRequest>();
  readonly requests$: Observable<VictimFlashRequest> = this._requests.asObservable();

  requestFlash(id: string, options: { durationMs?: number; focus?: boolean; priorityColors?: boolean } = {}) {
    this._requests.next({ id, ...options });
  }
}
