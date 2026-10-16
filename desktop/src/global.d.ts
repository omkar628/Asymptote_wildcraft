import type { WildcraftBridge } from './bridge';

declare global {
  interface Window {
    wildcraft?: WildcraftBridge;
  }
}

export {};
