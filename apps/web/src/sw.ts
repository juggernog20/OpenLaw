// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The second Vite entry installs the single notification worker (DES-089).
 */
import { installNotificationWorker } from "./notification-worker";
installNotificationWorker(globalThis as unknown as ServiceWorkerGlobalScope);
