import type { ReadinessFactory } from '../../electron/native-readiness';

// Process/argument fixtures have no desktop window. Window detection is covered
// separately with the same X11 probe used in production.
export const readyImmediately: ReadinessFactory = async () => ({ output() {}, async wait() {} });
