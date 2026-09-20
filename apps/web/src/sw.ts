// SPDX-License-Identifier: AGPL-3.0-only
import { installNotificationWorker } from "./notification-worker";
installNotificationWorker(globalThis as unknown as ServiceWorkerGlobalScope);
