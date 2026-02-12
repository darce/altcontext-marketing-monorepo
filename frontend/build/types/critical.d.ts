declare module 'critical' {
  export interface CriticalTarget {
    html: string;
    uncritical?: string;
  }

  export interface CriticalDimension {
    width: number;
    height: number;
  }

  export interface CriticalOptions {
    base: string;
    src: string;
    target: CriticalTarget;
    inline?: boolean;
    dimensions?: CriticalDimension[];
  }

  export function generate(options: CriticalOptions): Promise<void>;
}
