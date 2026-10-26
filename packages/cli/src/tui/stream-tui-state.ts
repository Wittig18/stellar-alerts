import { PaymentDTO } from '../lib/types.js';

export interface StreamTuiState {
  payments: PaymentDTO[];
  isPaused: boolean;
  filter: string;
  totalReceived: number;
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
  lastUpdate: string;
}

export type StreamTuiAction =
  | { type: 'ADD_PAYMENT'; payload: PaymentDTO }
  | { type: 'TOGGLE_PAUSE' }
  | { type: 'SET_FILTER'; payload: string }
  | { type: 'CLEAR' }
  | { type: 'SET_CONNECTION_STATUS'; payload: 'connected' | 'disconnected' | 'connecting' }
  | { type: 'QUIT' };

/**
 * Pure state transition for the stream TUI. It lives in its own module so it
 * can be unit tested without pulling in ink (and its React reconciler) at
 * import time.
 */
export function streamTuiReducer(
  state: StreamTuiState,
  action: StreamTuiAction,
): StreamTuiState {
  switch (action.type) {
    case 'ADD_PAYMENT':
      return {
        ...state,
        payments: [action.payload, ...state.payments].slice(0, 50),
        totalReceived: state.totalReceived + 1,
        lastUpdate: new Date().toISOString(),
      };
    case 'TOGGLE_PAUSE':
      return {
        ...state,
        isPaused: !state.isPaused,
        lastUpdate: new Date().toISOString(),
      };
    case 'SET_FILTER':
      return {
        ...state,
        filter: action.payload,
        lastUpdate: new Date().toISOString(),
      };
    case 'CLEAR':
      return {
        ...state,
        payments: [],
        lastUpdate: new Date().toISOString(),
      };
    case 'SET_CONNECTION_STATUS':
      return {
        ...state,
        connectionStatus: action.payload,
        lastUpdate: new Date().toISOString(),
      };
    case 'QUIT':
      return state;
    default:
      return state;
  }
}
