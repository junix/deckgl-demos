/// <reference types="vite/client" />

declare global {
  interface Window {
    __plotDemo?: {
      ready: boolean;
      scene: string;
      itemCount: number;
      frame: number;
      viewChanges: number;
      viewState: unknown;
      error?: string;
    };
  }
}

export {};
