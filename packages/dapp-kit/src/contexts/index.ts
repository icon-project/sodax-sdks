import { createContext } from 'react';
import type { Sodax } from '@sodax/sdk';

export interface SodaxContextType {
  sodax: Sodax;
}

export const SodaxContext = createContext<SodaxContextType | null>(null);
